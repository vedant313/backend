import { getUsersCollection, getDb } from "../db.js";

export const TRIAL_DAYS = 14;
// Free plan is temporarily unlimited while paid plans are disabled.
export const FREE_LIMITS = { invoices: null, estimates: null, payments: null };

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

// Paid plans are disabled for now, so authenticated users can create documents without a quota.
export async function enforceDocumentLimit(req, res, next) {
  return next();
}

export async function enforcePaymentLimit(req, res, next) {
  return next();
}
