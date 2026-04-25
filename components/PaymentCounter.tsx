"use client";

import { useEffect, useState } from "react";

type Props = {
  wordCount: number;
  totalPaid: number;
  txCount: number;
  settlementCount: number;
  sessionStart: number;
  promptCount: number;
  isStreaming: boolean;
};

export default function PaymentCounter({
  wordCount,
  totalPaid,
  txCount,
  settlementCount,
  sessionStart,
  promptCount,
  isStreaming,
}: Props) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - sessionStart;

  return (
    <div className="rounded-lg border border-stroke-subtle bg-app-elevated p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">
          Live Stream
        </span>
        <div
          className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] ${
            isStreaming ? "text-accent" : "text-ink-tertiary"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isStreaming ? "bg-accent soft-pulse" : "bg-ink-quaternary"
            }`}
          />
          {isStreaming ? "Live" : "Idle"}
        </div>
      </div>

      <div className="flex flex-col divide-y divide-stroke-subtle">
        <StatRow label="Words" value={wordCount.toString()} />
        <StatRow label="Paid USDC" value={`$${totalPaid.toFixed(4)}`} />
        <StatRow label="Authorizations" value={txCount.toString()} />
        <StatRow label="Onchain Settlements" value={settlementCount.toString()} />
      </div>

      <div className="mt-4 border-t border-stroke-strong pt-3 font-mono text-[11px] text-ink-tertiary">
        Session · {formatElapsed(elapsed)} · {promptCount} prompt
        {promptCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-12 items-center justify-between">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">
        {label}
      </span>
      <span className="font-mono text-[18px] tabular-nums text-ink-primary">
        {value}
      </span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
