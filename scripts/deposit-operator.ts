// One-time: deposit USDC from the operator wallet into Circle's GatewayWallet
// contract on arcTestnet so it can be used for Nanopayments.
//
// The on-chain flow is two txs: (1) USDC.approve(GatewayWallet, amount),
// (2) GatewayWallet.deposit(USDC, amount, depositor=operatorAddress).
//
// The BatchEvmScheme / BatchFacilitatorClient path does NOT cover this —
// it's a regular contract call, not an EIP-3009 signature. Two options to
// execute it:
//
//   (A) Via Circle Console — manually trigger a contract execution from
//       the operator wallet. Fastest if you already use Console.
//
//   (B) Via W3S SDK's `createContractExecutionTransaction`. Requires the
//       ABI and function args for approve + deposit. Left as TODO below —
//       tackle this only if you prefer automation.
//
// Addresses and amounts you'll need for option (A):

import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";

const chain = CHAIN_CONFIGS.arcTestnet;
console.log("Chain:        arcTestnet (eip155:" + chain.chain.id + ")");
console.log("USDC:         ", chain.usdc);
console.log("GatewayWallet:", chain.gatewayWallet);
console.log("GatewayMinter:", chain.gatewayMinter);
console.log("");
console.log("To deposit via Circle Console:");
console.log("  1. Approve USDC (above) to spender GatewayWallet (above)");
console.log("     for an amount large enough to cover expected payments");
console.log("     (e.g. 10 USDC = 10_000_000 atomic units).");
console.log("  2. Call GatewayWallet.deposit(token=USDC, value=<atomic>,");
console.log("     depositor=<operator address>).");
console.log("");
console.log("TODO: automate via w3s.createContractExecutionTransaction.");
