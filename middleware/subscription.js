import { getDocumentsCollection, getPaymentsCollection, getUsersCollection, getDb } from "../db.js";

export const TRIAL_DAYS = 14;
export const FREE_LIMITS = { invoices: 5, estimates: 3, payments: 5 };

export async function getAccessState(userId) {
  const users = await getUsersCollection();
  const user = await users.findOne({ id: userId });
  const now = new Date();
  let trialEndsAt = user?.trialEndsAt ? new Date(user.trialEndsAt) : null;
  if (!trialEndsAt) {
    trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await users.updateOne({ id: userId }, { $set: { trialEndsAt: trialEndsAt.toISOString() } });
  }
  const db = await getDb();
  const subscriptions = db.collection("subscriptions");
  const subscription = await subscriptions.findOne({ userId });
  if (subscription?.plan && subscription.plan !== "free" && subscription?.status === "active") {
    const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() > now.getTime()) return { mode: "paid", plan: subscription.plan, trialEndsAt: trialEndsAt.toISOString(), expiresAt: expiresAt.toISOString() };
  }
  return { mode: trialEndsAt.getTime() > now.getTime() ? "trial" : "free", plan: "free", trialEndsAt: trialEndsAt.toISOString(), expiresAt: null };
}

export async function enforceDocumentLimit(req, res, next) {
  try {
    const access = await getAccessState(req.userId);
    if (access.mode === "trial" || access.mode === "paid") return next();
    const type = req.body?.type === "estimate" ? "estimate" : "invoice";
    const key = type === "estimate" ? "estimates" : "invoices";
    const limit = FREE_LIMITS[key];
    const col = await getDocumentsCollection();
    const count = await col.countDocuments({ userId: req.userId, type });
    if (count >= limit) return res.status(402).json({ error: "Free plan limit reached: " + limit + " " + key + ". Upgrade to Pro or Advanced to continue.", code: "FREE_LIMIT_REACHED", limit, type });
    next();
  } catch (err) { console.error(err); res.status(500).json({ error: "Could not check subscription limits" }); }
}

export async function enforcePaymentLimit(req, res, next) {
  try {
    const access = await getAccessState(req.userId);
    if (access.mode === "trial" || access.mode === "paid") return next();
    const col = await getPaymentsCollection();
    const count = await col.countDocuments({ userId: req.userId });
    if (count >= FREE_LIMITS.payments) return res.status(402).json({ error: "Free plan limit reached: " + FREE_LIMITS.payments + " payment entries. Upgrade to Pro or Advanced to continue.", code: "FREE_LIMIT_REACHED", limit: FREE_LIMITS.payments, type: "payments" });
    next();
  } catch (err) { console.error(err); res.status(500).json({ error: "Could not check subscription limits" }); }
}