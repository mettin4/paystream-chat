// Diagnostic: send one Nanopayment via the production code path, then track
// what actually happens on-chain. Prints every transition with timestamps.
//
//   npx tsx scripts/diagnose-settlement.ts
//
// What it answers:
//   - What does Gateway's settle response actually contain? (UUID vs hash)
//   - Does the transfer transition received → batched → completed?
//   - How long does on-chain settlement actually take?
//   - Does an actual USDC Transfer event appear on Arc?

import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  const p = process as typeof process & { loadEnvFile?: (path: string) => void };
  if (!p.loadEnvFile) {
    console.error(`Need Node 20.6+ for process.loadEnvFile. Got ${process.version}.`);
    process.exit(1);
  }
  p.loadEnvFile(".env.local");
}

import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { getOperatorWallet, payForPrompt } from "../lib/circle";

const GATEWAY = "https://gateway-api-testnet.circle.com/v1";
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const RPC = "https://rpc.testnet.arc.network";
const POLL_MS = 30_000;
const MAX_MIN = 10;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

function ts() {
  return new Date().toISOString().slice(11, 19);
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function main() {
  const op = getOperatorWallet();
  const recipient = process.env.CIRCLE_RECIPIENT_ADDRESS as Address;
  console.log(`[${ts()}] operator W3S id : ${op.id}`);
  console.log(`[${ts()}] operator address: ${op.address}`);
  console.log(`[${ts()}] recipient       : ${recipient}`);
  console.log(`[${ts()}] usdc contract   : ${USDC}`);
  console.log("");

  const rpc = createPublicClient({
    chain: arcTestnet,
    transport: http(RPC),
  });
  const blockBefore = await rpc.getBlockNumber();
  console.log(`[${ts()}] arc block before settle: ${blockBefore}`);
  console.log("");

  console.log(`[${ts()}] calling payForPrompt('diagnose', 1)…`);
  const t0 = Date.now();
  const result = await payForPrompt("diagnose", 1);
  const settleMs = Date.now() - t0;
  console.log(`[${ts()}] settle returned in ${settleMs}ms`);
  console.log(`[${ts()}] PaymentResult:`, JSON.stringify(result, null, 2));

  const transferId = result.txHash;
  const isHash = /^0x[a-f0-9]{64}$/i.test(transferId);
  console.log(
    `[${ts()}] settleResult.transaction is ${
      isHash ? "an on-chain hash (0x… 64 hex)" : "NOT an on-chain hash (looks like a UUID)"
    }`
  );
  console.log("");

  let lastStatus: string | null = null;
  const start = Date.now();
  let completedRecord: Record<string, unknown> | null = null;

  while (Date.now() - start < MAX_MIN * 60_000) {
    let body: Record<string, unknown>;
    try {
      body = (await fetchJson(`${GATEWAY}/x402/transfers/${transferId}`)) as Record<
        string,
        unknown
      >;
    } catch (err) {
      console.log(`[${ts()}] poll error:`, err instanceof Error ? err.message : err);
      await sleep(POLL_MS);
      continue;
    }
    const status = String(body.status);
    if (status !== lastStatus) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[${ts()}] +${elapsed}s status="${status}"`);
      console.log(`           full record: ${JSON.stringify(body)}`);
      lastStatus = status;
    }
    if (status === "completed" || status === "failed") {
      completedRecord = body;
      break;
    }
    await sleep(POLL_MS);
  }

  if (!completedRecord) {
    console.log("");
    console.log(
      `[${ts()}] timed out after ${MAX_MIN}min — last status="${lastStatus}"`
    );
    console.log(
      "  Authorization is signed and queued at Gateway. It WILL settle eventually"
    );
    console.log(
      "  (validity window is 4 days), but not within this diagnostic window."
    );
    return;
  }

  console.log("");
  console.log(`[${ts()}] looking for on-chain USDC Transfer event…`);
  const blockAfter = await rpc.getBlockNumber();
  console.log(`[${ts()}] arc block after completion: ${blockAfter}`);

  const logs = await rpc.getLogs({
    address: USDC,
    event: TRANSFER_EVENT,
    args: { to: recipient },
    fromBlock: blockBefore,
    toBlock: blockAfter,
  });
  console.log(`[${ts()}] found ${logs.length} Transfer→recipient logs in window`);
  for (const l of logs) {
    console.log(
      `  block ${l.blockNumber} tx ${l.transactionHash} from=${l.args.from} value=${l.args.value}`
    );
  }

  const matches = logs.filter((l) => l.args.value === 100n);
  if (matches.length > 0) {
    console.log("");
    console.log(`[${ts()}] CANDIDATES for our 0.0001 USDC settlement (value=100):`);
    for (const l of matches) {
      console.log(
        `  https://testnet.arcscan.app/tx/${l.transactionHash} (from ${l.args.from}, block ${l.blockNumber})`
      );
    }
    console.log("");
    console.log(
      "Note: each 'from' here is the Circle batcher EOA that executed " +
        "transferWithAuthorization, NOT our operator wallet. Our operator only " +
        "signed the EIP-3009 authorization off-chain via W3S."
    );
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
