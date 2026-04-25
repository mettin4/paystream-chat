// Server-side Circle Nanopayments client.
// NEVER import this from a Client Component — CIRCLE_API_KEY and
// CIRCLE_ENTITY_SECRET would leak into the browser bundle. Only import from
// API routes, Server Components, or other server-only modules. Type-only
// imports (e.g. `import type { Transaction }`) are safe because TypeScript
// types are erased at compile time.

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  BatchEvmScheme,
  CHAIN_CONFIGS,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type { Address } from "viem";

import { makeW3sBatchEvmSigner } from "./circle-signer";
import { recordPayment, recordSettlement } from "./sessions";

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type Transaction = {
  id: string;
  hash: string;
  amount: number;
  timestamp: number;
  word?: string;
  status?: "pending" | "confirmed";
};

export type PaymentResult = {
  txHash: string;
  amountUsdc: number;
  wordCount: number;
  network: string;
};

// A real on-chain checkpoint settlement: 0x… tx hash from Arc, distinct from
// the per-word Gateway authorization UUIDs in PaymentResult.txHash.
export type SettlementResult = {
  txHash: `0x${string}`;
  amountUsdc: number;
  wordCount: number;
  network: string;
};

export type OnchainTx = {
  id: string;
  hash: string;
  amount: number;
  timestamp: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Configuration — lazy, env-driven
// ─────────────────────────────────────────────────────────────────────────

const CHAIN_NAME: SupportedChainName = "arcTestnet";
const PRICE_PER_WORD_USDC = 0.0001;
const USDC_DECIMALS = 6;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `${name} is not set. Add it to .env.local at the project root and ` +
        `restart the dev server.`
    );
  }
  return v;
}

function getOperatorConfig(): { walletId: string; address: Address } {
  return {
    walletId: requireEnv("CIRCLE_OPERATOR_WALLET_ID"),
    address: requireEnv("CIRCLE_OPERATOR_WALLET_ADDRESS") as Address,
  };
}

function getRecipientAddress(): Address {
  return requireEnv("CIRCLE_RECIPIENT_ADDRESS") as Address;
}

// ─────────────────────────────────────────────────────────────────────────
// Lazy singletons — instantiate on first use so the module can be imported
// without the env vars set (e.g. during `next build`).
// ─────────────────────────────────────────────────────────────────────────

type W3sClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let _w3s: W3sClient | null = null;
let _scheme: BatchEvmScheme | null = null;
let _facilitator: BatchFacilitatorClient | null = null;

function getW3s(): W3sClient {
  if (!_w3s) {
    _w3s = initiateDeveloperControlledWalletsClient({
      apiKey: requireEnv("CIRCLE_API_KEY"),
      entitySecret: requireEnv("CIRCLE_ENTITY_SECRET"),
    });
  }
  return _w3s;
}

function getScheme(): BatchEvmScheme {
  if (!_scheme) {
    const op = getOperatorConfig();
    const signer = makeW3sBatchEvmSigner({
      w3s: getW3s(),
      walletId: op.walletId,
      address: op.address,
    });
    _scheme = new BatchEvmScheme(signer);
  }
  return _scheme;
}

function getFacilitator(): BatchFacilitatorClient {
  if (!_facilitator) {
    // Gateway runs separate mainnet and testnet deployments. Each /supported
    // list is disjoint — mainnet advertises only mainnet chains (verifying
    // contract 0x77777777...), testnet only testnet chains (0x0077777d...).
    // Pointing at the wrong one yields `unsupported_network` from settle even
    // though the x402-batching SDK's CHAIN_CONFIGS lists both sides.
    //
    // Default to testnet since the spike is running on arcTestnet. Override
    // via CIRCLE_GATEWAY_URL when wiring mainnet.
    const url =
      process.env.CIRCLE_GATEWAY_URL ?? "https://gateway-api-testnet.circle.com";
    // No API key required — payment authorization signatures are the auth.
    _facilitator = new BatchFacilitatorClient({ url });
  }
  return _facilitator;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns the operator wallet's id and on-chain address. Reads from env
 * lazily so this is safe to call during dev-server startup checks.
 */
export function getOperatorWallet(): { id: string; address: Address } {
  const op = getOperatorConfig();
  return { id: op.walletId, address: op.address };
}

/**
 * Non-throwing variant for UI surfaces that should degrade gracefully when
 * env isn't configured (e.g. the top nav on first dev boot). Returns null
 * instead of crashing the layout render.
 */
export function getOperatorAddressSafe(): Address | null {
  const v = process.env.CIRCLE_OPERATOR_WALLET_ADDRESS;
  return v && v.trim() !== "" ? (v as Address) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency limiter + retry. Under the per-word payment model a single
// prompt fans out to ~100 parallel payForPrompt calls. Two distinct rate
// limits exist:
//
//   (a) W3S /v1/w3s/developer/sign/typedData — throws Error with status=429
//       when exceeded.
//   (b) Gateway /v1/x402/settle — when overloaded, its edge (Cloudflare)
//       returns an HTML error page. The BatchFacilitatorClient SDK then
//       tries JSON.parse on HTML and throws a SyntaxError ("Unexpected
//       token '<'") with NO status code. This is wrapped in our own
//       "Gateway settle HTTP failure: ..." error message.
//
// Strategy: cap concurrent in-flight sign+settle flows, and retry on either
// rate-limit signature (W3S status or Gateway HTML) with exponential backoff
// + jitter while holding the slot. Holding the slot during backoff dampens
// the retry storm — late arrivals queue behind backoff-ers rather than
// piling onto Circle.
// ─────────────────────────────────────────────────────────────────────────

const MAX_CONCURRENT_PAYMENTS = 4;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1500;

let inflight = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_CONCURRENT_PAYMENTS) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    const next = waiters.shift();
    if (next) next();
  }
}

function isRetriableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // W3S rate limit (structured).
  const status = (err as { status?: number }).status;
  if (status === 429 || (typeof status === "number" && status >= 500 && status < 600)) {
    return true;
  }
  // Gateway-side rate limit: the edge (Cloudflare) returns HTML, the
  // BatchFacilitatorClient SDK then JSON.parses it and throws a SyntaxError
  // that our payForPrompt wraps as "Gateway settle HTTP failure: ...".
  // Match on the visible symptom. We also match the SDK's raw "settle failed
  // (5xx)" message in case a status DOES propagate.
  const msg = (err as { message?: string }).message ?? "";
  return (
    /Unexpected token .*<.*doctype/i.test(msg) ||
    /not valid JSON/i.test(msg) ||
    /Gateway settle failed \(5\d\d\)/.test(msg) ||
    /Circle Gateway settle returned empty response/.test(msg)
  );
}

/**
 * Rate-limited variant of payForPrompt. Caps concurrent sign+settle flows
 * to avoid tripping Circle's W3S rate limit, and retries on 429 with
 * exponential backoff (1s → 2s → 4s → 8s + jitter). Prefer this over raw
 * payForPrompt for fan-out scenarios (e.g. per-word charging).
 */
export async function payForPromptThrottled(
  sessionId: string,
  wordCount: number
): Promise<PaymentResult> {
  return withSlot(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await payForPrompt(sessionId, wordCount);
      } catch (err) {
        lastErr = err;
        if (!isRetriableError(err) || attempt === MAX_RETRIES) throw err;
        const delay =
          BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  });
}

/**
 * Sign and settle a Nanopayment from the operator wallet to the configured
 * recipient, sized for `wordCount` words at $0.0001/word. Logs the payment
 * under `sessionId` and returns the settlement tx hash.
 *
 * Flow:
 *   1. Build EIP-712 payment requirements for Circle's GatewayWalletBatched.
 *   2. `BatchEvmScheme.createPaymentPayload` → W3S signs the EIP-3009 auth.
 *   3. `BatchFacilitatorClient.settle` → Circle verifies + batched settles.
 *   4. Persist the record to `.data/sessions.json`.
 *
 * Throws if settlement fails (e.g. insufficient Gateway balance — see
 * `scripts/deposit-operator.ts`).
 */
export async function payForPrompt(
  sessionId: string,
  wordCount: number
): Promise<PaymentResult> {
  if (wordCount <= 0) {
    throw new Error(`wordCount must be > 0, got ${wordCount}`);
  }

  const chain = CHAIN_CONFIGS[CHAIN_NAME];
  const network = `eip155:${chain.chain.id}`;
  const amountUsdc = wordCount * PRICE_PER_WORD_USDC;
  const op = getOperatorConfig();

  const requirements = {
    scheme: "exact",
    network,
    asset: chain.usdc,
    amount: atomicUsdc(amountUsdc),
    payTo: getRecipientAddress(),
    // x402's BatchEvmScheme uses this as:
    //   validAfter  = now - 600          (hardcoded 10-min backdate for skew)
    //   validBefore = now + maxTimeoutSeconds
    // Gateway's own middleware (node_modules/@circle-fin/x402-batching/dist/
    // server/index.js:501) uses 345600 (4 days) with the comment "Gateway
    // batches settlements asynchronously" — settlement can happen well after
    // we receive success, so the authorization must stay valid for days, not
    // minutes. A 60-second window yielded `authorization_validity_too_short`.
    maxTimeoutSeconds: 4 * 24 * 60 * 60,
    extra: {
      name: "GatewayWalletBatched" as const,
      version: "1" as const,
      verifyingContract: chain.gatewayWallet,
    },
  };

  // 1 + 2: create and sign the payload.
  const payload = await getScheme().createPaymentPayload(1, requirements);

  // 3: submit for verify + settle. The facilitator's PaymentPayload type
  // is nominally distinct but structurally compatible with the scheme's
  // output; cast through `unknown` to bridge the subpath boundary.
  //
  // `resource` and `accepted` are marked optional in the PaymentPayload TS
  // type but Gateway's runtime validator requires them — they're normally
  // populated by the 402 HTTP flow (server sends `accepts: [...]`, client
  // echoes back the chosen one as `accepted`). Since we're calling settle
  // directly, we construct both: `accepted` is the same requirements we
  // pass as the second argument, and `resource` identifies what's being
  // paid for.
  //
  // Two failure modes to distinguish:
  //   (a) HTTP-level / transport — BatchFacilitatorClient.settle throws with
  //       `Circle Gateway settle failed (${status}): ${body}`. Catch + augment
  //       with our request context, then rethrow.
  //   (b) Structured — response parsed OK but `success: false`. The
  //       `errorReason` field is optional on Gateway's side and is often
  //       empty for unsuccessful settlements, so log the whole response
  //       object (payer, transaction, network) for diagnostic value.
  const paymentPayload = {
    x402Version: payload.x402Version,
    resource: {
      url: `paystream://chat/${sessionId}`,
      description: `PayStream Chat — ${wordCount} word${wordCount === 1 ? "" : "s"}`,
      mimeType: "application/json",
    },
    accepted: requirements as unknown as Record<string, unknown>,
    payload: payload.payload as unknown as Record<string, unknown>,
  };

  let settleResult;
  try {
    settleResult = await getFacilitator().settle(paymentPayload, requirements);
  } catch (err) {
    const context = {
      operator: op.address,
      recipient: requirements.payTo,
      verifyingContract: requirements.extra.verifyingContract,
      amountAtomic: requirements.amount,
      network: requirements.network,
      nonce: (payload.payload as { authorization?: { nonce?: string } })
        .authorization?.nonce,
    };
    // eslint-disable-next-line no-console
    console.error("[payForPrompt] settle threw. Request context:", context);
    throw new Error(
      `Gateway settle HTTP failure: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }

  if (!settleResult.success) {
    // Dump the whole response — Gateway sometimes leaves errorReason empty
    // and puts hints in payer/transaction/network fields.
    // eslint-disable-next-line no-console
    console.error("[payForPrompt] settle returned success=false:", settleResult);

    const reason = settleResult.errorReason ?? "";
    const lower = reason.toLowerCase();
    const isBalance =
      lower.includes("insufficient") ||
      lower.includes("balance") ||
      lower.includes("available");

    const hint = isBalance
      ? `\nLikely cause: operator wallet ${op.address} has no (or too little) USDC deposited in GatewayWallet ${requirements.extra.verifyingContract} on ${requirements.network}. ` +
        `Deposit at least ${requirements.amount} atomic USDC (~${amountUsdc} USDC for this call) via USDC.approve + GatewayWallet.deposit. See scripts/deposit-operator.ts.`
      : `\nFull response: ${JSON.stringify(settleResult)}`;

    throw new Error(
      `Gateway settle failed: ${reason || "(empty errorReason)"}${hint}`
    );
  }

  const result: PaymentResult = {
    txHash: settleResult.transaction,
    amountUsdc,
    wordCount,
    network: settleResult.network,
  };

  // 4: persist. Errors here don't unwind the onchain settlement.
  await recordPayment(sessionId, {
    timestamp: Date.now(),
    wordCount,
    amountUsdc,
    txHash: result.txHash,
    network: result.network,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function atomicUsdc(decimal: number): string {
  const atomic = Math.round(decimal * 10 ** USDC_DECIMALS);
  return atomic.toString();
}

// ─────────────────────────────────────────────────────────────────────────
// On-chain checkpoint settlements (parallel to the Gateway authorization
// flow above). Every N words emitted, the chat route fires one of these to
// produce a real, immediately-visible USDC transfer on Arc Testnet, so the
// operator wallet's explorer page shows on-chain activity per chat — not
// just the eventual batched Gateway settlements (which can land 10+ minutes
// later under a different originator address).
//
// Mechanism: W3S `createTransaction` (USDC native transfer from operator →
// recipient), then poll `getTransaction` until state ∈ {CONFIRMED, COMPLETE}
// and read back the real txHash.
//
// Concurrency: a single EOA has one nonce. W3S serializes per-wallet
// internally (Initiated → Queued → Sent), so > 1 in-flight buys nothing and
// just adds 429 risk. Cap at 1.
// ─────────────────────────────────────────────────────────────────────────

const ONCHAIN_BLOCKCHAIN = "ARC-TESTNET" as const;
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const ONCHAIN_POLL_MS = 2000;
const ONCHAIN_TIMEOUT_MS = 90_000;

let onchainInflight = 0;
const onchainWaiters: Array<() => void> = [];

async function withOnchainSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (onchainInflight >= 1) {
    await new Promise<void>((resolve) => onchainWaiters.push(resolve));
  }
  onchainInflight++;
  try {
    return await fn();
  } finally {
    onchainInflight--;
    const next = onchainWaiters.shift();
    if (next) next();
  }
}

/**
 * Throttled wrapper. Identical retry policy to payForPromptThrottled but on
 * its own concurrency budget so it can't compete with the Gateway flow.
 */
export async function settleOnchainThrottled(
  sessionId: string,
  amountUsdc: number,
  wordCount: number
): Promise<SettlementResult> {
  return withOnchainSlot(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await settleOnchain(sessionId, amountUsdc, wordCount);
      } catch (err) {
        lastErr = err;
        if (!isRetriableError(err) || attempt === MAX_RETRIES) throw err;
        const delay =
          BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  });
}

/**
 * Submit a real USDC transfer on Arc via W3S, then poll until the on-chain
 * tx hash is available. Throws if the transaction fails, is denied, or the
 * timeout elapses before W3S reports a hash.
 *
 * `wordCount` is metadata only — it labels the settlement as covering the
 * last N words emitted by the model. The amount is what actually moves.
 */
export async function settleOnchain(
  sessionId: string,
  amountUsdc: number,
  wordCount: number
): Promise<SettlementResult> {
  if (amountUsdc <= 0) {
    throw new Error(`amountUsdc must be > 0, got ${amountUsdc}`);
  }

  const op = getOperatorConfig();
  const recipient = getRecipientAddress();
  const w3s = getW3s();

  // W3S createTransaction accepts two input variants. The `walletId` variant
  // forbids an outer `blockchain` field at the type level (even though the
  // runtime API tolerates `walletId + tokenAddress + blockchain`), so we use
  // the `walletAddress + blockchain + tokenAddress` variant — same wallet,
  // identified by EOA address rather than UUID. Both resolve to the same
  // developer-controlled wallet on Circle's side.
  const created = await w3s.createTransaction({
    walletAddress: op.address,
    blockchain: ONCHAIN_BLOCKCHAIN,
    tokenAddress: ARC_TESTNET_USDC,
    amount: [amountUsdc.toString()],
    destinationAddress: recipient,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    // Per-call random key so a transient failure mid-create doesn't double-
    // submit on retry. (Retries inside settleOnchainThrottled re-call this
    // function, getting a fresh key — that's intentional: the prior attempt
    // either created the tx or it didn't, but if we got an error back we
    // can't tell, so a fresh key is the safe default.)
    idempotencyKey: cryptoRandomUuid(),
  });

  const txId = created.data?.id;
  if (!txId) {
    throw new Error(
      `W3S createTransaction returned no id. Response: ${JSON.stringify(created)}`
    );
  }

  const start = Date.now();
  let hash: string | undefined;
  let lastState: string | undefined;
  while (Date.now() - start < ONCHAIN_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, ONCHAIN_POLL_MS));
    const got = await w3s.getTransaction({ id: txId });
    const tx = got.data?.transaction;
    if (!tx) continue;
    lastState = tx.state;
    if (tx.state === "FAILED" || tx.state === "DENIED" || tx.state === "CANCELLED") {
      throw new Error(
        `W3S transaction ${txId} terminal state=${tx.state} (txHash=${tx.txHash ?? "none"})`
      );
    }
    if (tx.txHash && (tx.state === "CONFIRMED" || tx.state === "COMPLETE" || tx.state === "SENT")) {
      // SENT means broadcast — the txHash is real and the tx is in the
      // mempool. CONFIRMED/COMPLETE mean it's mined. Any of these are good
      // enough to surface in the UI; the hash will resolve on the explorer
      // either immediately or within a block.
      hash = tx.txHash;
      break;
    }
  }

  if (!hash) {
    throw new Error(
      `W3S transaction ${txId} timed out after ${ONCHAIN_TIMEOUT_MS}ms (last state=${lastState ?? "unknown"})`
    );
  }

  if (!hash.startsWith("0x")) {
    throw new Error(`W3S returned non-hex txHash: ${hash}`);
  }

  const result: SettlementResult = {
    txHash: hash as `0x${string}`,
    amountUsdc,
    wordCount,
    network: `eip155:${CHAIN_CONFIGS[CHAIN_NAME].chain.id}`,
  };

  await recordSettlement(sessionId, {
    timestamp: Date.now(),
    wordCount,
    amountUsdc,
    txHash: result.txHash,
    network: result.network,
  });

  return result;
}

function cryptoRandomUuid(): string {
  // Node 19+ exposes globalThis.crypto.randomUUID. Falls back to a manual
  // generator only if (somehow) unavailable.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // RFC 4122 v4 fallback
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = (n: number) => n.toString(16).padStart(2, "0");
  const seg = (start: number, end: number) =>
    Array.from(b.slice(start, end)).map(h).join("");
  return `${seg(0, 4)}-${seg(4, 6)}-${seg(6, 8)}-${seg(8, 10)}-${seg(10, 16)}`;
}
