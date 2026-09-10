import cron from "node-cron";
import { Invoice, LedgerEntry, PaymentTransaction } from "../models/schemas.js";
import { verifyChain } from "./ledger.js";

let cronJob: cron.ScheduledTask | null = null;

interface ReconciliationResult {
  invoiceId: string;
  issue: string;
  detail: string;
}

export async function runReconciliation(): Promise<ReconciliationResult[]> {
  const issues: ReconciliationResult[] = [];

  const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000);

  const stuckInvoices = await Invoice.find({
    status: { $in: ["COLLECTED", "REMITTING"] },
    updatedAt: { $lt: stuckThreshold },
  }).lean() as Record<string, any>[];

  for (const inv of stuckInvoices) {
    issues.push({
      invoiceId: inv._id,
      issue: "STUCK_MID_PROCESS",
      detail: `Invoice ${inv._id} stuck at ${inv.status} since ${inv.updatedAt.toISOString()}`,
    });
  }

  const failedInvoices = await Invoice.find({ status: "FAILED" })
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean() as Record<string, any>[];

  for (const inv of failedInvoices) {
    issues.push({
      invoiceId: inv._id,
      issue: "REMITTANCE_FAILED",
      detail: `Invoice ${inv._id} remittance failed. Total: ₦${inv.totalAmount}, Fee: ₦${inv.amount}, Service: ₦${inv.serviceFee}`,
    });
  }

  const tenants = await Invoice.distinct("tenantId", { status: { $nin: ["AWAITING_PAYMENT", "EXPIRED"] } });
  for (const tenantId of tenants) {
    const collectedAgg = await PaymentTransaction.aggregate([
      { $match: { tenantId, direction: "INBOUND", status: "SUCCESS" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const remittedAgg = await PaymentTransaction.aggregate([
      { $match: { tenantId, direction: "OUTBOUND", status: "SUCCESS", pspProvider: "remita" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const collected = collectedAgg[0]?.total ?? 0;
    const remitted = remittedAgg[0]?.total ?? 0;
    const retained = collected - remitted;

    const completeInvoices = await Invoice.find({ tenantId, status: "COMPLETE" }).lean() as Record<string, any>[];
    const expectedRetained = completeInvoices.reduce((sum, inv) => sum + inv.serviceFee, 0);

    if (Math.abs(retained - expectedRetained) > 1) {
      issues.push({
        invoiceId: `tenant:${tenantId}`,
        issue: "AMOUNT_MISMATCH",
        detail: `Collected: ₦${collected}, Remitted: ₦${remitted}, Retained: ₦${retained}, Expected retained: ₦${expectedRetained}`,
      });
    }
  }

  const recentInvoices = await Invoice.find({
    status: "COMPLETE",
    updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).lean() as Record<string, any>[];

  for (const inv of recentInvoices) {
    const chain = await verifyChain(inv._id);
    if (!chain.valid) {
      issues.push({
        invoiceId: inv._id,
        issue: "CHAIN_BROKEN",
        detail: `Ledger hash chain broken at entry ${chain.brokenAt}`,
      });
    }
  }

  if (issues.length > 0) {
    console.warn(`[Reconciliation] ${issues.length} issues found:`);
    for (const issue of issues) {
      console.warn(`  ${issue.issue}: ${issue.detail}`);
    }
  } else {
    console.log("[Reconciliation] All clear — no issues found");
  }

  return issues;
}

export function startReconciliationScheduler() {
  cronJob = cron.schedule("0 1 * * *", async () => {
    console.log("[Reconciliation] Running daily reconciliation...");
    try {
      await runReconciliation();
      console.log("[Reconciliation] Daily reconciliation complete");
    } catch (err) {
      console.error("[Reconciliation] Reconciliation failed:", err);
    }
  });

  console.log("[Reconciliation] Scheduler started (daily at 01:00)");
}

export function stopReconciliationScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}
