import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import businessRoutes from "./routes/business.js";
import documentsRoutes from "./routes/documents.js";
import paymentsRoutes from "./routes/payments.js";
import subscriptionRoutes, { handleCashfreeWebhook } from "./routes/subscription.js";
import productRoutes from "./routes/products.js";
import customerRoutes from "./routes/customers.js";
import expenseRoutes from "./routes/expenses.js";
import recurringRoutes from "./routes/recurring.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    if (req.originalUrl === "/api/subscription/cashfree/webhook") req.rawBody = buf.toString("utf8");
  },
}));

// Cashfree calls this public endpoint directly. Signature verification happens before processing.
app.post("/api/subscription/cashfree/webhook", handleCashfreeWebhook);

// Sign up / log in — public.
app.use("/api/auth", authRoutes);

// Everything below requires a signed-in user; each user only ever sees
// their own business profile, invoices/estimates and payments.
app.use("/api/business", requireAuth, businessRoutes);
app.use("/api/documents", requireAuth, documentsRoutes);
app.use("/api/payments", requireAuth, paymentsRoutes);
app.use("/api/subscription", requireAuth, subscriptionRoutes);
app.use("/api/products", requireAuth, productRoutes);
app.use("/api/customers", requireAuth, customerRoutes);
app.use("/api/expenses", requireAuth, expenseRoutes);
app.use("/api/recurring", requireAuth, recurringRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Billbook backend running on http://localhost:${PORT}`);
});
