import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import {
  Invoice,
  FeeConfig,
  PaymentTransaction,
  LedgerEntry,
  Receipt,
  Student,
} from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
import { createVirtualAccount, verifyWebhook, processPaymentWebhook } from "../lib/payment.js";
import { verifyChain, appendEntry } from "../lib/ledger.js";
import { getReceiptPdf } from "../lib/receipt.js";

const CreateFeeConfig = z.object({
  feeType: z.enum(["school_fees", "course_registration", "departmental_dues"]),
  label: z.string().min(1),
  amount: z.number().positive(),
  serviceFee: z.number().min(0).default(500),
  academicSessionId: z.string().optional(),
  level: z.string().optional(),
  departmentId: z.string().optional(),
  facultyId: z.string().optional(),
});

const CreateInvoice = z.object({
  feeType: z.enum(["school_fees", "course_registration", "departmental_dues"]),
  academicSessionId: z.string().optional(),
  academicYear: z.string().optional(),
  semester: z.number().min(1).max(2).optional(),
  courseIds: z.array(z.string()).optional(),
});

export async function paymentRoutes(app: FastifyInstance) {
  // ── Fee Configuration ──

  app.post(
    "/payments/fee-configs",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = CreateFeeConfig.parse(req.body);

      const cfg = await FeeConfig.create({ ...body, tenantId: tid });
      return withId(cfg.toObject() as { _id: string });
    }
  );

  app.get(
    "/payments/fee-configs",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.STUDENT])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;

      const configs = await FeeConfig.find({ tenantId: tid, isActive: true }).lean();
      return withIds(configs as { _id: string }[]);
    }
  );

  app.put(
    "/payments/fee-configs/:id",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const { id } = req.params as { id: string };
      const body = CreateFeeConfig.partial().parse(req.body);

      const cfg = await FeeConfig.findOneAndUpdate(
        { _id: id, tenantId: tid },
        { $set: body },
        { new: true }
      ).lean();

      if (!cfg) return reply.code(404).send({ error: "Fee config not found" });
      return withId(cfg as { _id: string });
    }
  );

  // ── Invoices ──

  app.post(
    "/payments/invoices",
    {
      onRequest: [app.authenticate, requireRole([Role.STUDENT, Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = CreateInvoice.parse(req.body);

      let studentId: string;
      if (user.role === Role.STUDENT) {
        const student = await Student.findOne({ tenantId: tid, userId: user.sub }).lean() as Record<string, any> | null;
        if (!student) return reply.code(404).send({ error: "Student profile not found" });
        studentId = student._id as string;
      } else {
        const s = req.body as { studentId?: string };
        if (!s.studentId) return reply.code(400).send({ error: "studentId required for admin invoice creation" });
        studentId = s.studentId;
      }

      const feeConfig = await FeeConfig.findOne({
        tenantId: tid,
        feeType: body.feeType,
        isActive: true,
      }).lean() as Record<string, any> | null;

      if (!feeConfig) {
        return reply.code(400).send({
          error: `No active fee configuration for ${body.feeType}. Contact administrator.`,
        });
      }

      const amount = feeConfig.amount as number;
      const serviceFee = feeConfig.serviceFee as number;
      const totalAmount = amount + serviceFee;

      const student = await Student.findById(studentId).lean() as Record<string, any> | null;
      if (!student) return reply.code(404).send({ error: "Student not found" });

      let virtualAccountNumber = "";
      let virtualAccountBank = "";
      let pspReference = "";

      try {
        const va = await createVirtualAccount({
          invoiceId: "pending",
          tenantId: tid,
          email: (student.email as string) ?? `${student.matricNo as string}@placeholder.edu`,
          amount: totalAmount,
        });
        virtualAccountNumber = va.accountNumber;
        virtualAccountBank = va.bankName;
        pspReference = va.reference;
      } catch (err) {
        console.error("[Payments] Failed to create virtual account:", err);
        return reply.code(502).send({ error: "Payment service unavailable. Please try again." });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invoice = await Invoice.create({
        tenantId: tid,
        studentId,
        feeType: body.feeType,
        amount,
        serviceFee,
        totalAmount,
        academicSessionId: body.academicSessionId ?? undefined,
        academicYear: body.academicYear ?? undefined,
        semester: body.semester ?? undefined,
        courseIds: body.courseIds ?? undefined,
        virtualAccountNumber,
        virtualAccountBank,
        pspReference,
        pspProvider: (process.env.PSP_PROVIDER ?? "paystack") as "paystack" | "flutterwave" | "monnify",
        expiresAt,
      });

      await appendEntry({
        tenantId: tid,
        invoiceId: invoice._id,
        event: "INVOICE_CREATED",
        amount: totalAmount,
        data: { feeType: body.feeType, virtualAccountNumber },
      });

      return withId(invoice.toObject() as { _id: string });
    }
  );

  app.get(
    "/payments/invoices",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.STUDENT, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;

      const q = req.query as { studentId?: string; status?: string };
      const filter: Record<string, unknown> = { tenantId: tid };

      if (user.role === Role.STUDENT) {
        const student = await Student.findOne({ tenantId: tid, userId: user.sub }).lean() as Record<string, any> | null;
        if (!student) return reply.code(404).send({ error: "Student profile not found" });
        filter.studentId = student._id as string;
      } else if (q.studentId) {
        filter.studentId = q.studentId;
      }

      if (q.status) filter.status = q.status;

      const invoices = await Invoice.find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      return withIds(invoices as { _id: string }[]);
    }
  );

  app.get(
    "/payments/invoices/:id",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.STUDENT, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const { id } = req.params as { id: string };

      const invoice = await Invoice.findOne({ _id: id, tenantId: tid }).lean();
      if (!invoice) return reply.code(404).send({ error: "Invoice not found" });

      const transactions = await PaymentTransaction.find({ invoiceId: id }).sort({ createdAt: -1 }).lean();
      const chain = await verifyChain(id);

      return {
        ...withId(invoice as { _id: string }),
        transactions: withIds(transactions as { _id: string }[]),
        chainIntegrity: chain,
      };
    }
  );

  // ── Webhook endpoint (unauthenticated - secured by HMAC signature) ──

  app.post("/payments/webhook/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };

    if (!["paystack", "flutterwave"].includes(provider)) {
      return reply.code(400).send({ error: `Unsupported provider: ${provider}` });
    }

    const signature = (req.headers["x-paystack-signature"] ??
      req.headers["verif-hash"] ??
      req.headers["monnify-signature"] ??
      "") as string;

    if (!signature) {
      return reply.code(401).send({ error: "Missing webhook signature" });
    }

    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    if (!verifyWebhook(provider, signature, rawBody)) {
      return reply.code(401).send({ error: "Invalid webhook signature" });
    }

    try {
      const result = await processPaymentWebhook({
        provider,
        signature,
        body: req.body,
      });
      return { ok: true, ...result };
    } catch (err) {
      console.error(`[Payment Webhook] Error processing ${provider} webhook:`, err);
      return reply.code(500).send({ error: "Webhook processing failed" });
    }
  });

  // ── Ledger / chain verification ──

  app.get(
    "/payments/invoices/:id/ledger",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const { id } = req.params as { id: string };

      const entries = await LedgerEntry.find({ invoiceId: id, tenantId: tid })
        .sort({ createdAt: 1 })
        .lean();

      const chain = await verifyChain(id);

      return {
        entries: withIds(entries as { _id: string }[]),
        chainIntegrity: chain,
      };
    }
  );

  // ── Receipts ──

  app.get(
    "/payments/invoices/:id/receipt",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.STUDENT])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const { id } = req.params as { id: string };

      const receipt = await Receipt.findOne({ invoiceId: id, tenantId: tid }).lean();
      if (!receipt) return reply.code(404).send({ error: "Receipt not found" });

      return withId(receipt as { _id: string });
    }
  );

  app.get(
    "/payments/receipts/:id/download",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.STUDENT])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const { id } = req.params as { id: string };

      const receipt = await Receipt.findOne({ _id: id, tenantId: tid }).lean() as Record<string, any> | null;
      if (!receipt) return reply.code(404).send({ error: "Receipt not found" });

      const stream = await getReceiptPdf(id);
      if (!stream) return reply.code(404).send({ error: "Receipt PDF not available" });

      await Receipt.findOneAndUpdate({ _id: id }, { $set: { isDownloaded: true } });

      reply.header("Content-Type", "application/pdf");
      reply.header(
        "Content-Disposition",
        `attachment; filename="receipt-${receipt.receiptNumber as string}.pdf"`
      );
      return reply.send(stream);
    }
  );

  // ── Student payment status (for profile page) ──

  app.get(
    "/payments/student-summary",
    {
      onRequest: [app.authenticate, requireRole([Role.STUDENT, Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;

      let studentId: string;
      if (user.role === Role.STUDENT) {
        const student = await Student.findOne({ tenantId: tid, userId: user.sub }).lean() as Record<string, any> | null;
        if (!student) return reply.code(404).send({ error: "Student profile not found" });
        studentId = student._id as string;
      } else {
        const q = req.query as { studentId?: string };
        if (!q.studentId) return reply.code(400).send({ error: "studentId query parameter required" });
        studentId = q.studentId;
      }

      const invoices = await Invoice.find({ tenantId: tid, studentId }).lean() as Record<string, any>[];
      const receipts = await Receipt.find({ tenantId: tid, studentId }).lean() as Record<string, any>[];

      const outstandingBalances: Record<string, number> = {};
      for (const inv of invoices) {
        if (inv.status === "AWAITING_PAYMENT") {
          outstandingBalances[inv.feeType as string] = (outstandingBalances[inv.feeType as string] ?? 0) + (inv.totalAmount as number);
        }
      }

      return {
        totalInvoices: invoices.length,
        completedPayments: invoices.filter((i) => i.status === "COMPLETE").length,
        outstandingBalances,
        recentPayments: withIds(
          receipts
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 10) as { _id: string }[]
        ),
      };
    }
  );
}
