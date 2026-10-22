import { Router } from "express";
import { cert, initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
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

// Phone + password login for accounts that have a verified phone and password.
router.post("/firebase-phone/password-login", async (req, res) => {
  try {
    const raw = String(req.body?.phone || "").trim().replace(/[\\s()-]/g, "");
    const phone = /^\+91\d{10}$/.test(raw) ? raw : /^91\d{10}$/.test(raw) ? `+${raw}` : /^\d{10}$/.test(raw) ? `+91${raw}` : "";
    const password = String(req.body?.password || "");
    if (!phone || !password) return res.status(400).json({ error: "Enter a valid mobile number and password." });
    const col = await getUsersCollection();
    const user = await col.findOne({ phone });
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Incorrect phone number or password. If you forgot it, reset using phone OTP." });
    }
    return res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) {
    console.error("Phone password login failed:", err.name || "login_error");
    return res.status(500).json({ error: "Phone login is temporarily unavailable." });
  }
});

// Reset password only after Firebase has verified an OTP for this exact phone.
router.post("/firebase-phone/reset-password", async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "");
    const password = String(req.body?.password || "");
    if (!idToken || idToken.length > 10000) return res.status(400).json({ error: "Verify your phone with OTP first." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    const decoded = await firebaseAuth().verifyIdToken(idToken);
    const phone = String(decoded.phone_number || "");
    if (!/^\\+91\\d{10}$/.test(phone)) return res.status(401).json({ error: "Verified phone number is invalid." });
    const col = await getUsersCollection();
    const user = await col.findOne({ phone });
    if (!user) return res.status(404).json({ error: "No account is linked to this phone number. Sign up first." });
    const passwordHash = await bcrypt.hash(password, 10);
    await col.updateOne({ id: user.id }, { $set: { passwordHash, passwordUpdatedAt: new Date().toISOString() } });
    return res.json({ ok: true, message: "Password reset successfully. You can now log in with your phone or email and new password." });
  } catch (err) {
    if (err.code === "FIREBASE_ADMIN_CREDENTIALS_MISSING") return res.status(503).json({ error: "Phone verification backend is not configured." });
    if (String(err.code || "").startsWith("auth/")) return res.status(401).json({ error: "OTP verification expired. Please request a new OTP." });
    console.error("Phone password reset failed:", err.name || "reset_error");
    return res.status(500).json({ error: "Could not reset password right now." });
  }
});

router.post("/firebase-phone", async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "");
    if (!idToken || idToken.length > 10000) return res.status(400).json({ error: "Missing Firebase sign-in token." });

    const decoded = await firebaseAuth().verifyIdToken(idToken);
    const phone = String(decoded.phone_number || "");
    if (!/^\\+91\\d{10}$/.test(phone)) return res.status(401).json({ error: "Firebase token does not contain a verified Indian phone number." });

    const col = await getUsersCollection();
    let user = await col.findOne({ phone });
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const hasSignupDetails = Boolean(name && validEmail(email) && password.length >= 6);

    if (user) {
      // Existing phone-linked account signs in normally. A legacy phone-only account
      // can be completed with email/password without creating a second account.
      if (String(user.email || "").endsWith("@users.nexsa.invalid") && hasSignupDetails) {
        const emailOwner = await col.findOne({ email, id: { $ne: user.id } });
        if (emailOwner) return res.status(409).json({ error: "That email already belongs to another account. Sign in to that account and link this phone from Settings." });
        const passwordHash = await bcrypt.hash(password, 10);
        await col.updateOne({ id: user.id }, { $set: { name, email, passwordHash, authProvider: "phone-and-password", updatedAt: new Date().toISOString() } });
        user = { ...user, name, email, passwordHash, authProvider: "phone-and-password" };
      } else if (String(user.email || "").endsWith("@users.nexsa.invalid")) {
        return res.json({ requiresSignup: true, message: "Verify your phone, then set your name, email and password to finish account setup." });
      } else if (!user.phoneVerifiedAt) {
        user.phoneVerifiedAt = new Date().toISOString();
        await col.updateOne({ id: user.id }, { $set: { phoneVerifiedAt: user.phoneVerifiedAt } });
      }
    } else {
      if (!name || !email || !password) {
        return res.json({ requiresSignup: true, message: "Phone verified. Enter your name, email and password to complete sign-up." });
      }
      if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
      const emailOwner = await col.findOne({ email });
      if (emailOwner) return res.status(409).json({ error: "This email already has an account. Sign in with email and password, then link this phone from Settings. Your data has not been changed." });
      const passwordHash = await bcrypt.hash(password, 10);
      user = {
        id: uuid(), name, email, passwordHash, phone,
        authProvider: "phone-and-password",
        phoneVerifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await col.insertOne(user);
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
