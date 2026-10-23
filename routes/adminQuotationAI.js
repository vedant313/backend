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
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
        { text: "Analyze this customer quotation PDF. Return ONLY valid JSON with keys documentTitle (string), pageCount (number), summary (string), fields (array). Each field must have key (camelCase unique identifier), label (human-friendly label), currentValue (string), page (1-based integer), confidence (number 0..1), editable (boolean), type (one of text, number, date, table, address), reason (short string), and bbox (object with x,y,width,height integers from 0 to 1000 representing the exact text/value area normalized to page width/height, origin at top-left). Only include a field as editable if you can estimate its visible value area bbox. For totals, dates and names, bbox must cover only the old value, not the label. Identify customer-specific and variable fields such as customer name/address, quote number/date, quantities, item descriptions, rates, tax, totals, system size and payment terms. Include all relevant pages, avoid duplicating the same field, preserve the source's meaning, and do not infer values that are not visible. This output is for admin review; do not claim exact text coordinates or promise perfect layout reproduction." }
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
      bbox: field.bbox && [field.bbox.x, field.bbox.y, field.bbox.width, field.bbox.height].every((n) => Number.isFinite(Number(n))) ? { x: Math.max(0, Math.min(1000, Number(field.bbox.x))), y: Math.max(0, Math.min(1000, Number(field.bbox.y))), width: Math.max(1, Math.min(1000, Number(field.bbox.width))), height: Math.max(1, Math.min(1000, Number(field.bbox.height))) } : null,
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
    let values, fields;
    try {
      values = JSON.parse(String(req.body?.values || "{}"));
      fields = JSON.parse(String(req.body?.fields || "[]"));
    } catch { return res.status(400).json({ error: "Quotation values or field positions are invalid." }); }
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 150 || !Array.isArray(fields)) return res.status(400).json({ error: "Invalid quotation fields." });
    if (process.env.PDF_OCR_SERVICE_URL) {
      const form = new FormData();
      form.append("pdf", new Blob([req.file.buffer], { type: "application/pdf" }), req.file.originalname || "quotation.pdf");
      form.append("values", JSON.stringify(values));
      form.append("fields", JSON.stringify(fields));
      const serviceUrl = process.env.PDF_OCR_SERVICE_URL.replace(/\\/$/, "");
      const serviceResponse = await fetch(serviceUrl + "/render", { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
      if (!serviceResponse.ok) {
        const message = await serviceResponse.text().catch(() => "");
        return res.status(serviceResponse.status === 422 ? 422 : 502).json({ error: message.slice(0, 400) || "OCR reconstruction service failed." });
      }
      const rendered = Buffer.from(await serviceResponse.arrayBuffer());
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="nexsa-ocr-reconstructed.pdf"');
      res.setHeader("Content-Length", rendered.length);
      res.setHeader("X-PDF-Mode", "ocr-reconstruction");
      return res.send(rendered);
    }
    const pdf = await PDFDocument.load(req.file.buffer);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    let applied = 0;
    for (const field of fields.slice(0, 150)) {
      if (!field || !field.editable || !field.bbox || !Object.prototype.hasOwnProperty.call(values, field.key)) continue;
      const pageIndex = Number(field.page) - 1;
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) continue;
      const { x, y, width, height } = field.bbox;
      if (![x, y, width, height].every((n) => Number.isFinite(Number(n))) || Number(width) <= 0 || Number(height) <= 0) continue;
      const page = pages[pageIndex];
      const size = page.getSize();
      const left = Math.max(0, Math.min(size.width, Number(x) / 1000 * size.width));
      const top = Math.max(0, Math.min(size.height, Number(y) / 1000 * size.height));
      const boxWidth = Math.max(1, Math.min(size.width - left, Number(width) / 1000 * size.width));
      const boxHeight = Math.max(1, Math.min(size.height - top, Number(height) / 1000 * size.height));
      if (boxWidth < 2 || boxHeight < 2) continue;
      const bottom = size.height - top - boxHeight;
      page.drawRectangle({ x: left, y: bottom, width: boxWidth, height: boxHeight, color: rgb(1, 1, 1), opacity: 1 });
      const value = String(values[field.key] ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 300);
      if (value) {
        const fontSize = Math.max(5, Math.min(16, boxHeight * 0.72));
        page.drawText(value, { x: left + 1, y: Math.max(1, bottom + (boxHeight - fontSize) / 2), size: fontSize, font, maxWidth: Math.max(1, boxWidth - 2), color: rgb(0.08, 0.08, 0.08), lineHeight: fontSize });
      }
      applied++;
    }
    if (!applied) return res.status(422).json({ error: "AI did not return reliable editable positions for this PDF. This file may need manual field placement or OCR; no PDF was changed." });
    const output = Buffer.from(await pdf.save());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="nexsa-custom-quotation-edited.pdf"');
    res.setHeader("Content-Length", output.length);
    res.setHeader("X-Fields-Applied", String(applied));
    res.send(output);
  } catch (error) {
    console.error("Custom quotation render error:", error.message);
    res.status(400).json({ error: "Could not edit this PDF. Check that it is not password-protected or corrupted." });
  }
});

router.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "PDF must be 12 MB or smaller." });
  if (error) return res.status(400).json({ error: error.message || "Invalid upload." });
  return res.status(500).json({ error: "Unexpected upload error." });
});

export default router;
