import { Invoice, LedgerEntry, PaymentTransaction } from "../models/schemas.js";
import { appendEntry } from "./ledger.js";
import { createInAppNotification, sendEmailNotification } from "./notifications.js";
import { generateReceipt } from "./receipt.js";

const REMITA_BASE_URL = process.env.REMITA_BASE_URL ?? "https://remitademo.net/remita/exapp/api/v1/send/api";

interface RemitaRRRResponse {
  statuscode?: string;
  status?: string;
  RRR?: string;
  responseMsg?: string;
}

async function callRemitaAPI<T>(endpoint: string, body: unknown): Promise<T> {
  const merchantId = process.env.REMITA_MERCHANT_ID;
  const apiKey = process.env.REMITA_API_KEY;
  const serviceTypeId = process.env.REMITA_SERVICE_TYPE_ID;

  if (!merchantId || !apiKey || !serviceTypeId) {
    throw new Error("Remita not configured: set REMITA_MERCHANT_ID, REMITA_API_KEY, REMITA_SERVICE_TYPE_ID");
  }

  const res = await fetch(`${REMITA_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `remitaConsumerKey=${merchantId},remitaConsumerToken=${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Remita API returned ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export async function generateRRR(args: {
  amount: number;
  payerName: string;
  payerEmail: string;
  payerPhone?: string;
  description: string;
  invoiceId: string;
  tenantId: string;
}): Promise<{ rrr: string }> {
  const orderId = `${args.tenantId}-${args.invoiceId}-${Date.now()}`;
  const response = await callRemitaAPI<RemitaRRRResponse>(
    "/echannelsvc/merchant/api/paymentinit",
    {
      serviceTypeId: process.env.REMITA_SERVICE_TYPE_ID,
      amount: args.amount.toString(),
      orderId,
      payerName: args.payerName,
      payerEmail: args.payerEmail,
      payerPhone: args.payerPhone ?? "",
      description: args.description,
    }
  );

  if (response.statuscode !== "025" && response.status !== "SUCCESS") {
    throw new Error(`Remita RRR generation failed: ${response.responseMsg ?? "unknown error"}`);
  }

  if (!response.RRR) {
    throw new Error("Remita RRR generation returned no RRR");
  }

  return { rrr: response.RRR };
}

export async function processRemittance(data: {
  invoiceId: string;
  tenantId: string;
  governmentAmount: number;
  pspReference: string;
}) {
  const invoice = await Invoice.findById(data.invoiceId);
  if (!invoice) throw new Error(`Invoice ${data.invoiceId} not found`);

  if (invoice.status !== "COLLECTED") {
    console.log(`[Remittance] Skipping invoice ${data.invoiceId} — status is ${invoice.status}, not COLLECTED`);
    return;
  }

  if (invoice.feeType === "departmental_dues") {
    invoice.status = "COMPLETE";
    await invoice.save();

    await appendEntry({
      tenantId: data.tenantId,
      invoiceId: data.invoiceId,
      event: "COMPLETE",
      amount: invoice.amount,
      data: { note: "Departmental dues — no Remita involvement" },
    });

    await generateReceipt({ tenantId: data.tenantId, invoice });
    return;
  }

  const existingOutbound = await PaymentTransaction.findOne({
    invoiceId: data.invoiceId,
    direction: "OUTBOUND",
    status: "SUCCESS",
  });
  if (existingOutbound) {
    console.log(`[Remittance] Outbound already exists for ${data.invoiceId} — skipping`);
    return;
  }

  invoice.status = "REMITTING";
  await invoice.save();

  await appendEntry({
    tenantId: data.tenantId,
    invoiceId: data.invoiceId,
    event: "REMITTING",
    amount: data.governmentAmount,
    data: { pspReference: data.pspReference },
  });

  try {
    const { rrr } = await generateRRR({
      amount: data.governmentAmount,
      payerName: `Student Invoice ${data.invoiceId.slice(0, 8)}`,
      payerEmail: "bursary@school.edu",
      description: `School fees remittance for invoice ${data.invoiceId}`,
      invoiceId: data.invoiceId,
      tenantId: data.tenantId,
    });

    await PaymentTransaction.create({
      tenantId: data.tenantId,
      invoiceId: data.invoiceId,
      amount: data.governmentAmount,
      direction: "OUTBOUND",
      pspProvider: "remita",
      pspReference: rrr,
      status: "PENDING",
      remittanceRRR: rrr,
      idempotencyKey: `remit-${data.invoiceId}`,
    });

    const settlementResponse = await callRemitaAPI<{ statuscode?: string; status?: string }>(
      "/echannelsvc/merchant/api/sendpayment",
      {
        rrr,
        amount: data.governmentAmount.toString(),
        merchantId: process.env.REMITA_MERCHANT_ID,
        serviceTypeId: process.env.REMITA_SERVICE_TYPE_ID,
      }
    );

    const success =
      settlementResponse.statuscode === "00" ||
      settlementResponse.statuscode === "000" ||
      settlementResponse.status === "SUCCESS";

    if (!success) {
      throw new Error(`Remita settlement failed: ${JSON.stringify(settlementResponse)}`);
    }

    await PaymentTransaction.findOneAndUpdate(
      { remittanceRRR: rrr },
      { $set: { status: "SUCCESS", gatewayResponse: JSON.stringify(settlementResponse) } }
    );

    invoice.status = "REMITTED";
    await invoice.save();

    await appendEntry({
      tenantId: data.tenantId,
      invoiceId: data.invoiceId,
      event: "REMITTED",
      amount: data.governmentAmount,
      data: { rrr },
    });

    invoice.status = "COMPLETE";
    await invoice.save();

    await appendEntry({
      tenantId: data.tenantId,
      invoiceId: data.invoiceId,
      event: "COMPLETE",
      amount: invoice.totalAmount,
      data: { rrr, pspReference: data.pspReference },
    });

    const receipt = await generateReceipt({
      tenantId: data.tenantId,
      invoice,
      rrrReference: rrr,
    });

    const { Student } = await import("../models/schemas.js");
    const student = await Student.findById(invoice.studentId);
    if (student) {
      await createInAppNotification({
        tenantId: data.tenantId,
        recipientId: student.userId ?? undefined,
        title: "Payment Confirmed",
        message: `Your payment of ₦${invoice.totalAmount.toLocaleString()} for ${invoice.feeType.replace(/_/g, " ")} has been processed. Receipt #${receipt.receiptNumber}`,
        meta: { invoiceId: data.invoiceId, receiptId: receipt._id },
      });

      if (student.email) {
        await sendEmailNotification({
          tenantId: data.tenantId,
          to: student.email,
          subject: "Payment Confirmed - Receipt Available",
          text: `Your payment of ₦${invoice.totalAmount.toLocaleString()} has been processed successfully.\n\nReceipt #${receipt.receiptNumber}\n\nLog in to download your receipt.`,
        });
      }
    }
  } catch (err) {
    invoice.status = "FAILED";
    await invoice.save();

    await appendEntry({
      tenantId: data.tenantId,
      invoiceId: data.invoiceId,
      event: "FAILED",
      amount: data.governmentAmount,
      data: { error: err instanceof Error ? err.message : String(err) },
    });

    throw err;
  }
}
