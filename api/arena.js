/**
 * PALCORE Decision Partner v1.1 — Arena Endpoint
 * Calls Claude + GPT in parallel, returns both responses.
 * Rate limit: 5 requests per IP per hour (2x cost).
 */

const RATE_LIMIT = 5;
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

async function callClaude(messages, apiKey) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Claude API error:", res.status, err);
      return { text: null, model: "Claude Sonnet 4", error: "Erro Claude: " + res.status };
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n") || null;
    return { text, model: "Claude Sonnet 4" };
  } catch (err) {
    console.error("Claude call failed:", err);
    return { text: null, model: "Claude Sonnet 4", error: "Claude indisponivel" };
  }
}

async function callGPT(messages, apiKey) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1500,
        messages,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("GPT API error:", res.status, err);
      return { text: null, model: "GPT-4o", error: "Erro GPT: " + res.status };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || null;
    return { text, model: "GPT-4o" };
  } catch (err) {
    console.error("GPT call failed:", err);
    return { text: null, model: "GPT-4o", error: "GPT indisponivel" };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!anthropicKey || !openaiKey) {
    return res.status(500).json({ error: "Server configuration error — missing API keys" });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Limite Arena atingido (5/hora). Tenta novamente mais tarde." });
  }

  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array required" });
    }

    const truncated = messages.slice(-MAX_CONVERSATION_MESSAGES);
    const [claude, gpt] = await Promise.all([
      callClaude(truncated, anthropicKey),
      callGPT(truncated, openaiKey),
    ]);

    if (!claude.text && !gpt.text) {
      return res.status(502).json({ error: "Ambas as APIs falharam", claude, gpt });
    }

    return res.status(200).json({ claude, gpt });
  } catch (err) {
    console.error("Arena error:", err);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
}
