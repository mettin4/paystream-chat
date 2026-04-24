"use client";

import { ExternalLink } from "lucide-react";
import type { Transaction } from "@/lib/circle";

type Props = {
  transactions: Transaction[];
  operatorAddress: string | null;
};

const EXPLORER =
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";

export default function TransactionFeed({
  transactions,
  operatorAddress,
}: Props) {
  const isEmpty = transactions.length === 0;
  const showViewAll = transactions.length > 8;

  return (
    <div className="rounded-lg border border-stroke-subtle bg-app-elevated p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">
          Recent Payments
        </span>
        {showViewAll && (
          <button
            type="button"
            className="text-[12px] text-accent transition-colors duration-150 hover:text-accent-hover"
          >
            View all →
          </button>
        )}
      </div>

      {isEmpty ? (
        <div className="flex h-20 items-center justify-center text-[13px] text-ink-tertiary">
          No payments yet
        </div>
      ) : (
        <ul className="scrollbar-thin -mx-2 max-h-[280px] overflow-y-auto">
          {transactions.slice(0, 50).map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              operatorAddress={operatorAddress}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TransactionRow({
  tx,
  operatorAddress,
}: {
  tx: Transaction;
  operatorAddress: string | null;
}) {
  const confirmed = tx.status !== "pending";
  const label = tx.word ?? `tx ${tx.id.slice(0, 6)}`;
  // The tx.hash is Circle's internal settlement UUID — doesn't resolve on
  // Arc Explorer. Link each row to the operator address instead; that page
  // shows the operator's real on-chain activity (deposit/approve txs, and
  // settlement txs once Circle's batches land on-chain).
  const href = operatorAddress
    ? `${EXPLORER}/address/${operatorAddress}`
    : EXPLORER;

  return (
    <li className="group flex h-10 items-center gap-3 rounded px-2 transition-colors duration-150 hover:bg-white/[0.02]">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          confirmed ? "bg-accent" : "bg-amber-400"
        }`}
        title={confirmed ? "Confirmed on-chain" : "Pending batched settlement"}
      />
      <span className="flex-1 truncate text-[13px] text-ink-primary">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-ink-secondary">
        ${tx.amount.toFixed(4)}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={tx.hash}
        className="flex items-center gap-1 font-mono text-[11px] text-ink-tertiary transition-colors duration-150 hover:text-accent"
      >
        {truncateHash(tx.hash)}
        <ExternalLink className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
      </a>
    </li>
  );
}

function truncateHash(hash: string): string {
  if (hash.length <= 10) return hash;
  return `${hash.slice(0, 4)}..${hash.slice(-2)}`;
}
