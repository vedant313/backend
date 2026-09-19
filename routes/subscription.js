import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db.js";

const router = Router();

const UPI_ID = "shamkantgopal@ybl";
const PLANS = {
  free: { id: "free", name: "Free", price: 0, durationDays: null },
  pro: { id: "pro", name: "Pro", price: 199, durationDays: 30 },
  advanced: { id: "advanced", name: "Advanced", price: 399, durationDays: 30 },
};

function getPlan(planId) {
  return PLANS[planId] || null;
}

async function getCollections() {
  const db = await getDb();
  const subscriptions = db.collection("subscriptions");
  const requests = db.collection("subscriptionPayments");
  await subscriptions.createIndex({ userId: 1 }, { unique: true });
  await requests.createIndex({ utr: 1 }, { unique: true });
  await requests.createIndex({ userId: 1, createdAt: -1 });
  return { subscriptions, requests };
}

function currentSubscription(doc) {
  if (!doc || !doc.plan || doc.plan === "free") {
    return { plan: "free", planName: "Free", status: "active", expiresAt: null };
  }
  const expired = doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now();
  if (expired) return { plan: "free", planName: "Free", status: "expired", expiresAt: doc.expiresAt };
  return {
    plan: doc.plan,
    planName: doc.planName,
    status: "active",
    expiresAt: doc.expiresAt,
  };
}

function adminAuthorized(req) {
  const key = process.env.SUBSCRIPTION_ADMIN_KEY;
  return Boolean(key && req.get("x-subscription-admin-key") === key);
}

// Available plans and payment details.
router.get("/plans", (req, res) => {
  res.json({
    upiId: UPI_ID,
    plans: Object.values(PLANS),
  });
});

// Current user's subscription.
router.get("/status", async (req, res) => {
  try {
    const { subscriptions } = await getCollections();
    const doc = await subscriptions.findOne({ userId: req.userId });
    const { getAccessState, FREE_LIMITS } = await import("../middleware/subscription.js");
    const access = await getAccessState(req.userId);
    res.json({ ...currentSubscription(doc), mode: access.mode, trialEndsAt: access.trialEndsAt, freeLimits: FREE_LIMITS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load subscription status" });
  }
});

// User submits a UTR after making the UPI payment.
router.post("/payment-request", async (req, res) => {
  try {
    const plan = getPlan(req.body?.plan);
    const utr = String(req.body?.utr || "").trim();

    if (!plan || plan.id === "free") {
      return res.status(400).json({ error: "Choose a paid subscription plan" });
    }
    if (!utr || utr.length < 6 || utr.length > 80) {
      return res.status(400).json({ error: "Enter a valid UTR / transaction reference" });
    }

    const { requests } = await getCollections();
    const existing = await requests.findOne({ utr });
    if (existing) {
      if (existing.userId === req.userId) {
        return res.status(409).json({ error: "This UTR has already been submitted" });
      }
      return res.status(409).json({ error: "This transaction reference has already been submitted" });
    }

    const payment = {
      id: uuid(),
      userId: req.userId,
      plan: plan.id,
      planName: plan.name,
      amount: plan.price,
      upiId: UPI_ID,
      utr,
      status: "pending",
      createdAt: new Date().toISOString(),
      verifiedAt: null,
    };

    await requests.insertOne(payment);
    const { _id, ...clean } = payment;
    res.status(201).json(clean);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not submit payment details" });
  }
});

// User can see their own payment requests.
router.get("/payment-requests", async (req, res) => {
  try {
    const { requests } = await getCollections();
    const rows = await requests
      .find({ userId: req.userId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load payment requests" });
  }
});

// Admin-only queue of payment requests awaiting verification.
router.get("/admin/payment-requests", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(403).json({ error: "Not authorized" });
  try {
    const { requests } = await getCollections();
    const rows = await requests
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load payment requests" });
  }
});

// Admin verification endpoint. Never expose the admin key in frontend code.
router.post("/verify", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(403).json({ error: "Not authorized" });

  try {
    const { requests, subscriptions } = await getCollections();
    const payment = await requests.findOne({ id: req.body?.paymentId });
    if (!payment) return res.status(404).json({ error: "Payment request not found" });

    const action = req.body?.action;
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "Action must be approve or reject" });
    }

    if (action === "reject") {
      await requests.updateOne(
        { id: payment.id },
        { $set: { status: "rejected", verifiedAt: new Date().toISOString() } }
      );
      return res.json({ ok: true, status: "rejected" });
    }

    const plan = getPlan(payment.plan);
    const now = new Date();
    const current = await subscriptions.findOne({ userId: payment.userId });
    const currentExpiry = current?.expiresAt ? new Date(current.expiresAt) : null;
    const start = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const expiresAt = new Date(start.getTime() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();

    await subscriptions.updateOne(
      { userId: payment.userId },
      {
        $set: {
          userId: payment.userId,
          plan: plan.id,
          planName: plan.name,
          status: "active",
          expiresAt,
          updatedAt: now.toISOString(),
        },
      },
      { upsert: true }
    );

    await requests.updateOne(
      { id: payment.id },
      { $set: { status: "approved", verifiedAt: now.toISOString() } }
    );

    res.json({ ok: true, status: "approved", subscription: currentSubscription({ plan: plan.id, planName: plan.name, expiresAt }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify payment" });
  }
});

export default router;
