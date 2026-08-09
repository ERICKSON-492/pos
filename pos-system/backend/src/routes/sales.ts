import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { calcLineTax } from "../lib/tax";
import { initiateStkPush } from "../services/mpesaClient";

export const salesRouter = Router();
salesRouter.use(requireAuth);

const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.string(), qty: z.number().positive() })).min(1),
  paymentMethod: z.enum(["MPESA", "CARD", "CASH"]),
  phoneNumber: z.string().optional(), // required for MPESA
});

/**
 * Creates a sale, computes totals, records the payment, and queues the
 * eTIMS invoice submission. The eTIMS call itself does NOT happen here —
 * see services/invoiceQueue.ts — so checkout stays fast even if KRA's
 * endpoint is slow or briefly unreachable.
 */
salesRouter.post("/checkout", async (req: AuthedRequest, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { items, paymentMethod, phoneNumber } = parsed.data;

  if (paymentMethod === "MPESA" && !phoneNumber) {
    return res.status(400).json({ error: "phoneNumber is required for M-Pesa payments" });
  }
  if (!req.user!.branchId) {
    return res.status(400).json({ error: "User has no assigned branch" });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
  });
  if (products.length !== items.length) {
    return res.status(400).json({ error: "One or more products not found" });
  }

  let subtotal = 0;
  let taxTotal = 0;
  const lineData = items.map((item) => {
    const product = products.find((p) => p.id === item.productId)!;
    const { lineTotal, taxAmount } = calcLineTax(product.price, item.qty, product.taxCategory);
    subtotal += lineTotal - taxAmount;
    taxTotal += taxAmount;
    return {
      productId: product.id,
      name: product.name,
      qty: item.qty,
      unitPrice: product.price,
      taxCategory: product.taxCategory,
      taxAmount,
      lineTotal,
    };
  });
  const total = subtotal + taxTotal;

  const sale = await prisma.sale.create({
    data: {
      branchId: req.user!.branchId,
      cashierId: req.user!.id,
      status: paymentMethod === "CASH" ? "PAID" : "AWAITING_PAYMENT",
      subtotal,
      taxTotal,
      total,
      paidAt: paymentMethod === "CASH" ? new Date() : null,
      items: { create: lineData },
    },
    include: { items: true },
  });

  // Decrement stock immediately — reconcile/reverse if payment later fails.
  for (const item of items) {
    await prisma.product.update({
      where: { id: item.productId },
      data: { stockQty: { decrement: item.qty } },
    });
  }

  if (paymentMethod === "CASH") {
    await prisma.payment.create({
      data: { saleId: sale.id, method: "CASH", amount: total, status: "SUCCESS" },
    });
    await prisma.invoice.create({ data: { saleId: sale.id, status: "QUEUED" } });
    return res.status(201).json({ sale, message: "Sale completed" });
  }

  if (paymentMethod === "MPESA") {
    const payment = await prisma.payment.create({
      data: { saleId: sale.id, method: "MPESA", amount: total, status: "PENDING" },
    });

    try {
      const stk = await initiateStkPush({
        phoneNumber: phoneNumber!,
        amount: total,
        accountReference: sale.id,
        transactionDesc: `Sale ${sale.id}`,
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { mpesaCheckoutRequestId: stk.CheckoutRequestID },
      });
      return res.status(201).json({ sale, stkPush: stk, message: "STK push sent — awaiting customer confirmation" });
    } catch (err: any) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      return res.status(502).json({ error: "Failed to initiate M-Pesa payment", details: err?.message });
    }
  }

  // CARD: integrate a gateway (Pesapal/Flutterwave) the same way — create a
  // PENDING payment, redirect/charge via their API, confirm via webhook.
  await prisma.payment.create({
    data: { saleId: sale.id, method: "CARD", amount: total, status: "PENDING" },
  });
  return res.status(201).json({ sale, message: "Card payment initiation not yet wired to a gateway" });
});

salesRouter.get("/:id", async (req: AuthedRequest, res) => {
  const sale = await prisma.sale.findUnique({
    where: { id: req.params.id },
    include: { items: true, payments: true, invoice: true },
  });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  res.json(sale);
});

salesRouter.get("/", async (req: AuthedRequest, res) => {
  const sales = await prisma.sale.findMany({
    where: { branchId: req.user!.branchId ?? undefined },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { items: true, payments: true, invoice: true },
  });
  res.json(sales);
});
