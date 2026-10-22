import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { getUsersCollection } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Please enter your name." });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email." });
    if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const col = await getUsersCollection();
    const existing = await col.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: "An account with this email already exists. Please log in instead." });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: uuid(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await col.insertOne(user);

    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return res.status(409).json({ error: "An account with this email already exists. Please log in instead." });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, identifier, password } = req.body || {};
    const loginId = String(identifier || email || "").trim();
    if (!loginId || !password) return res.status(400).json({ error: "Enter your email or mobile number and password." });

    const col = await getUsersCollection();
    const normalizedPhone = loginId.replace(/[\\s()-]/g, "");
    const phone = /^\\+91\\d{10}$/.test(normalizedPhone) ? normalizedPhone : /^91\\d{10}$/.test(normalizedPhone) ? `+${normalizedPhone}` : /^\\d{10}$/.test(normalizedPhone) ? `+91${normalizedPhone}` : null;
    const user = phone ? await col.findOne({ phone }) : await col.findOne({ email: loginId.toLowerCase() });
    if (!user) return res.status(401).json({ error: "Incorrect email or password." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — returns the signed-in user for a stored token.
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } });
});

export default router;
