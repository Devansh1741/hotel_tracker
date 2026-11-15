const crypto = require("node:crypto");

const COOKIE_NAME = "stayboard_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function sessionSigningKey() {
  const apiKey = process.env.STAYBOARD_API_KEY;
  if (!apiKey || apiKey.length < 32) {
    throw new Error("STAYBOARD_API_KEY must contain at least 32 characters.");
  }
  return crypto.createHmac("sha256", apiKey)
    .update("stayboard-session-cookie-v1")
    .digest();
}

function signSession(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSigningKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(req) {
  const cookie = (req.headers.cookie || "").split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;

  const [payload, signature] = cookie.slice(COOKIE_NAME.length + 1).split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", sessionSigningKey())
    .update(payload)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  let session;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
  const allowedEmailsSetting = (process.env.ALLOWED_EMAILS || "").trim();
  const allowedEmails = allowedEmailsSetting
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!session.email || !Number.isInteger(session.expiresAt) ||
      session.expiresAt <= Math.floor(Date.now() / 1000) ||
      (allowedEmailsSetting !== "*" && !allowedEmails.includes(session.email.toLowerCase()))) {
    return null;
  }
  return session;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.protocol === "https:" && parsedOrigin.host === host;
  } catch (error) {
    return false;
  }
}

function sendJson(res, status, value) {
  res.status(status)
    .setHeader("Cache-Control", "no-store")
    .json(value);
}

module.exports = {
  COOKIE_NAME,
  SESSION_SECONDS,
  readSession,
  sameOrigin,
  sendJson,
  signSession
};
