const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client();

function sendJson(res, status, value) {
  res.status(status).setHeader("Cache-Control", "no-store").json(value);
}

async function authorizeRequest(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: "Sign in with Google to continue.", status: 401 };

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: match[1],
      audience: process.env.GOOGLE_CLIENT_ID
    });
  } catch (error) {
    console.warn("Google sign-in token was rejected.", error);
    return { error: "Google sign-in expired or could not be verified. Sign in again.", status: 401 };
  }
  const payload = ticket.getPayload();
  const allowedEmails = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!payload?.email_verified || !allowedEmails.includes((payload.email || "").toLowerCase())) {
    return { error: "This Google account is not authorized to use Stayboard.", status: 403 };
  }
  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.ALLOWED_EMAILS ||
      !process.env.APPS_SCRIPT_URL || !process.env.STAYBOARD_API_KEY) {
    return sendJson(res, 503, { ok: false, error: "The shared-data service is not configured." });
  }

  try {
    const authorization = await authorizeRequest(req);
    if (authorization.error) {
      return sendJson(res, authorization.status, { ok: false, error: authorization.error });
    }

    const request = req.method === "GET"
      ? { action: "load" }
      : req.body;
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return sendJson(res, 400, { ok: false, error: "Request body must be a JSON object." });
    }

    const response = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...request, apiKey: process.env.STAYBOARD_API_KEY })
    });
    const result = await response.json();
    return sendJson(res, response.ok ? 200 : 502, result);
  } catch (error) {
    console.error("Stayboard shared-data request failed.", error);
    return sendJson(res, 502, { ok: false, error: "Could not reach the shared-data service." });
  }
};
