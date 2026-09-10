import { createHash } from "node:crypto";
import { LedgerEntry } from "../models/schemas.js";

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export { GENESIS_HASH };

export function computeHash(entry: {
  previousHash: string;
  event: string;
  amount: number;
  invoiceId: string;
  timestamp: Date;
  transactionId?: string | null;
  data?: unknown;
}): string {
  const payload = JSON.stringify({
    ph: entry.previousHash,
    e: entry.event,
    a: entry.amount,
    i: entry.invoiceId,
    t: entry.timestamp.toISOString(),
    tx: entry.transactionId ?? null,
    d: entry.data ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export async function getLastEntry(invoiceId: string) {
  return LedgerEntry.findOne({ invoiceId }).sort({ createdAt: -1 }).lean() as Record<string, any> | null;
}

export async function appendEntry(args: {
  tenantId: string;
  invoiceId: string;
  event: string;
  amount: number;
  transactionId?: string | null;
  data?: Record<string, any>;
}) {
  const prev = await getLastEntry(args.invoiceId);
  const previousHash = (prev?.currentHash as string) ?? GENESIS_HASH;
  const timestamp = new Date();
  const currentHash = computeHash({
    previousHash,
    event: args.event,
    amount: args.amount,
    invoiceId: args.invoiceId,
    timestamp,
    transactionId: args.transactionId ?? null,
    data: args.data,
  });

  return LedgerEntry.create({
    tenantId: args.tenantId,
    invoiceId: args.invoiceId,
    event: args.event,
    amount: args.amount,
    previousHash,
    currentHash,
    transactionId: args.transactionId ?? undefined,
    data: args.data,
  });
}

export async function verifyChain(invoiceId: string): Promise<{ valid: boolean; entryCount: number; brokenAt?: string }> {
  const entries = await LedgerEntry.find({ invoiceId }).sort({ createdAt: 1 }).lean() as Record<string, any>[];
  if (entries.length === 0) return { valid: true, entryCount: 0 };

  let prevHash = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.previousHash !== prevHash) {
      return { valid: false, entryCount: entries.length, brokenAt: entry._id as string };
    }
    const expected = computeHash({
      previousHash: entry.previousHash as string,
      event: entry.event as string,
      amount: entry.amount as number,
      invoiceId: entry.invoiceId as string,
      timestamp: new Date(entry.createdAt as string),
      transactionId: (entry.transactionId as string) ?? null,
      data: entry.data as Record<string, any> | undefined,
    });
    if (expected !== (entry.currentHash as string)) {
      return { valid: false, entryCount: entries.length, brokenAt: entry._id as string };
    }
    prevHash = entry.currentHash as string;
  }
  return { valid: true, entryCount: entries.length };
}
