import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db.js";
import { getAccessState } from "../middleware/subscription.js";

const router = Router();
const publicRouter = Router();
const RESERVED_SLUGS = new Set(["www", "billbook", "studio", "api", "admin", "mail", "support", "help", "static", "assets"]);
const SECTION_TYPES = new Set(["hero", "about", "services", "products", "gallery", "testimonials", "contact", "map"]);

export const WEBSITE_TEMPLATES = [
  ["modern-business","Modern Business","General","Clean professional layout","#17243b","#0f9b8e"],
  ["corporate-pro","Corporate Pro","Corporate","Structured business presentation","#17243b","#b68a52"],
  ["retail-store","Retail Store","Retail","Product-focused storefront","#202020","#c46b42"],
  ["fashion-boutique","Fashion Boutique","Fashion","Editorial boutique styling","#292323","#b77c82"],
  ["electronics-hub","Electronics Hub","Retail","Modern technology shop","#172b3a","#16a3a3"],
  ["solar-energy","Solar Energy","Energy","Renewable energy company layout","#263a2e","#9aaf55"],
  ["professional-services","Professional Services","Services","Trust-focused service business","#24324a","#9b835e"],
  ["restaurant-cafe","Restaurant & Cafe","Food","Warm menu and location layout","#3a2922","#c47d45"],
  ["health-wellness","Health & Wellness","Wellness","Calm and accessible presentation","#24423d","#86a99b"],
  ["real-estate","Real Estate","Property","Property listings and enquiries","#26344a","#c39a62"],
  ["creative-studio","Creative Studio","Creative","Portfolio-led visual layout","#28263d","#9b8bd1"],
  ["local-business","Local Business","General","Simple local business homepage","#27343c","#d18a4c"],
].map(([id,name,category,description,primaryColor,accentColor]) => ({ id,name,category,description,primaryColor,accentColor }));

function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function text(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function safeColor(value, fallback) { return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : fallback; }
function safeImage(value) {
  const v = text(value, 1000);
  try { const u = new URL(v); return u.protocol === "https:" ? v : ""; } catch { return ""; }
}
function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 24).map(item => ({
    title: text(item?.title, 100),
    description: text(item?.description, 300),
    price: text(item?.price, 40),
    imageUrl: safeImage(item?.imageUrl),
  }));
}
function cleanSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.filter(s => SECTION_TYPES.has(s?.type)).slice(0, 12).map(s => ({
    type: s.type,
    enabled: s.enabled !== false,
    title: text(s.title, 120),
    body: text(s.body, 1200),
    imageUrl: safeImage(s.imageUrl),
    items: cleanItems(s.items),
  }));
}
function cleanWebsiteInput(input, existing = {}) {
  const template = WEBSITE_TEMPLATES.find(t => t.id === input?.templateId) || WEBSITE_TEMPLATES.find(t => t.id === existing.templateId) || WEBSITE_TEMPLATES[0];
  const businessName = text(input?.businessName ?? existing.businessName, 100);
  const slug = slugify(input?.slug ?? existing.slug ?? businessName);
  if (!businessName) throw Object.assign(new Error("Business name is required."), { status: 400 });
  if (!slug || RESERVED_SLUGS.has(slug)) throw Object.assign(new Error("Choose a different website address."), { status: 400 });
  return {
    businessName, slug, templateId: template.id,
    tagline: text(input?.tagline ?? existing.tagline, 180),
    description: text(input?.description ?? existing.description, 1600),
    phone: text(input?.phone ?? existing.phone, 30),
    whatsapp: text(input?.whatsapp ?? existing.whatsapp, 30).replace(/[^0-9+]/g, ""),
    email: text(input?.email ?? existing.email, 160),
    address: text(input?.address ?? existing.address, 400),
    logoUrl: safeImage(input?.logoUrl ?? existing.logoUrl),
    heroImageUrl: safeImage(input?.heroImageUrl ?? existing.heroImageUrl),
    primaryColor: safeColor(input?.primaryColor ?? existing.primaryColor, template.primaryColor),
    accentColor: safeColor(input?.accentColor ?? existing.accentColor, template.accentColor),
    sections: cleanSections(input?.sections ?? existing.sections ?? [
      { type:"hero", enabled:true, title:businessName, body:text(input?.tagline ?? existing.tagline,180) },
      { type:"about", enabled:true, title:"About us", body:text(input?.description ?? existing.description,1200) },
      { type:"services", enabled:true, title:"Our services", items:[] },
      { type:"contact", enabled:true, title:"Get in touch", body:"We would love to hear from you." },
    ]),
  };
}
async function getWebsites() {
  const db = await getDb();
  const col = db.collection("businessWebsites");
  await col.createIndex({ userId: 1 }, { unique: true });
  await col.createIndex({ slug: 1 }, { unique: true });
  return col;
}
async function getEnquiries() {
  const db = await getDb();
  const col = db.collection("websiteEnquiries");
  await col.createIndex({ websiteId: 1, createdAt: -1 });
  return col;
}
async function requireAdvanced(req, res, next) {
  try {
    const access = await getAccessState(req.userId);
    if (access.mode === "owner" || (access.mode === "paid" && access.plan === "advanced")) return next();
    return res.status(403).json({ error: "Nexsa Website Studio is available on the Advanced Plan.", code: "ADVANCED_PLAN_REQUIRED", requiredPlan: "advanced" });
  } catch (error) {
    console.error("Website plan check failed:", error);
    return res.status(500).json({ error: "Could not verify your subscription." });
  }
}
function publicShape(site) {
  if (!site || site.status !== "published") return null;
  const { _id, userId, ...safe } = site;
  return safe;
}

router.get("/templates", (req, res) => res.json({ templates: WEBSITE_TEMPLATES }));
router.get("/my", async (req, res) => {
  try {
    const col = await getWebsites();
    const site = await col.findOne({ userId: req.userId }, { projection: { _id: 0 } });
    res.json(site || null);
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not load your website." }); }
});
router.post("/", requireAdvanced, async (req, res) => {
  try {
    const col = await getWebsites();
    const existing = await col.findOne({ userId: req.userId });
    if (existing) return res.status(409).json({ error: "You already have a website. Edit your existing website instead." });
    const input = cleanWebsiteInput(req.body);
    const conflict = await col.findOne({ slug: input.slug });
    if (conflict) return res.status(409).json({ error: "This website address is already taken. Try another name.", code: "SLUG_TAKEN" });
    const now = new Date().toISOString();
    const site = { id: uuid(), userId: req.userId, ...input, status: "draft", createdAt: now, updatedAt: now, publishedAt: null };
    await col.insertOne(site);
    const { _id, userId, ...safe } = site;
    res.status(201).json(safe);
  } catch (error) { console.error(error); res.status(error.status || 500).json({ error: error.message || "Could not create website." }); }
});
router.put("/:id", requireAdvanced, async (req, res) => {
  try {
    const col = await getWebsites();
    const current = await col.findOne({ id: req.params.id, userId: req.userId });
    if (!current) return res.status(404).json({ error: "Website not found." });
    const input = cleanWebsiteInput(req.body, current);
    const conflict = await col.findOne({ slug: input.slug, id: { $ne: current.id } });
    if (conflict) return res.status(409).json({ error: "This website address is already taken.", code: "SLUG_TAKEN" });
    const updatedAt = new Date().toISOString();
    await col.updateOne({ id: current.id, userId: req.userId }, { $set: { ...input, updatedAt } });
    const saved = await col.findOne({ id: current.id, userId: req.userId }, { projection: { _id: 0, userId: 0 } });
    res.json(saved);
  } catch (error) { console.error(error); res.status(error.status || 500).json({ error: error.message || "Could not save website." }); }
});
router.post("/:id/publish", requireAdvanced, async (req, res) => {
  try {
    const col = await getWebsites();
    const site = await col.findOne({ id: req.params.id, userId: req.userId });
    if (!site) return res.status(404).json({ error: "Website not found." });
    if (!site.businessName || !site.slug) return res.status(400).json({ error: "Add your business name before publishing." });
    const now = new Date().toISOString();
    await col.updateOne({ id: site.id, userId: req.userId }, { $set: { status: "published", publishedAt: now, updatedAt: now } });
    const domain = (process.env.WEBSITE_BASE_DOMAIN || "nexsatechnologies.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
    res.json({ ok: true, status: "published", url: `https://${site.slug}.${domain}`, publishedAt: now });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not publish website." }); }
});
router.post("/:id/unpublish", async (req, res) => {
  try {
    const col = await getWebsites();
    const result = await col.updateOne({ id: req.params.id, userId: req.userId }, { $set: { status: "draft", updatedAt: new Date().toISOString() } });
    if (!result.matchedCount) return res.status(404).json({ error: "Website not found." });
    res.json({ ok: true, status: "draft" });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not unpublish website." }); }
});
router.get("/:id/enquiries", async (req, res) => {
  try {
    const col = await getWebsites();
    const site = await col.findOne({ id: req.params.id, userId: req.userId });
    if (!site) return res.status(404).json({ error: "Website not found." });
    const enquiries = await getEnquiries();
    const items = await enquiries.find({ websiteId: site.id }).sort({ createdAt: -1 }).limit(100).toArray();
    res.json(items.map(({ _id, ...item }) => item));
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not load enquiries." }); }
});

publicRouter.get("/:slug", async (req, res) => {
  try {
    const col = await getWebsites();
    const site = await col.findOne({ slug: slugify(req.params.slug), status: "published" });
    const safe = publicShape(site);
    if (!safe) return res.status(404).json({ error: "Website not found." });
    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.json(safe);
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not load website." }); }
});
publicRouter.post("/:slug/enquiries", async (req, res) => {
  try {
    const col = await getWebsites();
    const site = await col.findOne({ slug: slugify(req.params.slug), status: "published" }, { projection: { id: 1 } });
    if (!site) return res.status(404).json({ error: "Website not found." });
    const name = text(req.body?.name, 100);
    const message = text(req.body?.message, 1200);
    const phone = text(req.body?.phone, 30);
    const email = text(req.body?.email, 160);
    if (!name || (!phone && !email) || !message) return res.status(400).json({ error: "Name, contact detail and message are required." });
    const enquiries = await getEnquiries();
    await enquiries.insertOne({ id: uuid(), websiteId: site.id, name, phone, email, message, createdAt: new Date().toISOString() });
    res.status(201).json({ ok: true, message: "Your enquiry has been sent." });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not send enquiry." }); }
});

export { publicRouter as publicWebsiteRoutes };
export default router;
