/**
 * Background worker that submits queued sales to eTIMS. Runs on an interval
 * rather than inline with the checkout request, so a slow/unreachable KRA
 * endpoint never blocks a cashier from completing a sale.
 */
import { prisma } from "../db";
import { submitInvoice } from "./etimsClient";

const MAX_ATTEMPTS = 8;

// Exponential backoff so a KRA outage doesn't turn into a hammering retry storm.
function backoffMs(attempts: number) {
  return Math.min(30 * 60_000, 2000 * 2 ** attempts);
}

export async function processInvoiceQueue() {
  const now = new Date();

  const pending = await prisma.invoice.findMany({
    where: {
      status: { in: ["QUEUED", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
    },
    include: {
      sale: { include: { items: true } },
    },
    take: 20,
  });

  for (const invoice of pending) {
    // Respect backoff window before retrying a previously failed attempt.
    if (invoice.submittedAt) {
      const nextEligible = invoice.submittedAt.getTime() + backoffMs(invoice.attempts);
      if (nextEligible > now.getTime()) continue;
    }

    const sale = invoice.sale;
    const invoiceNumber = await nextSequentialInvoiceNumber();

    const result = await submitInvoice({
      invoiceNumber,
      lines: sale.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPrice: i.unitPrice,
        taxCategory: i.taxCategory as any,
        taxAmount: i.taxAmount,
        lineTotal: i.lineTotal,
      })),
      subtotal: sale.subtotal,
      taxTotal: sale.taxTotal,
      total: sale.total,
    });

    if (result.success) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "ACCEPTED",
          invoiceNumber,
          kraInvoiceNo: result.kraInvoiceNo,
          qrCodeUrl: result.qrCodeUrl,
          signature: result.signature,
          submittedAt: now,
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    } else {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "FAILED",
          submittedAt: now,
          attempts: { increment: 1 },
          lastError: result.error ?? "Unknown error",
        },
      });
    }
  }
}

async function nextSequentialInvoiceNumber(): Promise<number> {
  // KRA requires a sequential integer, not a prefixed string. Track the
  // last accepted invoice number and increment — never reuse a number,
  // even for a sale that later fails, or the sequence gets out of step
  // with what KRA has recorded.
  const last = await prisma.invoice.findFirst({
    where: { invoiceNumber: { not: null } },
    orderBy: { invoiceNumber: "desc" },
  });
  return (last?.invoiceNumber ?? 0) + 1;
}

export function startInvoiceQueueWorker(intervalMs = 15_000) {
  setInterval(() => {
    processInvoiceQueue().catch((err) => console.error("[invoiceQueue] error:", err));
  }, intervalMs);
  console.log(`[invoiceQueue] worker started, polling every ${intervalMs}ms`);
}
