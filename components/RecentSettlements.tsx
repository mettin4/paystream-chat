"use client";

import { ExternalLink } from "lucide-react";
import type { OnchainTx } from "@/lib/circle";

type Props = {
  settlements: OnchainTx[];
};

const EXPLORER =
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";

export default function RecentSettlements({ settlements }: Props) {
  const isEmpty = settlements.length === 0;
  const showViewAll = settlements.length > 8;

  return (
    <div className="rounded-lg border border-stroke-subtle bg-app-elevated p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">
          Recent Settlements
        </span>
        {showViewAll && (
          <span className="font-mono text-[11px] text-ink-tertiary">
            {settlements.length} total
          </span>
        )}
      </div>

      {isEmpty ? (
        <div className="flex h-20 items-center justify-center text-[13px] text-ink-tertiary">
          No on-chain checkpoints yet
        </div>
      ) : (
        <ul className="scrollbar-thin -mx-2 max-h-[280px] overflow-y-auto">
          {settlements.slice(0, 50).map((tx) => (
            <SettlementRow key={tx.id} tx={tx} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SettlementRow({ tx }: { tx: OnchainTx }) {
  return (
    <li className="group flex h-10 items-center gap-3 rounded px-2 transition-colors duration-150 hover:bg-white/[0.02]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
        title="Confirmed on-chain"
      />
      <span className="flex-1 truncate text-[13px] text-ink-primary">
        Checkpoint
      </span>
      <span className="font-mono text-[12px] tabular-nums text-ink-secondary">
        ${tx.amount.toFixed(4)}
      </span>
      <a
        href={`${EXPLORER}/tx/${tx.hash}`}
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
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
