import { JobQueue } from "../models/schemas.js";
import { processRemittance } from "./remittance.js";
import { processReminder } from "./reminders.js";

const POLL_INTERVAL_MS = 5_000;
const CONCURRENCY = 3;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function processJob(job: Record<string, any>) {
  const acquired = await JobQueue.findOneAndUpdate(
    { _id: job._id, status: "PENDING" },
    { $set: { status: "PROCESSING", processingStartedAt: new Date() } }
  );
  if (!acquired) return;

  try {
    switch (job.type) {
      case "remit_to_government":
        await processRemittance(job.data as {
          invoiceId: string;
          tenantId: string;
          governmentAmount: number;
          pspReference: string;
        });
        break;
      case "send_reminder":
        await processReminder(job.data as {
          tenantId: string;
          studentId: string;
          studentEmail: string;
          template: string;
          params: Record<string, string>;
        });
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await JobQueue.findOneAndUpdate(
      { _id: job._id },
      { $set: { status: "COMPLETED", completedAt: new Date() } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const attempts = (job.attempts ?? 0) + 1;
    const isDead = attempts >= (job.maxAttempts ?? 5);
    const backoffSeconds = Math.min(60 * Math.pow(2, attempts - 1), 3600);

    await JobQueue.findOneAndUpdate(
      { _id: job._id },
      {
        $set: {
          status: isDead ? "DEAD" : "PENDING",
          attempts,
          lastError: errorMsg,
          nextAttemptAt: isDead ? null : new Date(Date.now() + backoffSeconds * 1000),
          processingStartedAt: null,
        },
      }
    );

    if (isDead) {
      console.error(`[Jobs] Job ${job._id} (${job.type}) dead after ${attempts} attempts: ${errorMsg}`);
    }
  }
}

export function enqueueJob(args: {
  type: string;
  tenantId: string;
  invoiceId?: string;
  data?: unknown;
  priority?: number;
  delayMs?: number;
}): Promise<Record<string, any>> {
  return JobQueue.create({
    type: args.type,
    tenantId: args.tenantId,
    invoiceId: args.invoiceId,
    data: args.data,
    priority: args.priority ?? 0,
    nextAttemptAt: new Date(Date.now() + (args.delayMs ?? 0)),
  });
}

export async function enqueueRemittance(args: {
  invoiceId: string;
  tenantId: string;
  governmentAmount: number;
  pspReference: string;
}) {
  const existing = await JobQueue.findOne({
    invoiceId: args.invoiceId,
    type: "remit_to_government",
    status: { $in: ["PENDING", "PROCESSING"] },
  });
  if (existing) return existing;

  return JobQueue.create({
    type: "remit_to_government",
    tenantId: args.tenantId,
    invoiceId: args.invoiceId,
    data: args,
    nextAttemptAt: new Date(),
  });
}

export function enqueueReminder(args: {
  tenantId: string;
  studentId: string;
  studentEmail: string;
  template: string;
  params: Record<string, string>;
}) {
  return JobQueue.create({
    type: "send_reminder",
    tenantId: args.tenantId,
    data: args,
    nextAttemptAt: new Date(),
  });
}

async function pollLoop() {
  const now = new Date();
  const batch = await JobQueue.find({
    status: "PENDING",
    nextAttemptAt: { $lte: now },
  })
    .sort({ priority: -1, nextAttemptAt: 1 })
    .limit(CONCURRENCY)
    .lean();

  if (batch.length === 0) return;

  await Promise.all(batch.map((job) => processJob(job)));
}

export function startWorker() {
  if (running) return;
  running = true;
  console.log("[Jobs] Worker started (MongoDB-backed)");
  timer = setInterval(pollLoop, POLL_INTERVAL_MS);
}

export function stopWorker() {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
