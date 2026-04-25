// Per-session payment log persisted at `.data/sessions.json`.
//
// For hackathon scale only. Not safe for multi-process deployment — a single
// Next.js dev or serverless process is assumed. Replace with Supabase /
// Postgres when we outgrow single-instance.

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

export type PaymentRecord = {
  timestamp: number;
  wordCount: number;
  amountUsdc: number;
  txHash: string;
  network: string;
};

// On-chain checkpoint settlement (real 0x… tx hash from Arc), distinct from
// the per-word Gateway authorizations stored in `payments`. These are produced
// by lib/circle.ts → settleOnchain via W3S createTransaction.
export type OnchainSettlement = {
  timestamp: number;
  wordCount: number;
  amountUsdc: number;
  txHash: string;
  network: string;
};

export type Session = {
  createdAt: number;
  payments: PaymentRecord[];
  onchainSettlements?: OnchainSettlement[];
};

type SessionsData = {
  sessions: Record<string, Session>;
};

let cache: SessionsData | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<SessionsData> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf-8");
    cache = JSON.parse(raw) as SessionsData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      cache = { sessions: {} };
    } else {
      throw err;
    }
  }
  return cache;
}

async function persist(data: SessionsData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
  cache = data;
}

// Serialize writes so concurrent calls don't clobber each other.
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function recordPayment(
  sessionId: string,
  payment: PaymentRecord
): Promise<void> {
  return withWriteLock(async () => {
    const data = await load();
    if (!data.sessions[sessionId]) {
      data.sessions[sessionId] = { createdAt: Date.now(), payments: [] };
    }
    data.sessions[sessionId].payments.push(payment);
    await persist(data);
  });
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const data = await load();
  return data.sessions[sessionId] ?? null;
}

export async function listPayments(
  sessionId: string
): Promise<PaymentRecord[]> {
  const session = await getSession(sessionId);
  return session?.payments ?? [];
}

export function recordSettlement(
  sessionId: string,
  settlement: OnchainSettlement
): Promise<void> {
  return withWriteLock(async () => {
    const data = await load();
    if (!data.sessions[sessionId]) {
      data.sessions[sessionId] = {
        createdAt: Date.now(),
        payments: [],
        onchainSettlements: [],
      };
    }
    const s = data.sessions[sessionId];
    if (!s.onchainSettlements) s.onchainSettlements = [];
    s.onchainSettlements.push(settlement);
    await persist(data);
  });
}

export async function listSettlements(
  sessionId: string
): Promise<OnchainSettlement[]> {
  const session = await getSession(sessionId);
  return session?.onchainSettlements ?? [];
}
