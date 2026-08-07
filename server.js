import express from "express";
import cors from "cors";
import businessRoutes from "./routes/business.js";
import documentsRoutes from "./routes/documents.js";
import paymentsRoutes from "./routes/payments.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" })); // higher limit so a base64 logo image can be saved

app.use("/api/business", businessRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/payments", paymentsRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`BillBook backend running on http://localhost:${PORT}`);
});
