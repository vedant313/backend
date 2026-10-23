import { Router } from "express";
import { getDb, getUsersCollection } from "../db.js";

const router = Router();
const ADMIN_EMAIL = "nexsatechnologies@gmail.com";
const ADMIN_PHONE = "+919370017895";

function requireAdmin(req, res, next) {
  const allowed = String(process.env.ADMIN_EMAILS || ADMIN_EMAIL)
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  const emailAllowed = allowed.includes(String(req.user?.email || "").trim().toLowerCase());
  const phoneAllowed = String(req.user?.phone || "") === ADMIN_PHONE && Boolean(req.user?.phoneVerifiedAt);
  if (!emailAllowed && !phoneAllowed) return res.status(403).json({ error: "Admin access required." });
  next();
}

router.use(requireAdmin);

router.get("/overview", async (req, res) => {
  try {
    const db = await getDb();
    const users = await getUsersCollection();
    const [totalUsers, newUsers, activeSubs, paymentRequests, paidOrders] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 86400000).toISOString() } }),
      db.collection("subscriptions").countDocuments({ status: "active", plan: { $ne: "free" } }),
      db.collection("subscriptionPayments").countDocuments({ status: { $in: ["pending", "submitted", "pending_review"] } }),
      db.collection("cashfreeOrders").find({ status: "paid" }, { projection: { amount: 1 } }).toArray(),
    ]);
    res.json({
      totalUsers, newUsersLast30Days: newUsers, activePaidSubscriptions: activeSubs,
      pendingPaymentRequests: paymentRequests,
      paidOrderValue: paidOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0),
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    res.status(500).json({ error: "Could not load admin overview." });
  }
});

router.get("/users", async (req, res) => {
  try {
    const users = await getUsersCollection();
    const db = await getDb();
    const query = String(req.query.q || "").trim();
    const filter = query ? {
      $or: [
        { name: { $regex: escapeRegex(query), $options: "i" } },
        { email: { $regex: escapeRegex(query), $options: "i" } },
        { phone: { $regex: escapeRegex(query), $options: "i" } },
      ],
    } : {};
    const page = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || "50", 10) || 50));
    const [total, records] = await Promise.all([
      users.countDocuments(filter),
      users.find(filter, { projection: { passwordHash: 0, _id: 0 } })
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    ]);
    const ids = records.map((user) => user.id);
    const subscriptions = await db.collection("subscriptions").find({ userId: { $in: ids } }).toArray();
    const subscriptionMap = new Map(subscriptions.map((sub) => [sub.userId, sub]));
    const safeUsers = records.map((user) => {
      const sub = subscriptionMap.get(user.id);
      return {
        id: user.id, name: user.name || "", email: user.email || "",
        phone: user.phone || "", createdAt: user.createdAt || null,
        trialEndsAt: user.trialEndsAt || null, authProvider: user.authProvider || "email",
        phoneVerifiedAt: user.phoneVerifiedAt || null,
        status: user.status || "active",
        subscription: sub ? { plan: sub.plan || "free", planName: sub.planName || sub.plan || "Free", status: sub.status || "active", expiresAt: sub.expiresAt || null } : { plan: "free", planName: "Free", status: "active", expiresAt: null },
      };
    });
    res.json({ users: safeUsers, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Admin users error:", error);
    res.status(500).json({ error: "Could not load users." });
  }
});

// Permanently delete a customer's account and Nexsa Bills data. Requires typing the exact email.
router.delete("/users/:id", async (req, res) => {
  try {
    const confirmEmail = String(req.body?.confirmEmail || "").trim().toLowerCase();
    const users = await getUsersCollection();
    const target = await users.findOne({ id: req.params.id });
    if (!target) return res.status(404).json({ error: "User not found." });
    if (
      String(target.email || "").trim().toLowerCase() === ADMIN_EMAIL ||
      String(target.phone || "") === ADMIN_PHONE
    ) {
      return res.status(400).json({ error: "The primary admin account cannot be deleted from this panel." });
    }
    if (!confirmEmail || confirmEmail !== String(target.email || "").trim().toLowerCase()) {
      return res.status(400).json({ error: "Type the customer's exact email to confirm deletion." });
    }

    const db = await getDb();
    const userId = target.id;
    const ownedCollections = [
      "business", "documents", "payments", "customers", "expenses",
      "products", "stockMovements", "recurringInvoices", "subscriptions",
      "subscriptionPayments", "cashfreeOrders"
    ];
    const deletedCounts = {};
    for (const name of ownedCollections) {
      const result = await db.collection(name).deleteMany({ userId });
      deletedCounts[name] = result.deletedCount || 0;
    }
    await users.deleteOne({ id: userId });
    await db.collection("adminAuditLog").insertOne({
      actorEmail: String(req.user?.email || "").toLowerCase(),
      action: "user.delete",
      targetUserId: userId,
      targetEmail: target.email || "",
      deletedCounts,
      createdAt: new Date().toISOString(),
    });
    return res.json({ ok: true, deletedUser: target.email || "", deletedCounts });
  } catch (error) {
    console.error("Admin delete user error:", error);
    return res.status(500).json({ error: "Could not delete customer account and data." });
  }
});

router.patch("/users/:id/status", async (req, res) => {
  try {
    const status = req.body?.status;
    if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "Status must be active or suspended." });
    const users = await getUsersCollection();
    const target = await users.findOne({ id: req.params.id });
    if (!target) return res.status(404).json({ error: "User not found." });
    if ((String(target.email || "").toLowerCase() === ADMIN_EMAIL || String(target.phone || "") === ADMIN_PHONE)) return res.status(400).json({ error: "Cannot suspend the primary admin account." });
    await users.updateOne({ id: req.params.id }, { $set: { status, updatedAt: new Date().toISOString() } });
    const db = await getDb();
    await db.collection("adminAuditLog").insertOne({
      actorEmail: String(req.user?.email || "").toLowerCase(),
      action: status === "suspended" ? "user.suspend" : "user.restore",
      targetUserId: req.params.id, targetEmail: target.email || "",
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, status });
  } catch (error) {
    console.error("Admin status update error:", error);
    res.status(500).json({ error: "Could not update user status." });
  }
});

router.patch("/users/:id/subscription", async (req, res) => {
  try {
    const { plan, days = 30 } = req.body || {};
    const plans = { free: "Free", pro: "Pro", advanced: "Advanced" };
    if (!Object.hasOwn(plans, plan)) return res.status(400).json({ error: "Choose Free, Pro or Advanced." });
    const duration = Number(days);
    if (!Number.isInteger(duration) || duration < 1 || duration > 3650) return res.status(400).json({ error: "Duration must be 1–3650 days." });
    const users = await getUsersCollection();
    const target = await users.findOne({ id: req.params.id });
    if (!target) return res.status(404).json({ error: "User not found." });
    if (String(target.email || "").toLowerCase() === ADMIN_EMAIL) return res.status(400).json({ error: "Manage the primary admin access through server configuration." });
    const db = await getDb();
    const now = new Date();
    const expiresAt = plan === "free" ? null : new Date(now.getTime() + duration * 86400000).toISOString();
    const subscription = { userId: req.params.id, plan, planName: plans[plan], status: "active", expiresAt, updatedAt: now.toISOString(), updatedBy: String(req.user?.email || "").toLowerCase() };
    await db.collection("subscriptions").updateOne({ userId: req.params.id }, { $set: subscription }, { upsert: true });
    await db.collection("adminAuditLog").insertOne({
      actorEmail: String(req.user?.email || "").toLowerCase(),
      action: "subscription.set", targetUserId: req.params.id,
      targetEmail: target.email || "", plan, days: plan === "free" ? null : duration,
      createdAt: now.toISOString(),
    });
    res.json({ ok: true, subscription });
  } catch (error) {
    console.error("Admin subscription update error:", error);
    res.status(500).json({ error: "Could not update subscription." });
  }
});

// Admin-only pilot storage for custom invoice templates. Templates are scoped to the signed-in admin.
router.get("/custom-invoice-studio/templates", async (req, res) => {
  try {
    const db = await getDb();
    const record = await db.collection("customInvoiceStudioTemplates").findOne(
      { userId: req.userId },
      { projection: { _id: 0, userId: 0 } }
    );
    res.json({ templates: Array.isArray(record?.templates) ? record.templates : [] });
  } catch (error) {
    console.error("Custom invoice templates read error:", error);
    res.status(500).json({ error: "Could not load custom invoice templates." });
  }
});

router.put("/custom-invoice-studio/templates", async (req, res) => {
  try {
    const template = req.body?.template;
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      return res.status(400).json({ error: "A template object is required." });
    }
    const id = String(template.id || "").trim();
    const name = String(template.name || "").trim().slice(0, 80);
    if (!id || id.length > 100 || !name) {
      return res.status(400).json({ error: "Template ID and name are required." });
    }
    if (!Array.isArray(template.elements) || template.elements.length > 150) {
      return res.status(400).json({ error: "Template must contain no more than 150 layout elements." });
    }
    const safeTemplate = {
      id, name,
      enabledFields: Array.isArray(template.enabledFields) ? template.enabledFields.slice(0, 80).map((x) => String(x).slice(0, 80)) : [],
      elements: template.elements.map((element) => ({
        id: String(element?.id || "").slice(0, 100),
        label: String(element?.label || "").slice(0, 500),
        x: Math.max(0, Math.min(100, Number(element?.x) || 0)),
        y: Math.max(0, Math.min(100, Number(element?.y) || 0)),
        w: Math.max(1, Math.min(100, Number(element?.w) || 1)),
        h: Math.max(1, Math.min(100, Number(element?.h) || 1)),
        size: Math.max(7, Math.min(32, Number(element?.size) || 10)),
        bold: Boolean(element?.bold),
        referenceText: Boolean(element?.referenceText),
      })),
      accent: /^#[0-9a-f]{6}$/i.test(String(template.accent || "")) ? template.accent : "#202020",
      font: ["Arial", "Georgia", "Verdana", "Tahoma"].includes(template.font) ? template.font : "Arial",
      sourceFileName: String(template.sourceFileName || "").slice(0, 180),
      updatedAt: new Date().toISOString(),
    };
    const db = await getDb();
    const collection = db.collection("customInvoiceStudioTemplates");
    const record = await collection.findOne({ userId: req.userId });
    const templates = Array.isArray(record?.templates) ? record.templates : [];
    const index = templates.findIndex((item) => item.id === id);
    if (index >= 0) templates[index] = safeTemplate;
    else templates.push(safeTemplate);
    if (templates.length > 40) return res.status(400).json({ error: "Maximum 40 saved templates in this pilot." });
    await collection.updateOne(
      { userId: req.userId },
      { $set: { templates, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    res.json({ templates });
  } catch (error) {
    console.error("Custom invoice template save error:", error);
    res.status(500).json({ error: "Could not save custom invoice template." });
  }
});

router.delete("/custom-invoice-studio/templates/:id", async (req, res) => {
  try {
    const db = await getDb();
    const collection = db.collection("customInvoiceStudioTemplates");
    const record = await collection.findOne({ userId: req.userId });
    const templates = (Array.isArray(record?.templates) ? record.templates : [])
      .filter((template) => template.id !== req.params.id);
    await collection.updateOne(
      { userId: req.userId },
      { $set: { templates, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    res.json({ templates });
  } catch (error) {
    console.error("Custom invoice template delete error:", error);
    res.status(500).json({ error: "Could not delete custom invoice template." });
  }
});

router.get("/audit", async (req, res) => {
  try {
    const db = await getDb();
    const logs = await db.collection("adminAuditLog").find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).limit(100).toArray();
    res.json({ logs });
  } catch (error) {
    console.error("Admin audit error:", error);
    res.status(500).json({ error: "Could not load audit log." });
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default router;
