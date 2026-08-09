import { Router } from "express";
import { prisma } from "../db";
import { parseStkCallback, StkCallbackPayload } from "../services/mpesaClient";

export const paymentsRouter = Router();

/**
 * Safaricom posts here asynchronously after the customer completes (or
 * cancels) the STK push. No auth header from Safaricom — verify via the
 * CheckoutRequestID matching a payment you actually created, and consider
 * IP allowlisting Safaricom's callback source in production.
 */
paymentsRouter.post("/mpesa/callback", async (req, res) => {
  const payload = req.body as StkCallbackPayload;
  const result = parseStkCallback(payload);

  const payment = await prisma.payment.findFirst({
    where: { mpesaCheckoutRequestId: result.checkoutRequestId },
  });

  // Always 200 back to Safaricom even if we can't match the payment —
  // returning an error causes Safaricom to retry the callback repeatedly.
  if (!payment) {
    console.warn("[mpesa callback] no matching payment for", result.checkoutRequestId);
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: result.success ? "SUCCESS" : "FAILED",
      mpesaReceiptNumber: result.mpesaReceiptNumber,
      rawCallback: JSON.stringify(payload),
    },
  });

  if (result.success) {
    await prisma.sale.update({
      where: { id: payment.saleId },
      data: { status: "PAID", paidAt: new Date() },
    });
    // Only queue the eTIMS invoice once payment is actually confirmed.
    await prisma.invoice.upsert({
      where: { saleId: payment.saleId },
      create: { saleId: payment.saleId, status: "QUEUED" },
      update: {},
    });
  } else {
    await prisma.sale.update({ where: { id: payment.saleId }, data: { status: "CANCELLED" } });
  }

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/** Cashier's screen polls this while waiting for the STK push to resolve. */
paymentsRouter.get("/status/:saleId", async (req, res) => {
  const sale = await prisma.sale.findUnique({
    where: { id: req.params.saleId },
    include: { payments: true },
  });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  res.json({ status: sale.status, payments: sale.payments });
});
