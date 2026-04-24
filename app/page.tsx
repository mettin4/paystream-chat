"use client";

import { useEffect, useState } from "react";
import ChatInterface from "@/components/ChatInterface";
import PaymentCounter from "@/components/PaymentCounter";
import TransactionFeed from "@/components/TransactionFeed";
import type { Transaction } from "@/lib/circle";

const PRICE_PER_WORD = 0.0001;

// Polling cadence for the transaction feed. While the stream is live we
// poll aggressively so the feed fills in near-real-time as per-word
// payments settle. After the stream ends we keep polling at a slower rate
// for a short tail window to catch settlements that complete *after* the
// stream closes (payForPrompt runs fire-and-forget, so the last few words
// can land seconds later).
const POLL_MS_STREAMING = 1200;
const POLL_MS_TAIL = 2000;
const TAIL_WINDOW_MS = 8000;

export default function Home() {
  const [wordCount, setWordCount] = useState(0);
  const [promptCount, setPromptCount] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [operatorAddress, setOperatorAddress] = useState<string | null>(null);
  const [sessionStart] = useState(() => Date.now());
  const [isStreaming, setIsStreaming] = useState(false);

  const totalPaid = wordCount * PRICE_PER_WORD;

  // Payments persisted in sessions.json survive page reloads, but the
  // in-memory counters (words / prompts / elapsed) reset with each load.
  // Show only payments from the current page-load session so the feed
  // doesn't read "236 txs for $0.00" on fresh reload. Older payments
  // remain in storage for debugging / audit — they're just not surfaced
  // in this view.
  const currentSessionTxs = transactions.filter(
    (tx) => tx.timestamp >= sessionStart
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchTxs() {
      try {
        const res = await fetch("/api/transactions", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          transactions?: Transaction[];
          operatorAddress?: string | null;
        };
        if (cancelled) return;
        setTransactions(data.transactions ?? []);
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
        <div className="fade-up [animation-delay:50ms]">
          <ChatInterface
            onWordEvent={handleWordEvent}
            onPromptSent={handlePromptSent}
            onStreamingChange={setIsStreaming}
            pricePerWord={PRICE_PER_WORD}
          />
        </div>
        <aside className="flex flex-col gap-6">
          <div className="fade-up [animation-delay:100ms]">
            <PaymentCounter
              wordCount={wordCount}
              totalPaid={totalPaid}
              txCount={currentSessionTxs.length}
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
