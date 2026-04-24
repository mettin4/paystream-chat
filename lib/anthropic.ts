import Anthropic from "@anthropic-ai/sdk";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local at the project root, " +
        "then restart the dev server so Next.js picks up the new value."
    );
  }
  return new Anthropic({ apiKey: key });
}

export async function* streamChat(
  messages: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
  const client = getClient();

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content);
  const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
  const turns = messages
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } =>
      m.role !== "system"
    )
    .map((m) => ({ role: m.role, content: m.content }));

  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system,
    messages: turns,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
