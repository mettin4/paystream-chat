import { cookies } from "next/headers";

import {
  getOperatorAddressSafe,
  type OnchainTx,
  type Transaction,
} from "@/lib/circle";
import {
  SESSION_COOKIE_NAME,
  verifySessionCookie,
} from "@/lib/session-cookie";
import {
  listPayments,
  listSettlements,
  type OnchainSettlement,
  type PaymentRecord,
} from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // operatorAddress is bundled alongside transactions so the TransactionFeed
  // can build explorer links without a second round-trip. Authorization UUIDs
  // (per-word Gateway flow) don't resolve on Arc Explorer — link those to
  // the operator address. On-chain checkpoint settlements DO have real 0x…
  // hashes and link directly to /tx/{hash}.
  const operatorAddress = getOperatorAddressSafe();

  const raw = cookies().get(SESSION_COOKIE_NAME)?.value;
  const sessionId = await verifySessionCookie(raw);
  if (!sessionId) {
    return Response.json({
      transactions: [] as Transaction[],
      settlements: [] as OnchainTx[],
      operatorAddress,
    });
  }

  const [payments, settlementsRaw] = await Promise.all([
    listPayments(sessionId),
    listSettlements(sessionId),
  ]);

  const transactions = payments.map(toTransaction);
  const settlements = settlementsRaw.map(toOnchainTx);

  // Newest first — matches how the UI feeds present them.
  transactions.reverse();
  settlements.reverse();

  return Response.json({ transactions, settlements, operatorAddress });
}

function toOnchainTx(s: OnchainSettlement): OnchainTx {
  return {
    id: s.txHash,
    hash: s.txHash,
    amount: s.amountUsdc,
    timestamp: s.timestamp,
  };
}

function toTransaction(p: PaymentRecord): Transaction {
  // txHash is a Circle settlement UUID until the batch lands on-chain, at
  // which point it becomes a 0x... hex hash. Mark anything not starting
  // with 0x as "pending" so the feed renders the amber dot + skips the
  // Arc Explorer link.
  const isOnchain = p.txHash.startsWith("0x");
  // Under the per-word payment model every record is exactly one word, so
  // a per-row word label adds no information. Leave it undefined and the
  // feed falls back to `tx <id-prefix>` which is already unique.
  return {
    id: p.txHash,
    hash: p.txHash,
    amount: p.amountUsdc,
    timestamp: p.timestamp,
    status: isOnchain ? "confirmed" : "pending",
  };
}
