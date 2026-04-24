// Standalone test for the payment layer. Run with:
//   npx tsx scripts/test-payment.ts
//
// Does not touch the chat flow — just exercises `payForPrompt` end-to-end so
// we can verify the W3S adapter, Circle Gateway settlement, and the sessions
// log before wiring anything to /api/chat.
//
// Prerequisites (see .env.example + lib/circle.ts):
//   CIRCLE_API_KEY
//   CIRCLE_ENTITY_SECRET
//   CIRCLE_OPERATOR_WALLET_ID
//   CIRCLE_OPERATOR_WALLET_ADDRESS
//   CIRCLE_RECIPIENT_ADDRESS
//
// Also: the operator wallet must have USDC deposited into the GatewayWallet
// contract on arcTestnet (see scripts/deposit-operator.ts or Circle Console).

import { existsSync } from "node:fs";

// Load .env.local at startup. Node 20.6+ has this built in, so we don't need
// a dotenv dep. tsx doesn't auto-load env files the way `next dev` does.
if (existsSync(".env.local")) {
  const p = process as typeof process & {
    loadEnvFile?: (path: string) => void;
  };
  if (!p.loadEnvFile) {
    console.error(
      `process.loadEnvFile unavailable (requires Node 20.6+). Your version: ${process.version}.\n` +
        `Either upgrade Node or pass env vars inline.`
    );
    process.exit(1);
  }
  p.loadEnvFile(".env.local");
}

import { getOperatorWallet, payForPrompt } from "../lib/circle";

async function main() {
  const wordCount = Number(process.argv[2] ?? "10");
  const sessionId = process.argv[3] ?? "test-session";

  console.log("Operator:", getOperatorWallet());
  console.log(`Paying for ${wordCount} words under session="${sessionId}"…`);

  const start = Date.now();
  const result = await payForPrompt(sessionId, wordCount);
  const ms = Date.now() - start;

  console.log("Settlement OK in", ms, "ms");
  console.log(result);
  console.log(
    `Explorer: ${
      process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ??
      "https://testnet.arcscan.app"
    }/tx/${result.txHash}`
  );
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
