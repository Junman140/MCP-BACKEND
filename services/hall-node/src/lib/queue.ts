import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./crypto.js";

export interface PendingEvent {
  studentId: string;
  examId?: string;
  courseId?: string;
  academicYear?: string;
  semester?: number;
  result: string;
  matchScore?: number;
  capturedAt: string;
  idempotencyKey?: string;
}

const queueFile = () => path.join(dataDir(), "pending-events.jsonl");

export function appendPending(ev: PendingEvent): void {
  fs.appendFileSync(queueFile(), `${JSON.stringify(ev)}\n`, "utf8");
}

export function readPending(): PendingEvent[] {
  const f = queueFile();
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PendingEvent);
}

export function clearPending(): void {
  const f = queueFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
