/**
 * PALCORE Decision Partner — Vercel Serverless Function Proxy
 * Proxies requests to Anthropic API with server-side auth.
 * Rate limit: 10 requests per IP per hour.
 */

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 12;

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

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server configuration error" });

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Limite de pedidos atingido. Tenta novamente mais tarde." });
  }

  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array required" });
    }

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
      return res.status(response.status === 429 ? 429 : 502).json({ error: "Erro na API: " + response.status });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("Function error:", err);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
}
