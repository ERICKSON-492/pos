import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../db";

async function main() {
  const business = await prisma.business.create({
    data: { name: "Demo Retail Ltd", kraPin: "P000000000A" },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "Main Branch" },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      name: "Admin User",
      email: "admin@demo.co.ke",
      password: passwordHash,
      role: "ADMIN",
    },
  });

  await prisma.product.createMany({
    data: [
      { businessId: business.id, name: "500ml Water", sku: "WTR-500", price: 50, taxCategory: "B", stockQty: 200 },
      { businessId: business.id, name: "Bread", sku: "BRD-001", price: 65, taxCategory: "C", stockQty: 80 },
      { businessId: business.id, name: "Cooking Oil 1L", sku: "OIL-1L", price: 320, taxCategory: "B", stockQty: 60 },
    ],
  });

  console.log("Seeded:", { businessId: business.id, branchId: branch.id, adminEmail: admin.email });
}

main().finally(() => prisma.$disconnect());
