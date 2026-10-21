import { Router } from "express";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { v4 as uuid } from "uuid";
import { getUsersCollection } from "../db.js";
import { signToken } from "../middleware/auth.js";

const router = Router();
const projectId = process.env.FIREBASE_PROJECT_ID || "nexa-bills";

function firebaseAuth() {
  const app = getApps().find((item) => item.name === "nexsa-bills-phone-auth")
    || initializeApp({ projectId }, "nexsa-bills-phone-auth");
  return getAuth(app);
}

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(value);

router.post("/firebase-phone", async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "");
    if (!idToken || idToken.length > 10000) return res.status(400).json({ error: "Missing Firebase sign-in token." });

    const decoded = await firebaseAuth().verifyIdToken(idToken);
    const phone = String(decoded.phone_number || "");
    if (!/^\+91\d{10}$/.test(phone)) return res.status(401).json({ error: "Firebase token does not contain a verified Indian phone number." });

    const col = await getUsersCollection();
    let user = await col.findOne({ phone });
    if (!user) {
      const name = String(req.body?.name || "").trim();
      const email = normalizeEmail(req.body?.email);
      if (!name) return res.status(400).json({ error: "For a new account, enter your name." });
      if (!validEmail(email)) return res.status(400).json({ error: "For a new account, enter a valid email address." });
      if (await col.findOne({ email })) return res.status(409).json({ error: "This email already has an account. Sign in with email and password; existing data has not been changed." });
      user = { id: uuid(), name, email, phone, authProvider: "firebase-phone", phoneVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() };
      await col.insertOne(user);
    } else if (!user.phoneVerifiedAt) {
      user.phoneVerifiedAt = new Date().toISOString();
      await col.updateOne({ _id: user._id }, { $set: { phoneVerifiedAt: user.phoneVerifiedAt } });
    }

    return res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "This phone or email is already registered. Use the existing account." });
    if (String(err.code || "").startsWith("auth/")) return res.status(401).json({ error: "Firebase sign-in could not be verified. Please request a new OTP." });
    console.error("Firebase phone sign-in failed:", err.name || "verification_error");
    return res.status(500).json({ error: "Phone sign-in is temporarily unavailable." });
  }
});

export default router;
