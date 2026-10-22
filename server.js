import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import firebasePhoneAuthRoutes from "./routes/firebasePhoneAuth.js";
import businessRoutes from "./routes/business.js";
import documentsRoutes from "./routes/documents.js";
import paymentsRoutes from "./routes/payments.js";
import subscriptionRoutes, { handleCashfreeWebhook } from "./routes/subscription.js";
import productRoutes from "./routes/products.js";
import customerRoutes from "./routes/customers.js";
import expenseRoutes from "./routes/expenses.js";
import recurringRoutes from "./routes/recurring.js";
import adminRoutes from "./routes/admin.js";
import companiesRoutes from "./routes/companies.js";
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

app.post("/api/subscription/cashfree/webhook", handleCashfreeWebhook);
app.use("/api/auth", authRoutes);
app.use("/api/auth", firebasePhoneAuthRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/companies", requireAuth, companiesRoutes);

app.use("/api/business", requireAuth, businessRoutes);
app.use("/api/documents", requireAuth, documentsRoutes);
app.use("/api/payments", requireAuth, paymentsRoutes);
app.use("/api/subscription", requireAuth, subscriptionRoutes);
app.use("/api/products", requireAuth, productRoutes);
app.use("/api/customers", requireAuth, customerRoutes);
app.use("/api/expenses", requireAuth, expenseRoutes);
app.use("/api/recurring", requireAuth, recurringRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Billbook backend running on http://localhost:${PORT}`));
