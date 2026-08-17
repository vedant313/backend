import jwt from "jsonwebtoken";

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

// Protects a route: requires a valid "Authorization: Bearer <token>" header.
// On success, sets req.userId and req.user.
export function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Not signed in." });
    const payload = jwt.verify(token, getSecret());
    req.userId = payload.id;
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}
