import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { productsRouter } from "./routes/products";
import { salesRouter } from "./routes/sales";
import { paymentsRouter } from "./routes/payments";
import { invoicesRouter } from "./routes/invoices";
import { startInvoiceQueueWorker } from "./services/invoiceQueue";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/sales", salesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/invoices", invoicesRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`POS backend listening on :${PORT}`);
  startInvoiceQueueWorker();
});
