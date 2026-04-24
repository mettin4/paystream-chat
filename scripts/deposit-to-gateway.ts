// One-time: deposit USDC from the operator wallet into Circle's GatewayWallet
// contract on arcTestnet, so Nanopayments settlement has a balance to debit.
//
// Two sequential transactions via W3S `createContractExecutionTransaction`:
//   (1) USDC.approve(GatewayWallet, 10_000_000)        ← 10 USDC atomic
//   (2) GatewayWallet.deposit(USDC, 10_000_000)        ← credits msg.sender
//
// GatewayWallet has two entry points: `deposit(token,value)` credits the
// caller, and `depositFor(token,depositor,value)` credits someone else.
// Since the operator wallet is both the msg.sender and the address we want
// debited on settlement, `deposit` is the right one — no need to specify
// the depositor explicitly.
//
// We poll `getTransaction` between the two so the approval is on-chain before
// the deposit attempts to spend the allowance.
//
// Run with:
//   npx tsx scripts/deposit-to-gateway.ts

import { existsSync } from "node:fs";
import crypto from "node:crypto";

// Load .env.local at startup. Node 20.6+ has this built in.
if (existsSync(".env.local")) {
  const p = process as typeof process & {
    loadEnvFile?: (path: string) => void;
  };
  if (!p.loadEnvFile) {
    console.error(
      `process.loadEnvFile unavailable (requires Node 20.6+). Your version: ${process.version}.`
    );
    process.exit(1);
  }
  p.loadEnvFile(".env.local");
}

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// ─────────────────────────────────────────────────────────────────────────
// Constants for Arc Testnet (sourced from CHAIN_CONFIGS.arcTestnet).
// ─────────────────────────────────────────────────────────────────────────

const USDC = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const AMOUNT_ATOMIC = "10000000"; // 10 USDC (6 decimals)

const EXPLORER =
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ??
  "https://testnet.arcscan.app";

// Circle SDK polling settings. Contract executions on testnet typically
// confirm in < 30s; we cap at 3 min to be safe.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

// ─────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`ERROR: ${name} is not set in .env.local.`);
    process.exit(1);
  }
  return v;
}

type W3sClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

async function waitForTx(
  w3s: W3sClient,
  id: string,
  label: string
): Promise<string> {
  const started = Date.now();
  let lastState = "";
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await w3s.getTransaction({ id });
    const tx = res.data?.transaction;
    const state = tx?.state ?? "UNKNOWN";
    if (state !== lastState) {
      console.log(`  [${label}] state=${state}${tx?.txHash ? ` txHash=${tx.txHash}` : ""}`);
      lastState = state;
    }
    if (state === "CONFIRMED" || state === "COMPLETE") {
      if (!tx?.txHash) {
        throw new Error(
          `[${label}] reached ${state} but txHash is missing: ${JSON.stringify(tx)}`
        );
      }
      return tx.txHash;
    }
    if (state === "FAILED" || state === "DENIED" || state === "CANCELLED") {
      throw new Error(
        `[${label}] terminal state=${state}. Full transaction: ${JSON.stringify(tx)}`
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `[${label}] timed out after ${POLL_TIMEOUT_MS}ms waiting for confirmation (id=${id})`
  );
}

async function submit(
  w3s: W3sClient,
  walletId: string,
  label: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: Array<string | number | boolean>
): Promise<string> {
  console.log(`\n→ ${label}`);
  console.log(`  contract: ${contractAddress}`);
  console.log(`  fn:       ${abiFunctionSignature}`);
  console.log(`  args:     ${JSON.stringify(abiParameters)}`);

  const created = await w3s.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: {
      type: "level",
      config: { feeLevel: "HIGH" },
    },
    idempotencyKey: crypto.randomUUID(),
  });

  const txId = created.data?.id;
  if (!txId) {
    throw new Error(
      `[${label}] createContractExecutionTransaction returned no id: ${JSON.stringify(created)}`
    );
  }
  console.log(`  tx id:    ${txId}`);

  return await waitForTx(w3s, txId, label);
}

async function main() {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
  const walletId = requireEnv("CIRCLE_OPERATOR_WALLET_ID");
  const operatorAddress = requireEnv("CIRCLE_OPERATOR_WALLET_ADDRESS");

  const w3s = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  console.log("Depositing USDC into GatewayWallet on Arc Testnet");
  console.log("  operator:       ", operatorAddress);
  console.log("  walletId:       ", walletId);
  console.log("  USDC:           ", USDC);
  console.log("  GatewayWallet:  ", GATEWAY_WALLET);
  console.log("  amount (atomic):", AMOUNT_ATOMIC, "(10 USDC)");

  // 1: USDC.approve(GatewayWallet, amount)
  const approveTxHash = await submit(
    w3s,
    walletId,
    "approve",
    USDC,
    "approve(address,uint256)",
    [GATEWAY_WALLET, AMOUNT_ATOMIC]
  );
  console.log(`  approve tx:     ${approveTxHash}`);
  console.log(`  explorer:       ${EXPLORER}/tx/${approveTxHash}`);

  // 2: GatewayWallet.deposit(token, value) — credits msg.sender, which is
  // the operator wallet. No depositor arg needed.
  const depositTxHash = await submit(
    w3s,
    walletId,
    "deposit",
    GATEWAY_WALLET,
    "deposit(address,uint256)",
    [USDC, AMOUNT_ATOMIC]
  );
  console.log(`  deposit tx:     ${depositTxHash}`);
  console.log(`  explorer:       ${EXPLORER}/tx/${depositTxHash}`);

  console.log("\nDone. The operator now has a Gateway balance to settle against.");
  console.log("Next: npx tsx scripts/test-payment.ts");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
