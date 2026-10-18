import { getUsersCollection, getDb, getDocumentsCollection, getPaymentsCollection } from "../db.js";

export const TRIAL_DAYS = 14;
export const FREE_LIMITS = { invoices: 5, estimates: 3, payments: 5 };
const OWNER_EMAIL = "vedantb150@gmail.com";

export async function getAccessState(userId) {
  const users = await getUsersCollection();
  const user = await users.findOne({ id: userId });
  if (String(user?.email || "").toLowerCase() === OWNER_EMAIL) {
    return { mode: "owner", plan: "advanced", planName: "Owner Full Access", expiresAt: null, trialEndsAt: null, unlimited: true };
  }

  const now = new Date();
  let trialEndsAt = user?.trialEndsAt ? new Date(user.trialEndsAt) : null;
  if (!trialEndsAt) {
    trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await users.updateOne({ id: userId }, { $set: { trialEndsAt: trialEndsAt.toISOString() } });
  }

  const db = await getDb();
  const subscription = await db.collection("subscriptions").findOne({ userId });
  if (subscription?.plan && subscription.plan !== "free" && subscription?.status === "active") {
    const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      return { mode: "paid", plan: subscription.plan, planName: subscription.planName, expiresAt: expiresAt.toISOString(), trialEndsAt: trialEndsAt.toISOString(), unlimited: true };
    }
  }
  return {
    mode: trialEndsAt.getTime() > now.getTime() ? "trial" : "free",
    plan: "free",
    planName: "Free",
    trialEndsAt: trialEndsAt.toISOString(),
    expiresAt: subscription?.expiresAt || null,
    unlimited: false,
  };
}

async function checkLimit(req, res, next, kind) {
  try {
    const access = await getAccessState(req.userId);
    if (access.unlimited || access.mode === "trial") return next();
    const db = await getDb();
    let count;
    let limit;
    if (kind === "payments") {
      const col = await getPaymentsCollection();
      count = await col.countDocuments({ userId: req.userId });
      limit = FREE_LIMITS.payments;
    } else {
      const col = await getDocumentsCollection();
      count = await col.countDocuments({ userId: req.userId, type: kind === "invoices" ? "invoice" : "estimate" });
      limit = FREE_LIMITS[kind];
    }
    if (count >= limit) {
      return res.status(402).json({ error: `Free plan limit reached. ${limit} ${kind}. Upgrade to Pro or Advanced to continue.`, code: "SUBSCRIPTION_LIMIT", limit, used: count });
    }
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not check subscription limits" });
  }
}

export async function enforceDocumentLimit(req, res, next) {
  return checkLimit(req, res, next, req.body?.type === "estimate" ? "estimates" : "invoices");
}

export async function enforcePaymentLimit(req, res, next) {
  return checkLimit(req, res, next, "payments");
}
