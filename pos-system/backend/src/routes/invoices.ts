import { Router } from "express";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { processInvoiceQueue } from "../services/invoiceQueue";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

invoicesRouter.get("/", requireRole("ADMIN", "MANAGER"), async (_req, res) => {
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { sale: true },
  });
  res.json(invoices);
});

/** Manual trigger — useful for testing without waiting on the poll interval. */
invoicesRouter.post("/process-queue", requireRole("ADMIN"), async (_req, res) => {
  await processInvoiceQueue();
  res.json({ message: "Queue processed" });
});
