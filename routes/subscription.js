import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { v4 as uuid } from "uuid";
import { getDb, getUsersCollection } from "../db.js";

const router = Router();
const UPI_ID = "nexsatechnologies@okaxis";
const PLANS = {
  free: { id: "free", name: "Free", price: 0, durationDays: null, features: ["5 invoices", "3 estimates", "5 payment entries"] },
  pro: { id: "pro", name: "Pro", price: 199, durationDays: 30, features: ["Unlimited invoices", "Unlimited estimates", "Unlimited payment entries"] },
  advanced: { id: "advanced", name: "Advanced", price: 399, durationDays: 30, features: ["Unlimited everything", "All document designs", "Priority support"] },
};
const OWNER_EMAIL = "vedantb150@gmail.com";

function getPlan(planId) { return PLANS[planId] || null; }
function cashfreeEnv() { return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox"; }
function cashfreeBaseUrl() { return cashfreeEnv() === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg"; }
function cashfreeConfigured() { return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY); }

async function cashfreeRequest(path, options = {}) {
  if (!cashfreeConfigured()) throw new Error("Cashfree is not configured. Add CASHFREE_APP_ID and CASHFREE_SECRET_KEY to the backend environment.");
  const response = await fetch(cashfreeBaseUrl() + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": process.env.CASHFREE_APP_ID,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY,
      "x-api-version": "2025-01-01",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.type || "Cashfree request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getCollections() {
  const db = await getDb();
  const subscriptions = db.collection("subscriptions");
  const requests = db.collection("subscriptionPayments");
  const cashfreeOrders = db.collection("cashfreeOrders");
  await subscriptions.createIndex({ userId: 1 }, { unique: true });
  await requests.createIndex({ utr: 1 }, { unique: true });
  await requests.createIndex({ userId: 1, createdAt: -1 });
  await cashfreeOrders.createIndex({ orderId: 1 }, { unique: true });
  await cashfreeOrders.createIndex({ userId: 1, createdAt: -1 });
  return { subscriptions, requests, cashfreeOrders };
}

function currentSubscription(doc) {
  if (!doc || !doc.plan || doc.plan === "free") {
    return { plan: "free", planName: "Free", status: doc?.status === "expired" ? "expired" : "active", expiresAt: doc?.expiresAt || null };
  }
  const expired = doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now();
  if (expired) return { plan: "free", planName: "Free", status: "expired", expiresAt: doc.expiresAt, expiredPlan: doc.planName || doc.plan };
  return { plan: doc.plan, planName: doc.planName || PLANS[doc.plan]?.name || doc.plan, status: "active", expiresAt: doc.expiresAt };
}

function adminAuthorized(req) {
  const key = process.env.SUBSCRIPTION_ADMIN_KEY;
  return Boolean(key && req.get("x-subscription-admin-key") === key);
}

async function activateCashfreeOrder(orderId, paymentAmount) {
  const { cashfreeOrders, subscriptions } = await getCollections();
  const order = await cashfreeOrders.findOne({ orderId });
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status === "paid") return { ok: true, alreadyProcessed: true };
  const plan = getPlan(order.plan);
  if (!plan || plan.id === "free" || Number(paymentAmount) !== Number(order.amount) || Number(order.amount) !== Number(plan.price)) {
    return { ok: false, reason: "payment_mismatch" };
  }
  const claim = await cashfreeOrders.updateOne(
    { orderId, status: "pending" },
    { $set: { status: "processing", updatedAt: new Date().toISOString() } }
  );
  if (!claim.matchedCount) {
    const latest = await cashfreeOrders.findOne({ orderId });
    return { ok: latest?.status === "paid", alreadyProcessed: latest?.status === "paid" };
  }
  try {
    const now = new Date();
    const current = await subscriptions.findOne({ userId: order.userId });
    const currentExpiry = current?.expiresAt ? new Date(current.expiresAt) : null;
    const start = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const expiresAt = new Date(start.getTime() + plan.durationDays * 86400000).toISOString();
    await subscriptions.updateOne(
      { userId: order.userId },
      { $set: { userId: order.userId, plan: plan.id, planName: plan.name, status: "active", expiresAt, updatedAt: now.toISOString() } },
      { upsert: true }
    );
    await cashfreeOrders.updateOne({ orderId }, { $set: { status: "paid", paidAt: now.toISOString(), updatedAt: now.toISOString() } });
    return { ok: true, subscription: currentSubscription({ plan: plan.id, planName: plan.name, expiresAt }) };
  } catch (err) {
    await cashfreeOrders.updateOne({ orderId, status: "processing" }, { $set: { status: "pending", updatedAt: new Date().toISOString() } }).catch(() => {});
    throw err;
  }
}

export async function handleCashfreeWebhook(req, res) {
  try {
    const signature = req.get("x-webhook-signature") || "";
    const timestamp = req.get("x-webhook-timestamp") || "";
    const rawBody = req.rawBody;
    if (!process.env.CASHFREE_SECRET_KEY || !signature || !timestamp || typeof rawBody !== "string") {
      return res.status(400).json({ error: "Missing webhook signature data" });
    }
    const expected = createHmac("sha256", process.env.CASHFREE_SECRET_KEY).update(timestamp + rawBody).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "Invalid webhook signature" });
    const event = JSON.parse(rawBody);
    const orderId = event?.data?.order?.order_id;
    const payment = event?.data?.payment;
    if (event?.type === "PAYMENT_SUCCESS_WEBHOOK" && orderId && payment?.payment_status === "SUCCESS") {
      const result = await activateCashfreeOrder(orderId, payment.payment_amount);
      if (!result.ok && result.reason !== "order_not_found") return res.status(400).json({ error: "Payment did not match the order" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Cashfree webhook error:", err.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

router.get("/plans", (req, res) => res.json({ upiId: UPI_ID, plans: Object.values(PLANS) }));

router.get("/status", async (req, res) => {
  try {
    const { subscriptions } = await getCollections();
    const doc = await subscriptions.findOne({ userId: req.userId });
    const { getAccessState, FREE_LIMITS } = await import("../middleware/subscription.js");
    const access = await getAccessState(req.userId);
    if (access.mode === "owner") {
      return res.json({ plan: "advanced", planName: "Owner Full Access", status: "active", mode: "owner", expiresAt: null, unlimited: true, freeLimits: FREE_LIMITS });
    }
    const current = currentSubscription(doc);
    const now = Date.now();
    const daysRemaining = current.expiresAt ? Math.ceil((new Date(current.expiresAt).getTime() - now) / 86400000) : null;
    const trialDaysRemaining = access.trialEndsAt ? Math.max(0, Math.ceil((new Date(access.trialEndsAt).getTime() - now) / 86400000)) : null;
    res.json({
      ...current,
      mode: access.mode,
      trialEndsAt: access.trialEndsAt,
      trialDaysRemaining,
      trialExpired: access.mode === "free" && Boolean(access.trialEndsAt) && new Date(access.trialEndsAt).getTime() <= now,
      daysRemaining,
      unlimited: access.mode === "paid" || access.mode === "trial",
      freeLimits: FREE_LIMITS,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load subscription status" });
  }
});

// Create an order only on the server. The amount and plan are never trusted from the browser.
router.post("/cashfree/create-order", async (req, res) => {
  try {
    if (!cashfreeConfigured()) return res.status(503).json({ error: "Cashfree checkout is not configured yet. Add the API keys to Render Environment." });
    const plan = getPlan(req.body?.plan);
    const phone = String(req.body?.phone || "").replace(/\D/g, "");
    if (!plan || plan.id === "free") return res.status(400).json({ error: "Choose a paid subscription plan." });
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: "Enter a valid 10-digit mobile number for the payment receipt." });
    const orderId = "nxb_" + uuid().replace(/-/g, "").slice(0, 24);
    const frontendUrl = (process.env.FRONTEND_URL || "https://billbook.nexsatechnologies.com").replace(/\/$/, "");
    const user = req.user || {};
    const customerDetails = {
      customer_id: String(req.userId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "nexsa_customer",
      customer_name: String(user.name || "Nexsa Bills Customer").slice(0, 100),
      customer_email: String(user.email || "").slice(0, 100),
      customer_phone: phone,
    };
    const created = await cashfreeRequest("/orders", {
      method: "POST",
      headers: { "x-idempotency-key": uuid() },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: plan.price,
        order_currency: "INR",
        customer_details: customerDetails,
        order_note: "Nexsa Bills " + plan.name + " subscription",
        order_meta: { return_url: frontendUrl + "/?cashfree=return&order_id={order_id}" },
      }),
    });
    const { cashfreeOrders } = await getCollections();
    await cashfreeOrders.insertOne({
      orderId,
      userId: req.userId,
      plan: plan.id,
      planName: plan.name,
      amount: plan.price,
      currency: "INR",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ orderId, paymentSessionId: created.payment_session_id, mode: cashfreeEnv() });
  } catch (err) {
    console.error("Cashfree create order error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Could not start checkout." });
  }
});

// Browser return is only a hint. The backend checks Cashfree's authenticated API before activation.
router.post("/cashfree/verify-order", async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "");
    const { cashfreeOrders } = await getCollections();
    const local = await cashfreeOrders.findOne({ orderId, userId: req.userId });
    if (!local) return res.status(404).json({ error: "Payment order not found for this account." });
    if (local.status === "paid") return res.json({ ok: true, status: "paid", plan: local.plan });
    const [order, payments] = await Promise.all([
      cashfreeRequest("/orders/" + encodeURIComponent(orderId)),
      cashfreeRequest("/orders/" + encodeURIComponent(orderId) + "/payments"),
    ]);
    const successful = Array.isArray(payments) ? payments.find(p => p.payment_status === "SUCCESS") : null;
    if (order.order_status === "PAID" && successful) {
      const result = await activateCashfreeOrder(orderId, successful.payment_amount);
      if (!result.ok) return res.status(400).json({ error: "Payment amount did not match the subscription plan." });
      return res.json({ ok: true, status: "paid", plan: local.plan });
    }
    return res.json({ ok: true, status: "pending" });
  } catch (err) {
    console.error("Cashfree verify order error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Could not verify payment yet." });
  }
});

router.post("/payment-request", async (req, res) => {
  try {
    const plan = getPlan(req.body?.plan);
    const utr = String(req.body?.utr || "").trim();
    if (!plan || plan.id === "free") return res.status(400).json({ error: "Choose a paid subscription plan" });
    if (!utr || utr.length < 6 || utr.length > 80) return res.status(400).json({ error: "Enter a valid UTR / transaction reference" });
    const { requests } = await getCollections();
    const existing = await requests.findOne({ utr });
    if (existing) return res.status(409).json({ error: existing.userId === req.userId ? "This UTR has already been submitted" : "This transaction reference has already been submitted" });
    const payment = { id: uuid(), userId: req.userId, plan: plan.id, planName: plan.name, amount: plan.price, upiId: UPI_ID, utr, status: "pending", createdAt: new Date().toISOString(), verifiedAt: null };
    await requests.insertOne(payment);
    const { _id, ...clean } = payment;
    res.status(201).json(clean);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not submit payment details" });
  }
});

router.get("/payment-requests", async (req, res) => {
  try {
    const { requests } = await getCollections();
    const rows = await requests.find({ userId: req.userId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load payment requests" });
  }
});

router.get("/admin/payment-requests", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(403).json({ error: "Not authorized" });
  try {
    const { requests } = await getCollections();
    const rows = await requests.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load payment requests" });
  }
});

router.post("/verify", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(403).json({ error: "Not authorized" });
  try {
    const { requests, subscriptions } = await getCollections();
    const payment = await requests.findOne({ id: req.body?.paymentId });
    if (!payment) return res.status(404).json({ error: "Payment request not found" });
    const action = req.body?.action;
    if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "Action must be approve or reject" });
    if (action === "reject") {
      await requests.updateOne({ id: payment.id }, { $set: { status: "rejected", verifiedAt: new Date().toISOString() } });
      return res.json({ ok: true, status: "rejected" });
    }
    const plan = getPlan(payment.plan);
    if (!plan || plan.id === "free") return res.status(400).json({ error: "The requested plan is no longer available" });
    const now = new Date();
    const current = await subscriptions.findOne({ userId: payment.userId });
    const currentExpiry = current?.expiresAt ? new Date(current.expiresAt) : null;
    const start = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const expiresAt = new Date(start.getTime() + plan.durationDays * 86400000).toISOString();
    await subscriptions.updateOne({ userId: payment.userId }, { $set: { userId: payment.userId, plan: plan.id, planName: plan.name, status: "active", expiresAt, updatedAt: now.toISOString() } }, { upsert: true });
    await requests.updateOne({ id: payment.id }, { $set: { status: "approved", verifiedAt: now.toISOString() } });
    res.json({ ok: true, status: "approved", subscription: currentSubscription({ plan: plan.id, planName: plan.name, expiresAt }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify payment" });
  }
});

export default router;
