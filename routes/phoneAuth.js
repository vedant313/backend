import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getUsersCollection } from "../db.js";
import { signToken } from "../middleware/auth.js";

const router = Router();
const sendLimits = new Map();
const verifyLimits = new Map();
const HOUR = 60 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

function normalizePhone(value) {
  const digits = String(value || "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  const national = digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^\d{10}$/.test(national)) return null;
  return { stored: `+91${national}`, provider: `91${national}` };
}
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(value);

function limited(map, key, windowMs, max, cooldownMs = 0) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.startedAt >= windowMs) {
    map.set(key, { startedAt: now, count: 1, lastAt: now });
    return false;
  }
  if (cooldownMs && now - entry.lastAt < cooldownMs) return true;
  if (entry.count >= max) return true;
  entry.count += 1;
  entry.lastAt = now;
  return false;
}
function config() {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
  if (!authKey || !templateId) throw new Error("MSG91_CONFIG_MISSING");
  return { authKey, templateId };
}
async function providerJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || String(body.type || "").toLowerCase() === "error") {
    const err = new Error("MSG91_PROVIDER_ERROR");
    err.status = response.status;
    throw err;
  }
  return body;
}

router.post("/send", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number." });
    if (limited(sendLimits, phone.stored, HOUR, 5, 30_000)) {
      return res.status(429).json({ error: "Please wait 30 seconds before requesting another OTP. Limit: 5 requests per hour." });
    }
    const { authKey, templateId } = config();
    const url = new URL("https://control.msg91.com/api/v5/otp");
    url.searchParams.set("template_id", templateId);
    url.searchParams.set("mobile", phone.provider);
    url.searchParams.set("otp_length", "6");
    url.searchParams.set("otp_expiry", "5");
    const response = await fetch(url, {
      method: "POST",
      headers: { authkey: authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    await providerJson(response);
    res.json({ ok: true, message: "OTP sent if the number is eligible. It expires in 5 minutes." });
  } catch (err) {
    if (err.message === "MSG91_CONFIG_MISSING") {
      console.error("MSG91 configuration missing.");
      return res.status(503).json({ error: "Phone login is not configured yet. Please use email login." });
    }
    console.error("MSG91 send OTP failed:", err.status || err.name || "provider error");
    res.status(502).json({ error: "Could not send OTP right now. Please try again later." });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || "").trim();
    if (!phone) return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number." });
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the 6-digit OTP." });
    if (limited(verifyLimits, phone.stored, FIFTEEN_MINUTES, 10)) {
      return res.status(429).json({ error: "Too many verification attempts. Please try again in 15 minutes." });
    }

    const col = await getUsersCollection();
    const existing = await col.findOne({ phone: phone.stored });
    const email = normalizeEmail(req.body?.email);
    const name = String(req.body?.name || "").trim();

    // Do not silently attach a new phone to an existing email account.
    if (!existing) {
      if (!name) return res.status(400).json({ error: "For a new account, enter your name before verifying the OTP." });
      if (!validEmail(email)) return res.status(400).json({ error: "For a new account, enter a valid email address." });
      if (await col.findOne({ email })) {
        return res.status(409).json({ error: "This email already has an account. Sign in with your existing email and password; your data has not been changed." });
      }
    }

    const { authKey } = config();
    const url = new URL("https://control.msg91.com/api/v5/otp/verify");
    url.searchParams.set("mobile", phone.provider);
    url.searchParams.set("otp", otp);
    const response = await fetch(url, {
      method: "GET",
      headers: { authkey: authKey, accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const result = await providerJson(response);
    const message = String(result.message || "").toLowerCase();
    if (!(String(result.type || "").toLowerCase() === "success" || message.includes("verified") || message.includes("success"))) {
      return res.status(401).json({ error: "Invalid or expired OTP. Request a new code and try again." });
    }

    let user = existing;
    if (!user) {
      user = {
        id: uuid(), name, email, phone: phone.stored,
        phoneVerifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await col.insertOne(user);
    } else if (!user.phoneVerifiedAt) {
      user.phoneVerifiedAt = new Date().toISOString();
      await col.updateOne({ _id: user._id }, { $set: { phoneVerifiedAt: user.phoneVerifiedAt } });
    }

    verifyLimits.delete(phone.stored);
    sendLimits.delete(phone.stored);
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "This email or phone number is already registered. Please use your existing account." });
    if (err.message === "MSG91_CONFIG_MISSING") {
      console.error("MSG91 configuration missing.");
      return res.status(503).json({ error: "Phone login is not configured yet. Please use email login." });
    }
    console.error("MSG91 verify OTP failed:", err.status || err.name || "provider error");
    res.status(502).json({ error: "Could not verify OTP right now. Please try again." });
  }
});

export default router;
