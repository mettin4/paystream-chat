import { cookies } from "next/headers";

import { streamChat, type ChatMessage } from "@/lib/anthropic";
import { payForPromptThrottled, settleOnchainThrottled } from "@/lib/circle";
import {
  SESSION_COOKIE_NAME,
  verifySessionCookie,
} from "@/lib/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Payment model has two parallel tracks:
//
//   (1) Per-word Gateway authorization. Every word fires a fire-and-forget
//       payForPromptThrottled(sessionId, 1). These sign an EIP-3009
//       authorization via Circle Gateway and queue for batched async
//       settlement (Circle's batcher lands them on chain minutes-to-hours
//       later, originated by a Circle-controlled EOA — not by our operator).
//
//   (2) Periodic on-chain checkpoint. Every CHECKPOINT_EVERY_N_WORDS words,
//       a fire-and-forget settleOnchainThrottled fires a real W3S
//       createTransaction (USDC transfer from operator → recipient on Arc
//       Testnet) for CHECKPOINT_AMOUNT_USDC. These produce immediately-
//       visible 0x… tx hashes from our operator wallet on testnet.arcscan.app
//       — distinct from the Gateway flow, on its own concurrency budget.
//
// Both tracks land independently in sessions.json. The client polls
// /api/transactions and renders authorizations + settlements in separate UI
// surfaces.

const CHECKPOINT_EVERY_N_WORDS = 10;
const CHECKPOINT_AMOUNT_USDC = 0.001;

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
      // Cumulative word count for this stream — used to fire a checkpoint
      // settlement every CHECKPOINT_EVERY_N_WORDS. Tracked locally because
      // the client's word event counter resets per stream.
      let totalWords = 0;
      let nextCheckpointAt = CHECKPOINT_EVERY_N_WORDS;

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
        totalWords += n;
        while (totalWords >= nextCheckpointAt) {
          // Fire-and-forget. The throttled variant has its own concurrency
          // budget (cap 1) so checkpoints can't compete with the Gateway
          // flow. Each settlement is a real on-chain USDC transfer from
          // operator → recipient and lands in onchainSettlements with a
          // real 0x… hash.
          settleOnchainThrottled(
            sessionId!,
            CHECKPOINT_AMOUNT_USDC,
            CHECKPOINT_EVERY_N_WORDS
          ).catch((err) => {
            console.error("[api/chat] checkpoint settlement failed:", err);
          });
          nextCheckpointAt += CHECKPOINT_EVERY_N_WORDS;
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
