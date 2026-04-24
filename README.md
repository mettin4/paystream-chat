# PayStream

**Pay per word, not per month.**

_If data streams, money should too._

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?style=flat-square)](https://paystream-chat.vercel.app)
[![Hackathon](https://img.shields.io/badge/Agentic%20Economy%20on%20Arc-2026-blue?style=flat-square)](https://lablab.ai)
[![Arc Testnet](https://img.shields.io/badge/Arc%20Testnet-5042002-purple?style=flat-square)](https://testnet.arcscan.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square)](https://nextjs.org)

---

## What is PayStream?

PayStream is a pay-per-word AI chat app. You pay **$0.0001 USDC per word the model writes**, settled on-chain while the response is still streaming.

Every word triggers a Circle Nanopayment on Arc Testnet via an EIP-3009 authorization signed by a Circle Developer-Controlled Wallet. Stop the response mid-stream and the payments stop with it. You pay for what the model produced, not a flat subscription.

This is the Agentic Economy on Arc thesis in practice: machines paying machines in real time, with sub-cent transactions no traditional rail can support. One chat response typically produces 100+ authorizations batched into several on-chain settlements, all visible on the Arc Block Explorer.

---

## Why nanopayments?

Traditional rails (Stripe, Visa, ACH) have per-transaction floors measured in cents, not tenths of a cent. A $0.0001 payment sits below their cost floor, and most L1s can't clear sub-cent micropayments once gas is factored in.

Arc makes $0.0001 a meaningful unit of value. Circle's Gateway then batches hundreds of authorizations into a single on-chain transaction without losing per-authorization granularity, which is what makes per-token pricing viable.

---

## Demo

> **Live:** [paystream-chat.vercel.app](https://paystream-chat.vercel.app)

![PayStream demo screenshot](docs/screenshot.png)

_Ask the model anything. The word counter ticks up, the USDC total climbs, and new tx hashes land in the feed, each one clickable into [testnet.arcscan.app](https://testnet.arcscan.app)._

---

## How it works

```
┌─────────┐    prompt     ┌──────────────┐   stream   ┌────────────────┐
│ Browser │ ────────────▶ │ Next.js API  │ ─────────▶ │ Anthropic      │
└─────────┘               │ /api/chat    │            │ Claude Haiku   │
     ▲                    └──────┬───────┘            └────────────────┘
     │                           │ per word
     │                           ▼
     │                    ┌──────────────┐   EIP-3009   ┌──────────────┐
     │   SSE token +      │ Circle       │   signature  │ Circle       │
     └── tx-hash events ◀─│ Nanopayment  │ ◀──────────▶ │ W3S Wallet   │
                          │ Batcher      │              │ (server-side)│
                          └──────┬───────┘              └──────────────┘
                                 │ settle batch
                                 ▼
                          ┌──────────────────────────────────────────┐
                          │ Circle Gateway  →  Arc Testnet (5042002) │
                          └──────────────────────────────────────────┘
```

1. User sends a prompt.
2. Backend streams the response from Claude Haiku.
3. Each word triggers a nanopayment authorization at $0.0001 USDC.
4. Authorizations are signed as EIP-3009 `transferWithAuthorization` payloads inside W3S, so the key stays in Circle custody.
5. Circle Gateway batches and settles them on Arc Testnet.
6. SSE pushes each new tx hash to the browser as settlements confirm.

---

## Tech Stack

| Layer          |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Frontend**   | Next.js 14 (App Router), TypeScript, Tailwind, react-markdown  |
| **AI**         | Anthropic Claude Haiku (`@anthropic-ai/sdk`)                   |
| **Payments**   | Circle Nanopayments, Circle Developer-Controlled Wallets (W3S) |
| **Batching**   | `@circle-fin/x402-batching`, `@x402/core`, `@x402/evm`         |
| **Chain**      | Arc Testnet (5042002)                                          |
| **Settlement** | Circle Gateway, EIP-3009 `transferWithAuthorization`           |
| **Signing**    | `viem` for EIP-712 typed-data                                  |
| **Explorer**   | [testnet.arcscan.app](https://testnet.arcscan.app)             |

---

## Architecture

The server merges three streams into one SSE channel: the LLM token stream from Anthropic, a per-word payment-authorization stream, and settlement confirmations from Circle Gateway. The frontend consumes all three and renders them as the streaming message, a live USDC counter, and the tx feed.

The one non-obvious piece is the W3S to `BatchEvmScheme` adapter in [lib/circle-signer.ts](./lib/circle-signer.ts). Circle's W3S SDK doesn't expose private keys; the x402 batcher expects one. The adapter wraps `signTypedData` calls through W3S so both SDKs work together without leaking the key.

---

## Hackathon Submission Criteria

- ✅ Circle Nanopayments integration, real not mocked
- ✅ Settlement on Arc Testnet (5042002)
- ✅ Sub-cent per-action pricing: $0.0001 USDC per word
- ✅ 50+ on-chain authorizations per typical demo session. Each word is a separate EIP-3009 authorization; Gateway batches them into multiple settlements visible on the operator wallet's Arc Explorer page.
- ✅ Every settlement is a clickable tx hash linking to the Arc Block Explorer

---

## Local Setup

### Prerequisites

- Node.js 20+
- Circle Console account with three sandbox wallets on **ARC-TESTNET**
- USDC in the operator wallet's GatewayWallet position (see [scripts/deposit-to-gateway.ts](./scripts/deposit-to-gateway.ts))
- Anthropic API key

### Steps

```bash
# 1. Clone
git clone https://github.com/mettin4/paystream-chat.git
cd paystream-chat

# 2. Install
npm install

# 3. Configure
cp .env.example .env.local
# fill in the values listed below
```

Required env vars (all server-side; `NEXT_PUBLIC_` is the one bundled into the browser and must remain non-secret):

| Variable                           | What it is                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `CIRCLE_API_KEY`                   | Sandbox API key from [console.circle.com](https://console.circle.com)               |
| `CIRCLE_ENTITY_SECRET`             | 32-byte hex entity secret, registered via `registerEntitySecretCiphertext`          |
| `CIRCLE_OPERATOR_WALLET_ID`        | UUID of the wallet that funds user prompts                                          |
| `CIRCLE_OPERATOR_WALLET_ADDRESS`   | On-chain address of that operator wallet                                            |
| `CIRCLE_RECIPIENT_ADDRESS`         | Address that receives nanopayments (must differ from operator)                      |
| `NEXT_PUBLIC_ARC_EXPLORER_URL`     | Arc block explorer base URL, e.g. `https://testnet.arcscan.app`                     |
| `ANTHROPIC_API_KEY`                | Anthropic API key from [console.anthropic.com](https://console.anthropic.com)       |

```bash
# 4. First time only: fund the operator's Gateway position
npx tsx scripts/deposit-to-gateway.ts

# 5. Run
npm run dev

# 6. Open http://localhost:3000
```

---

## Project Structure

```
paystream-chat/
├── app/
│   ├── api/
│   │   ├── chat/            # SSE endpoint: streams tokens + payments together
│   │   └── transactions/    # Recent on-chain tx feed
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ChatInterface.tsx    # Streaming chat UI, consumes SSE
│   ├── PaymentCounter.tsx   # Live word count + USDC total
│   └── TransactionFeed.tsx  # Live tx-hash feed, linked to arcscan
├── lib/
│   ├── anthropic.ts         # Claude Haiku streaming client
│   ├── circle.ts            # Circle W3S + x402 batcher setup
│   ├── circle-signer.ts     # W3S to BatchEvmScheme adapter
│   ├── sessions.ts          # Per-session payment accounting
│   └── session-cookie.ts
├── scripts/
│   ├── deposit-to-gateway.ts          # Fund the operator's Gateway position
│   ├── deposit-operator.ts            # On-chain USDC top-up
│   ├── generate-entity-secret-ciphertext.ts
│   ├── spike-gateway.ts               # Manual Gateway smoke test
│   └── test-payment.ts                # Single-authorization round-trip
├── middleware.ts            # Session cookie issuance
├── .env.example
└── README.md
```

---

## Roadmap

- **Per-user wallets.** The demo uses one shared operator wallet that fronts every prompt. A production version would provision a Circle wallet per user at sign-up and bill each user's own balance.
- **True per-word x402 HTTP flow.** Authorizations are currently batched per prompt. The end state is a real per-word x402 gate, with an HTTP 402 round-trip for each word. The batching SDK already handles the heavy part, so this is a wiring change.
- **User-controlled wallets via wagmi + EIP-3009 pre-authorization.** Move signing client-side: connect with wagmi, issue a capped pre-authorization, spend against it as the user types. Keeps the UX instant and removes server-side custody entirely.

---

## Acknowledgments

- **Circle** for Nanopayments, Developer-Controlled Wallets, Gateway, and the x402 batching SDK
- **Arc** for a testnet that makes sub-cent settlement feel instant
- **Anthropic** for Claude Haiku's streaming API
- **lablab.ai** for hosting the Agentic Economy on Arc hackathon

---

## License

[MIT](./LICENSE), © 2026 Team MTHOCP
