const { OAuth2Client } = require("google-auth-library");
const { readSession, sameOrigin, sendJson, signSession, SESSION_SECONDS, COOKIE_NAME } = require("../lib/session");

const googleClient = new OAuth2Client();

function isAllowedEmail(email) {
  const allowedEmailsSetting = (process.env.ALLOWED_EMAILS || "").trim();
  if (allowedEmailsSetting === "*") return true;
  return allowedEmailsSetting
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

module.exports = async function handler(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.ALLOWED_EMAILS ||
      !process.env.STAYBOARD_API_KEY) {
    return sendJson(res, 503, { ok: false, error: "Google sign-in is not configured." });
  }

  if (req.method === "GET") {
    const session = readSession(req);
    if (!session) return sendJson(res, 401, { ok: false, error: "Sign in to continue." });
    return sendJson(res, 200, { ok: true, email: session.email });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request origin was not accepted." });
  }
  if (!req.body || typeof req.body.credential !== "string") {
    return sendJson(res, 400, { ok: false, error: "Google sign-in credential is required." });
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: req.body.credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
  } catch (error) {
    console.warn("Google sign-in token was rejected.", error);
    return sendJson(res, 401, { ok: false, error: "Google sign-in could not be verified. Try again." });
  }

  const payload = ticket.getPayload();
  const email = (payload?.email || "").toLowerCase();
  if (!payload?.email_verified || !isAllowedEmail(email)) {
    return sendJson(res, 403, { ok: false, error: "This Google account is not authorized to use Stayboard." });
  }

  const sessionToken = signSession(email);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`
  );
  return sendJson(res, 200, { ok: true, email });
};
