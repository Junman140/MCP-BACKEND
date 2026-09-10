import { createHmac } from "node:crypto";
import { Invoice, PaymentTransaction } from "../models/schemas.js";
import { appendEntry } from "./ledger.js";
import { enqueueRemittance } from "./jobs.js";

const PSP_PROVIDER = (process.env.PSP_PROVIDER ?? "paystack") as "paystack" | "flutterwave" | "monnify";

interface VirtualAccountRequest {
  email: string;
  amount: number;
  reference: string;
}

interface VirtualAccountResponse {
  accountNumber: string;
  bankName: string;
  reference: string;
}

function verifyPaystackWebhook(signature: string, body: string): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;
  const hash = createHmac("sha512", secret).update(body).digest("hex");
  return hash === signature;
}

function verifyFlutterwaveWebhook(signature: string, body: string): boolean {
  const secret = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!secret) return false;
  const hash = createHmac("sha256", secret).update(body).digest("hex");
  return hash === signature;
}

function verifyMonnifyWebhook(signature: string, body: string): boolean {
  const secret = process.env.MONNIFY_SECRET_KEY;
  if (!secret) return false;
  const hash = createHmac("sha512", secret).update(body).digest("hex");
  return hash === signature;
}

export function verifyWebhook(provider: string, signature: string, body: string): boolean {
  switch (provider) {
    case "paystack":
      return verifyPaystackWebhook(signature, body);
    case "flutterwave":
      return verifyFlutterwaveWebhook(signature, body);
    case "monnify":
      return verifyMonnifyWebhook(signature, body);
    default:
      return false;
  }
}

export async function createVirtualAccount(args: {
  invoiceId: string;
  tenantId: string;
  email: string;
  amount: number;
}): Promise<VirtualAccountResponse> {
  const reference = `INV-${args.invoiceId.slice(0, 12)}`;
  const secretKey = process.env.PSP_SECRET_KEY;
  const baseUrl = process.env.PSP_BASE_URL;

  if (!secretKey || !baseUrl) {
    throw new Error(`PSP not configured: set PSP_SECRET_KEY and PSP_BASE_URL`);
  }

  switch (PSP_PROVIDER) {
    case "paystack": {
      const res = await fetch(`${baseUrl}/dedicated_account/assign`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: args.email,
          first_name: "Student",
          last_name: reference,
          phone: "",
        }),
      });

      if (!res.ok) throw new Error(`Paystack virtual account creation failed: ${await res.text()}`);

      const data = (await res.json()) as {
        status: boolean;
        data?: { account_number: string; bank: { name: string } };
        message?: string;
      };

      if (!data.status || !data.data) {
        throw new Error(`Paystack error: ${data.message ?? "unknown"}`);
      }

      return {
        accountNumber: data.data.account_number,
        bankName: data.data.bank.name,
        reference,
      };
    }

    case "flutterwave": {
      const res = await fetch(`${baseUrl}/virtual-account-numbers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: args.email,
          amount: args.amount,
          tx_ref: reference,
          is_permanent: false,
        }),
      });

      if (!res.ok) throw new Error(`Flutterwave virtual account creation failed: ${await res.text()}`);

      const data = (await res.json()) as {
        status: string;
        data?: {
          account_number: string;
          bank_name: string;
          flw_ref: string;
        };
        message?: string;
      };

      if (data.status !== "success" || !data.data) {
        throw new Error(`Flutterwave error: ${data.message ?? "unknown"}`);
      }

      return {
        accountNumber: data.data.account_number,
        bankName: data.data.bank_name,
        reference: data.data.flw_ref,
      };
    }

    case "monnify": {
      const authRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!authRes.ok) throw new Error(`Monnify auth failed`);

      const auth = (await authRes.json()) as {
        requestSuccessful: boolean;
        responseBody?: { accessToken: string };
      };

      if (!auth.requestSuccessful || !auth.responseBody?.accessToken) {
        throw new Error("Monnify authentication failed");
      }

      const token = auth.responseBody.accessToken;

      const res = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountReference: reference,
          accountName: reference,
          currencyCode: "NGN",
          contractCode: process.env.MONNIFY_CONTRACT_CODE,
          customerEmail: args.email,
          customerName: `Student ${reference}`,
          getAllAvailableBanks: false,
        }),
      });

      if (!res.ok) throw new Error(`Monnify account creation failed: ${await res.text()}`);

      const data = (await res.json()) as {
        requestSuccessful: boolean;
        responseBody?: {
          accountNumber: string;
          bankName: string;
          reservationReference: string;
        };
        responseMessage?: string;
      };

      if (!data.requestSuccessful || !data.responseBody) {
        throw new Error(`Monnify error: ${data.responseMessage ?? "unknown"}`);
      }

      return {
        accountNumber: data.responseBody.accountNumber,
        bankName: data.responseBody.bankName,
        reference: data.responseBody.reservationReference,
      };
    }

    default:
      throw new Error(`Unsupported PSP provider: ${PSP_PROVIDER}`);
  }
}

export async function processPaymentWebhook(args: {
  provider: string;
  signature: string;
  body: unknown;
}) {
  const provider = args.provider as "paystack" | "flutterwave";

  if (provider === "paystack") {
    return handlePaystackWebhook(args);
  }
  if (provider === "flutterwave") {
    return handleFlutterwaveWebhook(args);
  }
  return { processed: false, reason: `unsupported provider: ${provider}` };
}

async function handlePaystackWebhook(args: { body: unknown }) {
  const data = args.body as {
    event: string;
    data: {
      reference: string;
      amount: number;
      status: string;
      gateway_response?: string;
      authorization?: {
        authorization_code?: string;
        bin?: string;
        last4?: string;
        channel?: string;
        account_number?: string;
        bank?: string;
      };
      customer?: { email: string; id?: number };
    };
  };

  if (data.event !== "charge.success") return { processed: false, reason: "non-success event" };
  if (data.data.status !== "success") return { processed: false, reason: `payment status: ${data.data.status}` };

  const transactionRef = data.data.reference;
  const amount = data.data.amount / 100;
  const virtualAccount = data.data.authorization?.account_number;

  const refInvoice = await Invoice.findOne({ pspReference: transactionRef, status: "AWAITING_PAYMENT" });
  const acctInvoice = virtualAccount
    ? await Invoice.findOne({ virtualAccountNumber: virtualAccount, status: "AWAITING_PAYMENT" })
    : null;
  const invoice = refInvoice ?? acctInvoice;

  return finalizePayment({
    invoice,
    provider: "paystack",
    transactionRef,
    amount,
    gatewayResponse: data.data.gateway_response ?? "",
  });
}

async function handleFlutterwaveWebhook(args: { body: unknown }) {
  const data = args.body as {
    event: string;
    event_type?: string;
    data: {
      id: number;
      tx_ref: string;
      flw_ref: string;
      amount: number;
      currency: string;
      status: string;
      customer: { email: string; name?: string };
      account_number?: string;
      bank_name?: string;
      narration?: string;
      created_at?: string;
      amount_settled?: number;
    };
  };

  if (data.event !== "charge.completed") return { processed: false, reason: "non-success event" };
  if (data.data.status !== "successful") return { processed: false, reason: `payment status: ${data.data.status}` };

  const flwRef = data.data.flw_ref;
  const txRef = data.data.tx_ref;
  const accountNumber = data.data.account_number;
  const amount = data.data.amount;

  const flwInvoice = await Invoice.findOne({ pspReference: flwRef, status: "AWAITING_PAYMENT" });
  const acctInvoice = accountNumber
    ? await Invoice.findOne({ virtualAccountNumber: accountNumber, status: "AWAITING_PAYMENT" })
    : null;
  const invoice = flwInvoice ?? acctInvoice;

  return finalizePayment({
    invoice,
    provider: "flutterwave",
    transactionRef: flwRef,
    amount,
    gatewayResponse: `flw_ref: ${flwRef}, tx_ref: ${txRef}, account: ${accountNumber ?? "N/A"}`,
  });
}

async function finalizePayment(args: {
  invoice: Record<string, any> | null;
  provider: string;
  transactionRef: string;
  amount: number;
  gatewayResponse: string;
}) {
  const { invoice, provider, transactionRef, amount, gatewayResponse } = args;

  if (!invoice) {
    const psRef = await PaymentTransaction.findOne({ pspReference: transactionRef });
    if (psRef) return { processed: false, reason: "already processed (found existing transaction)" };
    return { processed: false, reason: `no matching invoice for reference ${transactionRef}` };
  }

  const idempotencyKey = `inbound-${transactionRef}`;
  const existing = await PaymentTransaction.findOne({ idempotencyKey });
  if (existing) return { processed: false, reason: "duplicate webhook (idempotency key exists)" };

  await PaymentTransaction.create({
    tenantId: invoice.tenantId,
    invoiceId: invoice._id,
    amount,
    direction: "INBOUND",
    pspProvider: provider,
    pspReference: transactionRef,
    gatewayResponse,
    status: "SUCCESS",
    idempotencyKey,
  });

  invoice.status = "COLLECTED";
  invoice.paidAt = new Date();
  if (!invoice.pspReference) invoice.pspReference = transactionRef;
  await Invoice.findByIdAndUpdate(invoice._id, {
    $set: {
      status: "COLLECTED",
      paidAt: new Date(),
      pspReference: invoice.pspReference || transactionRef,
    },
  });

  await appendEntry({
    tenantId: invoice.tenantId,
    invoiceId: invoice._id,
    event: "COLLECTED",
    amount,
    transactionId: transactionRef,
    data: { provider, reference: transactionRef },
  });

  await enqueueRemittance({
    invoiceId: invoice._id,
    tenantId: invoice.tenantId,
    governmentAmount: invoice.amount,
    pspReference: transactionRef,
  });

  return { processed: true, invoiceId: invoice._id };
}
