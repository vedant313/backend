import { Router } from "express";
import { cert, initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { v4 as uuid } from "uuid";
import { getUsersCollection } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();
const projectId = process.env.FIREBASE_PROJECT_ID || "nexsa-bills";

function firebaseAuth() {
  const appName = "nexsa-bills-phone-auth";
  let app = getApps().find((item) => item.name === appName);
  if (!app) {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
      const error = new Error("FIREBASE_ADMIN_CREDENTIALS_MISSING");
      error.code = "FIREBASE_ADMIN_CREDENTIALS_MISSING";
      throw error;
    }
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, appName);
  }
  return getAuth(app);
}

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(value);

// Link a verified Firebase phone number to the currently authenticated existing account.
// This never creates a new account and never matches accounts by email alone.
router.post("/firebase-phone/link", requireAuth, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "");
    if (!idToken || idToken.length > 10000) return res.status(400).json({ error: "Missing Firebase sign-in token." });

    const decoded = await firebaseAuth().verifyIdToken(idToken);
    const phone = String(decoded.phone_number || "");
    if (!/^\+91\d{10}$/.test(phone)) return res.status(401).json({ error: "Firebase token does not contain a verified Indian phone number." });

    const col = await getUsersCollection();
    const existingPhone = await col.findOne({ phone, id: { $ne: req.user.id } });
    if (existingPhone) return res.status(409).json({ error: "This phone number is already linked to another account." });

    const result = await col.updateOne(
      { id: req.user.id },
      { $set: { phone, phoneVerifiedAt: new Date().toISOString() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Your account was not found. Please sign in again." });
    return res.json({ ok: true, phone });
  } catch (err) {
    if (err.code === "FIREBASE_ADMIN_CREDENTIALS_MISSING") return res.status(503).json({ error: "Phone sign-in backend is not configured yet." });
    if (String(err.code || "").startsWith("auth/")) return res.status(401).json({ error: "Phone verification could not be confirmed. Request a new OTP." });
    console.error("Firebase phone link failed:", err.name || "verification_error");
    return res.status(500).json({ error: "Could not link phone number right now." });
  }
});

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
    if (err.code === "FIREBASE_ADMIN_CREDENTIALS_MISSING") return res.status(503).json({ error: "Phone sign-in backend is not configured yet. Please use email login for now." });
    if (err.code === 11000) return res.status(409).json({ error: "This phone or email is already registered. Use the existing account." });
    if (String(err.code || "").startsWith("auth/")) return res.status(401).json({ error: "Firebase sign-in could not be verified. Please request a new OTP." });
    console.error("Firebase phone sign-in failed:", err.name || "verification_error");
    return res.status(500).json({ error: "Phone sign-in is temporarily unavailable." });
  }
});

export default router;
