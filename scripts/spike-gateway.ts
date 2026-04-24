/**
 * Spike: Can Circle Developer-Controlled Wallets sign Nanopayments?
 *
 * THROWAWAY exploration. Not wired into the app. Do not import from /app or
 * /components.
 *
 * Question: Can we use a Circle W3S Developer-Controlled Wallet as the buyer
 * in Circle Nanopayments (x402 batched settlement), instead of a raw private
 * key?
 *
 * Method: static type-level analysis against the installed SDK d.ts files.
 * No live API calls — the types fully answer the question.
 *
 * Findings at the top, proof below.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TL;DR
 * ─────────────────────────────────────────────────────────────────────────
 * - The HIGH-LEVEL `GatewayClient` cannot be constructed from a W3S wallet.
 *   Its config is `{ chain, privateKey: Hex, rpcUrl? }` — no signer overload.
 *   W3S deliberately never exposes private keys, so this path is closed.
 *
 * - The LOW-LEVEL `BatchEvmScheme` path IS compatible. It accepts a
 *   `BatchEvmSigner` shaped `{ address, signTypedData(params) }`. W3S
 *   exposes `client.signTypedData({walletId, data, entitySecretCiphertext})`
 *   which returns a hex signature. A ~20-line adapter bridges the two.
 *
 * - Trade-off: `GatewayClient` gives us `.deposit()`, `.withdraw()`,
 *   `.getBalances()`, `.pay(url)` out of the box. Going via `BatchEvmScheme`
 *   means we lose those convenience methods and must drive the x402Client
 *   ourselves. We also take on serializing the EIP-712 payload exactly as
 *   Circle expects.
 */

import type { Address, Hex } from "viem";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";

// ─────────────────────────────────────────────────────────────────────────
// Attempt A — High-level GatewayClient
// ─────────────────────────────────────────────────────────────────────────
//
// `GatewayClient`'s config type (from @circle-fin/x402-batching/dist/client
// /index.d.ts):
//
//   interface GatewayClientConfig {
//     chain: SupportedChainName;
//     privateKey: Hex;        // ← the only signing input
//     rpcUrl?: string;
//   }
//
// W3S `client.createWallets(...)` returns objects of shape
// `{id, address, blockchain, ...}` — never a private key. Passing a W3S
// wallet to `GatewayClient` doesn't type-check, and no combination of W3S
// outputs can produce a `Hex` private key.

// Minimal shape of a W3S-created wallet — id + address, no key.
interface W3sWallet {
  id: string;
  address: Address;
  blockchain: string;
}

// The incompatibility proof: there is no shape of W3S output that can
// satisfy `privateKey: Hex`. If the @ts-expect-error below stops erroring,
// Circle changed the API.
const _wontCompile = new GatewayClient({
  chain: "arcTestnet",
  // @ts-expect-error — GatewayClient accepts `privateKey: Hex` only, no
  // signer/wallet overload. W3S deliberately never exposes private keys.
  wallet: {} as W3sWallet,
});

// ─────────────────────────────────────────────────────────────────────────
// Attempt B — Low-level BatchEvmScheme with a W3S-backed signer
// ─────────────────────────────────────────────────────────────────────────
//
// `BatchEvmScheme` accepts a `BatchEvmSigner` (re-declared locally here;
// the SDK exports it only under an obfuscated alias):
//
//   interface BatchEvmSigner {
//     address: Address;
//     signTypedData(params: {
//       domain: { name, version, chainId, verifyingContract };
//       types: Record<string, Array<{name, type}>>;
//       primaryType: string;
//       message: Record<string, unknown>;
//     }): Promise<Hex>;
//   }
//
// W3S's `signTypedData` input (from
// @circle-fin/developer-controlled-wallets/dist/types/clients/...d.ts):
//
//   interface SignTypedDataRequest {
//     walletId?: string;
//     data: string;                          // JSON-stringified EIP-712
//     entitySecretCiphertext: string;        // per-request rotated
//     blockchain?: Blockchain;
//     walletAddress?: string;
//   }
//
// Response: `{data: {signature: string}}` where signature is `0x...`.
//
// The bridge: stringify the viem-shaped EIP-712 payload, send to W3S, cast
// the returned signature to `Hex`. That's the adapter.

// Minimal shape of the injected W3S client — just the one method we need.
// In production this would be the real W3S SDK client.
interface W3sClient {
  signTypedData(input: {
    walletId: string;
    data: string;
    entitySecretCiphertext: string;
  }): Promise<{ data: { signature: string } }>;
}

// Deps the adapter needs to function at runtime.
interface AdapterDeps {
  w3s: W3sClient;
  walletId: string;
  address: Address;
  /** Per-request ciphertext generator — W3S mandates uniqueness per call. */
  generateCiphertext: () => Promise<string>;
}

// The adapter. Shape matches BatchEvmSigner exactly.
function makeW3sBatchEvmSigner(deps: AdapterDeps) {
  return {
    address: deps.address,
    async signTypedData(params: {
      domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: Address;
      };
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> {
      const data = JSON.stringify({
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      });

      const response = await deps.w3s.signTypedData({
        walletId: deps.walletId,
        data,
        entitySecretCiphertext: await deps.generateCiphertext(),
      });

      const sig = response.data.signature;
      if (!sig.startsWith("0x")) {
        throw new Error(`W3S returned non-hex signature: ${sig}`);
      }
      return sig as Hex;
    },
  };
}

// Compile-time proof: the adapter's return shape IS assignable to the
// parameter that `BatchEvmScheme` expects. If this line compiles, the
// low-level integration path works.
function _proveBatchEvmSchemeAccepts(deps: AdapterDeps): BatchEvmScheme {
  const signer = makeW3sBatchEvmSigner(deps);
  return new BatchEvmScheme(signer);
}

// ─────────────────────────────────────────────────────────────────────────
// Runtime sketch (commented — would need real CIRCLE_API_KEY + entity
// secret to execute, which is out of scope for a spike).
// ─────────────────────────────────────────────────────────────────────────
//
//   import { initiateDeveloperControlledWalletsClient } from
//     "@circle-fin/developer-controlled-wallets";
//   import { x402Client } from "@x402/core/client";
//   import { registerBatchScheme } from "@circle-fin/x402-batching/client";
//
//   const w3s = initiateDeveloperControlledWalletsClient({
//     apiKey: process.env.CIRCLE_API_KEY!,
//     entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
//   });
//
//   const walletResp = await w3s.createWallets({
//     walletSetId: process.env.CIRCLE_WALLET_SET_ID!,
//     blockchains: ["ARC-TESTNET"],
//     count: 1,
//     accountType: "EOA",
//   });
//   const wallet = walletResp.data!.wallets![0];
//
//   const signer = makeW3sBatchEvmSigner({
//     w3s,                                          // type-narrow in prod
//     walletId: wallet.id,
//     address: wallet.address as Address,
//     generateCiphertext: async () => {/* encrypt per Circle's pubkey */},
//   });
//
//   const payClient = new x402Client();
//   registerBatchScheme(payClient, { signer });
//
//   // Unresolved work for the main PR — none of these exist on BatchEvmScheme:
//   //   - One-time deposit from W3S wallet → Gateway Wallet contract
//   //     (normal EIP-1559 tx; call via w3s.createTransaction + W3S signing)
//   //   - Balance reads (call GatewayWallet contract directly via viem)
//   //   - Withdrawal (contract call or Gateway REST API)
//
//   // Each word/prompt payment:
//   const res = await payClient.pay("https://app/api/chat", { ... });

// Suppress unused warnings on demonstration bindings.
void _wontCompile;
void _proveBatchEvmSchemeAccepts;
