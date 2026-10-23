import { Router } from "express";
import multer from "multer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const validName = String(file.originalname || "").toLowerCase().endsWith(".pdf");
    const validType = file.mimetype === "application/pdf" || file.mimetype === "application/octet-stream";
    cb(validName && validType ? null : new Error("Upload a PDF file only."), validName && validType);
  },
});

const ADMIN_EMAIL = "nexsatechnologies@gmail.com";
const ADMIN_PHONE = "+919370017895";
function requireAdmin(req, res, next) {
  const allowed = String(process.env.ADMIN_EMAILS || ADMIN_EMAIL).split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  const emailAllowed = allowed.includes(String(req.user?.email || "").trim().toLowerCase());
  const phoneAllowed = String(req.user?.phone || "") === ADMIN_PHONE && Boolean(req.user?.phoneVerifiedAt);
  if (!emailAllowed && !phoneAllowed) return res.status(403).json({ error: "Admin access required." });
  next();
}
router.use(requireAdmin);

function parseModelJson(text) {
  const clean = String(text || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return JSON.parse(clean);
}
async function analyzeWithGemini(buffer, mimeType = "application/pdf") {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("Gemini is not configured. Add GEMINI_API_KEY to the backend environment."), { status: 503 });
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
        { text: "Analyze this customer quotation PDF. Return ONLY valid JSON with keys documentTitle (string), pageCount (number), summary (string), fields (array). Each field must have key (camelCase unique identifier), label (human-friendly label), currentValue (string), page (1-based integer), confidence (number 0..1), editable (boolean), type (one of text, number, date, table, address), and reason (short string). Identify customer-specific and variable fields such as customer name/address, quote number/date, quantities, item descriptions, rates, tax, totals, system size and payment terms. Include all relevant pages, avoid duplicating the same field, preserve the source's meaning, and do not infer values that are not visible. This output is for admin review; do not claim exact text coordinates or promise perfect layout reproduction." }
      ] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Gemini document analysis failed.";
    throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : 502 });
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  return parseModelJson(text);
}

router.post("/analyze", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a PDF file to analyze." });
    if (!req.file.buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) return res.status(400).json({ error: "The uploaded file does not have a valid PDF signature." });
    const result = await analyzeWithGemini(req.file.buffer);
    const fields = Array.isArray(result.fields) ? result.fields.slice(0, 150).map((field, index) => ({
      key: String(field.key || ("field" + (index + 1))).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 60) || ("field" + (index + 1)),
      label: String(field.label || field.key || ("Field " + (index + 1))).slice(0, 140),
      currentValue: String(field.currentValue ?? "").slice(0, 2000),
      page: Math.max(1, Math.min(200, Number(field.page) || 1)),
      confidence: Math.max(0, Math.min(1, Number(field.confidence) || 0)),
      editable: field.editable !== false,
      type: ["text", "number", "date", "table", "address"].includes(field.type) ? field.type : "text",
      reason: String(field.reason || "").slice(0, 240),
    })) : [];
    if (!fields.length) return res.status(422).json({ error: "AI could not find editable fields in this PDF. Try a clearer PDF." });
    res.json({ documentTitle: String(result.documentTitle || req.file.originalname).slice(0, 180), pageCount: Math.max(1, Number(result.pageCount) || 1), summary: String(result.summary || "").slice(0, 1000), sourceFileName: req.file.originalname.slice(0, 180), fields, notice: "AI suggestions need admin review. Exact text positions are not guaranteed." });
  } catch (error) {
    console.error("Custom quotation analysis error:", error.message);
    res.status(error.status || 502).json({ error: error.status === 429 ? "Gemini rate limit reached. Wait and try again." : (error.message || "Could not analyze this PDF.") });
  }
});

router.post("/render", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload the original PDF again to generate the quotation." });
    if (!req.file.buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) return res.status(400).json({ error: "The uploaded file is not a valid PDF." });
    let values;
    try { values = JSON.parse(String(req.body?.values || "{}")); } catch { return res.status(400).json({ error: "Quotation values must be valid JSON." }); }
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 150) return res.status(400).json({ error: "Invalid quotation fields." });
    const pdf = await PDFDocument.load(req.file.buffer);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    // Safe first MVP: append a clearly labelled filled-values sheet, rather than
    // guessing coordinates and accidentally overwriting the customer's original PDF.
    const page = pdf.addPage([595.28, 841.89]);
    const margin = 42;
    page.drawText("CUSTOM QUOTATION — REVIEW COPY", { x: margin, y: 790, size: 15, font, color: rgb(0.12, 0.12, 0.12) });
    page.drawText("Original PDF: " + String(req.file.originalname || "quotation.pdf").slice(0, 70), { x: margin, y: 765, size: 8, font, color: rgb(0.35, 0.35, 0.35) });
    let y = 730;
    for (const [rawKey, rawValue] of Object.entries(values)) {
      const label = String(rawKey).replace(/([A-Z])/g, " $1").slice(0, 55);
      const value = String(rawValue ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 160);
      if (y < 55) break;
      page.drawText(label + ": " + value, { x: margin, y, size: 9, font, maxWidth: 510, color: rgb(0.1, 0.1, 0.1) });
      y -= 18;
    }
    page.drawText("Note: This is a review sheet. Original pages are preserved; values have not been overlaid onto their original positions.", { x: margin, y: 35, size: 7, font, maxWidth: 510, color: rgb(0.4, 0.4, 0.4) });
    const output = Buffer.from(await pdf.save());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="nexsa-custom-quotation-review.pdf"');
    res.setHeader("Content-Length", output.length);
    res.send(output);
  } catch (error) {
    console.error("Custom quotation render error:", error.message);
    res.status(400).json({ error: "Could not generate PDF. Check that the uploaded PDF is not password-protected or corrupted." });
  }
});

router.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "PDF must be 12 MB or smaller." });
  if (error) return res.status(400).json({ error: error.message || "Invalid upload." });
  return res.status(500).json({ error: "Unexpected upload error." });
});

export default router;
