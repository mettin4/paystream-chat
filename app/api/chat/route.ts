import { cookies } from "next/headers";

import { streamChat, type ChatMessage } from "@/lib/anthropic";
import { payForPromptThrottled } from "@/lib/circle";
import {
  SESSION_COOKIE_NAME,
  verifySessionCookie,
} from "@/lib/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Payment model: one on-chain nanopayment per word emitted by the model. Each
// word triggers a fire-and-forget payForPrompt(sessionId, 1). These run in
// parallel against Circle Gateway — the stream doesn't wait for them. They
// land in sessions.json as they complete, and the client polls
// /api/transactions to watch the feed fill in real time. A 100-word reply
// produces ~100 on-chain settlements.

type ChatRequest = {
  messages?: ChatMessage[];
};

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const messages = body.messages ?? [];
  if (messages.length === 0) {
    return jsonError("messages required", 400);
  }

  const raw = cookies().get(SESSION_COOKIE_NAME)?.value;
  const sessionId = await verifySessionCookie(raw);
  if (!sessionId) {
    return jsonError("no valid session cookie", 401);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Same word-boundary logic as the client (see ChatInterface.tsx `send`).
      // We accumulate text until we see whitespace after a non-whitespace
      // run; everything up to that whitespace is a complete word and gets
      // charged. The trailing partial word stays in the buffer.
      let buffer = "";

      function chargeWords(n: number) {
        for (let i = 0; i < n; i++) {
          // Fire-and-forget. The throttled variant caps concurrent Circle
          // API calls at MAX_CONCURRENT_PAYMENTS and retries 429s internally
          // so we don't drop payments when the fan-out exceeds the rate
          // limit (seen at ~7+ concurrent signTypedData calls).
          payForPromptThrottled(sessionId!, 1).catch((err) => {
            // Still log — a failure after all retries means something
            // worse than a transient 429 (signature rejection, insufficient
            // Gateway balance, etc.).
            console.error("[api/chat] word payment failed:", err);
          });
        }
      }

      try {
        for await (const chunk of streamChat(messages)) {
          controller.enqueue(encoder.encode(chunk));
          buffer += chunk;
          const match = /\s[^\s]*$/.exec(buffer);
          if (match) {
            const committed = buffer.substring(0, match.index);
            buffer = buffer.substring(match.index + 1);
            const words = committed.split(/\s+/).filter((w) => w.length > 0);
            chargeWords(words.length);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        controller.enqueue(encoder.encode(`\n\n[error: ${message}]`));
      } finally {
        // The final token usually has no trailing whitespace — charge it too.
        const tail = buffer.trim();
        if (tail.length > 0) chargeWords(1);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
