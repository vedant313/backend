import jwt from "jsonwebtoken";
import { getUsersCollection } from "../db.js";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set. Add it in your hosting provider's environment variables (see README).");
  }
  return secret;
}

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, getSecret(), { expiresIn: "30d" });
}

// Protected routes re-check the current account status so suspended users lose access.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Not signed in." });
    const payload = jwt.verify(token, getSecret());
    const users = await getUsersCollection();
    const user = await users.findOne({ id: payload.id }, { projection: { passwordHash: 0, _id: 0 } });
    if (!user) return res.status(401).json({ error: "Account not found. Please sign in again." });
    if (user.status === "suspended") return res.status(403).json({ error: "This account is suspended. Contact Nexsa Bills support." });
    req.userId = user.id;
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  } catch (err) {
    if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    console.error("Authentication middleware error:", err);
    return res.status(500).json({ error: "Could not verify your session." });
  }
}
