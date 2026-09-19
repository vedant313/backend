import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import businessRoutes from "./routes/business.js";
import documentsRoutes from "./routes/documents.js";
import paymentsRoutes from "./routes/payments.js";
import subscriptionRoutes from "./routes/subscription.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" })); // higher limit so a base64 logo image can be saved

// Sign up / log in — public.
app.use("/api/auth", authRoutes);

// Everything below requires a signed-in user; each user only ever sees
// their own business profile, invoices/estimates and payments.
app.use("/api/business", requireAuth, businessRoutes);
app.use("/api/documents", requireAuth, documentsRoutes);
app.use("/api/payments", requireAuth, paymentsRoutes);
app.use("/api/subscription", requireAuth, subscriptionRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`BillBook backend running on http://localhost:${PORT}`);
});
