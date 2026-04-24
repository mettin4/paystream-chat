// W3S → BatchEvmSigner adapter.
//
// Circle's Nanopayments SDK (`BatchEvmScheme`) needs a signer that implements
// `{ address, signTypedData(params) }` — the same shape viem's `Account` has.
// W3S Developer-Controlled Wallets expose `client.signTypedData({walletId,
// data})` which signs EIP-712 payloads via Circle's remote signing API (the
// private key never leaves Circle's HSM). This file bridges the two.

import type { Address, Hex } from "viem";
import type { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

type W3sClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export interface W3sSignerDeps {
  w3s: W3sClient;
  walletId: string;
  address: Address;
}

// EIP-712 canonical field order + types. The standard permits any subset of
// these to appear in the domain; we declare exactly the fields that are
// present so the struct hash matches what the verifying contract expects.
const EIP712_DOMAIN_FIELDS: Array<{ name: string; type: string }> = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

function deriveEip712DomainType(
  domain: Record<string, unknown>
): Array<{ name: string; type: string }> {
  return EIP712_DOMAIN_FIELDS.filter((f) => domain[f.name] !== undefined);
}

export function makeW3sBatchEvmSigner(deps: W3sSignerDeps) {
  return {
    address: deps.address,

    async signTypedData(params: {
      domain: {
        name?: string;
        version?: string;
        chainId?: number;
        verifyingContract?: Address;
        salt?: Hex;
      };
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> {
      // W3S's typed-data validator is stricter than viem's local signer:
      // it requires `EIP712Domain` declared explicitly in `types`, matching
      // the fields actually present on `domain`. viem derives it implicitly
      // when signing locally, so x402's BatchEvmScheme omits it (see
      // node_modules/@circle-fin/x402-batching/dist/client/index.js:70 — only
      // TransferWithAuthorization is declared). Circle's own BurnIntent path
      // in the same file (line 1057) does declare EIP712Domain when hitting
      // W3S — confirming the asymmetry. Without this, W3S returns code 156026
      // "extra data provided in the message (0 < 4)".
      const types = params.types.EIP712Domain
        ? params.types
        : { EIP712Domain: deriveEip712DomainType(params.domain), ...params.types };

      // EIP-712 / EIP-3009 fields like chainId, value, validAfter, validBefore
      // arrive as BigInts, which JSON.stringify can't serialize — coerce them
      // to decimal strings (the canonical JSON-RPC representation for uint256).
      const data = JSON.stringify(
        {
          domain: params.domain,
          types,
          primaryType: params.primaryType,
          message: params.message,
        },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value)
      );

      const response = await deps.w3s.signTypedData({
        walletId: deps.walletId,
        data,
      });

      const sig = response.data?.signature;
      if (!sig || !sig.startsWith("0x")) {
        throw new Error(
          `W3S returned an unexpected signature shape: ${JSON.stringify(response)}`
        );
      }
      return sig as Hex;
    },
  };
}
