/**
 * PALCORE Decision Partner — Netlify Function Proxy
 * Proxies requests to Anthropic API with server-side auth.
 * Rate limit: 10 requests per IP per hour.
 */

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 12;

// In-memory rate limiter (resets on cold start — acceptable for v1.0)
const ipRequests = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const requests = ipRequests.get(ip) || [];
  const recent = requests.filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  ipRequests.set(ip, recent);
  return false;
}

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return Response.json({ error: "Limite de pedidos atingido. Tenta novamente mais tarde." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "Messages array required" }, { status: 400 });
    }

    // Truncate conversation to prevent context overflow
    const truncated = messages.slice(-MAX_CONVERSATION_MESSAGES);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: truncated,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", response.status, err);
      return Response.json(
        { error: "Erro na API: " + response.status },
        {
          status: response.status === 429 ? 429 : 502,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    const data = await response.json();
    return Response.json(data, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("Function error:", err);
    return Response.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
};

export const config = {
  path: "/api/decision",
};
