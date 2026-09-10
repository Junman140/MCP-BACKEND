import cron from "node-cron";
import { Student, FeeConfig, Invoice } from "../models/schemas.js";
import { createInAppNotification, sendEmailNotification } from "./notifications.js";

let cronJob: cron.ScheduledTask | null = null;

const TEMPLATES: Record<string, (params: Record<string, string>) => { title: string; message: string }> = {
  fee_deadline: (p) => ({
    title: "Fee Payment Reminder",
    message: `Dear ${p.studentName}, your ${p.feeLabel} payment of ₦${p.amount} is due by ${p.deadline}. Please log in to the LMS to complete your payment.`,
  }),
  course_registration: (p) => ({
    title: "Course Registration Window",
    message: `Dear ${p.studentName}, course registration for ${p.academicYear} Semester ${p.semester} is now open. Log in to register your courses.`,
  }),
  payment_overdue: (p) => ({
    title: "Overdue Payment Notice",
    message: `Dear ${p.studentName}, your ${p.feeLabel} payment of ₦${p.amount} is now overdue. Please make payment immediately to avoid restrictions.`,
  }),
};

export async function processReminder(data: {
  tenantId: string;
  studentId: string;
  studentEmail: string;
  template: string;
  params: Record<string, string>;
}) {
  const student = await Student.findById(data.studentId);
  if (!student) return;

  const templateFn = TEMPLATES[data.template];
  if (!templateFn) {
    throw new Error(`Unknown notification template: ${data.template}`);
  }

  const { title, message } = templateFn(data.params);

  if (student.userId) {
    await createInAppNotification({
      tenantId: data.tenantId,
      recipientId: student.userId,
      title,
      message,
      meta: { template: data.template, ...data.params },
    });
  }

  if (student.email || data.studentEmail) {
    await sendEmailNotification({
      tenantId: data.tenantId,
      to: student.email || data.studentEmail,
      subject: title,
      text: message,
    });
  }
}

export async function scanAndScheduleReminders() {
  const now = new Date();
  const tenants = await FeeConfig.distinct("tenantId", { isActive: true }) as string[];

  for (const tenantId of tenants) {
    const configs = await FeeConfig.find({ tenantId, isActive: true }).lean();

    for (const config of configs) {
      const pendingInvoices = await Invoice.find({
        tenantId,
        feeType: config.feeType,
        status: "AWAITING_PAYMENT",
        expiresAt: { $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), $gt: now },
      }).lean();

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const overdueInvoices = await Invoice.find({
        tenantId,
        feeType: config.feeType,
        status: "AWAITING_PAYMENT",
        expiresAt: { $lte: now },
      }).lean();

      for (const invoice of pendingInvoices) {
        const student = await Student.findById(invoice.studentId);
        if (!student) continue;

        await processReminder({
          tenantId,
          studentId: invoice.studentId,
          studentEmail: student.email ?? "",
          template: "fee_deadline",
          params: {
            studentName: student.fullName,
            feeLabel: config.label,
            amount: invoice.totalAmount.toLocaleString(),
            deadline: invoice.expiresAt?.toLocaleDateString() ?? "N/A",
          },
        });
      }

      for (const invoice of overdueInvoices) {
        if (invoice.updatedAt > oneDayAgo) continue;

        const student = await Student.findById(invoice.studentId);
        if (!student) continue;

        await processReminder({
          tenantId,
          studentId: invoice.studentId,
          studentEmail: student.email ?? "",
          template: "payment_overdue",
          params: {
            studentName: student.fullName,
            feeLabel: config.label,
            amount: invoice.totalAmount.toLocaleString(),
          },
        });
      }
    }
  }
}

export function startReminderScheduler() {
  cronJob = cron.schedule("0 8 * * *", async () => {
    console.log("[Reminders] Running daily scan...");
    try {
      await scanAndScheduleReminders();
      console.log("[Reminders] Daily scan complete");
    } catch (err) {
      console.error("[Reminders] Daily scan failed:", err);
    }
  });

  console.log("[Reminders] Scheduler started (daily at 08:00)");
}

export function stopReminderScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}
