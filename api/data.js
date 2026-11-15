const { readSession, sameOrigin, sendJson } = require("../lib/session");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (req.method === "POST" && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Request origin was not accepted." });
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.ALLOWED_EMAILS ||
      !process.env.APPS_SCRIPT_URL || !process.env.STAYBOARD_API_KEY) {
    return sendJson(res, 503, { ok: false, error: "The shared-data service is not configured." });
  }
  try {
    if (!readSession(req)) {
      return sendJson(res, 401, { ok: false, error: "Your session expired. Sign in again." });
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
