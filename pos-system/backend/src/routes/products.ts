import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth";

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get("/", async (req: AuthedRequest, res) => {
  const products = await prisma.product.findMany({
    where: { businessId: req.user!.businessId, active: true },
    orderBy: { name: "asc" },
  });
  res.json(products);
});

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  unspscCode: z.string().optional(),
  price: z.number().positive(),
  taxCategory: z.enum(["A", "B", "C", "D", "E"]).default("B"),
  stockQty: z.number().default(0),
});

productsRouter.post("/", requireRole("ADMIN", "MANAGER"), async (req: AuthedRequest, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const product = await prisma.product.create({
    data: { ...parsed.data, businessId: req.user!.businessId },
  });
  res.status(201).json(product);
});

productsRouter.patch("/:id/stock", requireRole("ADMIN", "MANAGER"), async (req: AuthedRequest, res) => {
  const { delta } = z.object({ delta: z.number() }).parse(req.body);
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: { stockQty: { increment: delta } },
  });
  res.json(product);
});
