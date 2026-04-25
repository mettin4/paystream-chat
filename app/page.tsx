"use client";

import { useEffect, useState } from "react";
import ChatInterface from "@/components/ChatInterface";
import PaymentCounter from "@/components/PaymentCounter";
import RecentSettlements from "@/components/RecentSettlements";
import TransactionFeed from "@/components/TransactionFeed";
import type { OnchainTx, Transaction } from "@/lib/circle";

const PRICE_PER_WORD = 0.0001;

// Polling cadence for the transaction feed. While the stream is live we
// poll aggressively so the feed fills in near-real-time as per-word
// authorizations settle. After the stream ends we keep polling at a slower
// rate for a longer tail window — on-chain checkpoint settlements via W3S
// serialize per operator wallet (one EOA nonce) and take 5-15s each, so
// the last few of a long reply may land 60-120s after the stream closes.
const POLL_MS_STREAMING = 1200;
const POLL_MS_TAIL = 3000;
const TAIL_WINDOW_MS = 120_000;

export default function Home() {
  const [wordCount, setWordCount] = useState(0);
  const [promptCount, setPromptCount] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settlements, setSettlements] = useState<OnchainTx[]>([]);
  const [operatorAddress, setOperatorAddress] = useState<string | null>(null);
  const [sessionStart] = useState(() => Date.now());
  const [isStreaming, setIsStreaming] = useState(false);

  const totalPaid = wordCount * PRICE_PER_WORD;

  // Payments persisted in sessions.json survive page reloads, but the
  // in-memory counters (words / prompts / elapsed) reset with each load.
  // Show only items from the current page-load session so the feed
  // doesn't read "236 txs for $0.00" on fresh reload. Older items
  // remain in storage for debugging / audit — they're just not surfaced
  // in this view. Same filter applies to on-chain settlements.
  const currentSessionTxs = transactions.filter(
    (tx) => tx.timestamp >= sessionStart
  );
  const currentSessionSettlements = settlements.filter(
    (s) => s.timestamp >= sessionStart
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchTxs() {
      try {
        const res = await fetch("/api/transactions", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          transactions?: Transaction[];
          settlements?: OnchainTx[];
          operatorAddress?: string | null;
        };
        if (cancelled) return;
        setTransactions(data.transactions ?? []);
        setSettlements(data.settlements ?? []);
        if (data.operatorAddress) setOperatorAddress(data.operatorAddress);
      } catch {
        // Non-fatal — next tick will retry.
      }
    }

    fetchTxs();

    if (isStreaming) {
      const id = setInterval(fetchTxs, POLL_MS_STREAMING);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }

    // Tail window: poll for a few seconds after the stream ends so late
    // settlements appear without waiting for the user's next action.
    const id = setInterval(fetchTxs, POLL_MS_TAIL);
    const stopId = setTimeout(() => clearInterval(id), TAIL_WINDOW_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(stopId);
    };
  }, [isStreaming]);

  function handleWordEvent(_word: string) {
    setWordCount((c) => c + 1);
  }

  function handlePromptSent() {
    setPromptCount((c) => c + 1);
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6">
      <section className="fade-up pb-8 pt-10">
        <h1 className="text-[32px] font-medium leading-[1.15] tracking-tight text-ink-primary">
          Pay per word, not per month.
        </h1>
        <p className="mt-2 text-[14px] text-ink-secondary">
          Stream USDC nanopayments to AI, one word at a time.
        </p>
      </section>

      <section className="grid grid-cols-1 items-start gap-6 pb-12 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <div className="fade-up [animation-delay:50ms]">
            <ChatInterface
              onWordEvent={handleWordEvent}
              onPromptSent={handlePromptSent}
              onStreamingChange={setIsStreaming}
              pricePerWord={PRICE_PER_WORD}
            />
          </div>
          <div className="fade-up [animation-delay:200ms]">
            <RecentSettlements settlements={currentSessionSettlements} />
          </div>
        </div>
        <aside className="flex flex-col gap-6">
          <div className="fade-up [animation-delay:100ms]">
            <PaymentCounter
              wordCount={wordCount}
              totalPaid={totalPaid}
              txCount={currentSessionTxs.length}
              settlementCount={currentSessionSettlements.length}
              sessionStart={sessionStart}
              promptCount={promptCount}
              isStreaming={isStreaming}
            />
          </div>
          <div className="fade-up [animation-delay:150ms]">
            <TransactionFeed
              transactions={currentSessionTxs}
              operatorAddress={operatorAddress}
            />
          </div>
        </aside>
      </section>
    </main>
  );
}
