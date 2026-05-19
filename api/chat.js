// api/chat.js — Anthropic Claude proxy
// API key disimpan di environment variable Vercel, tidak exposed ke browser

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured in Vercel environment variables" });

  try {
    const { messages, system, context } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array required" });

    const systemPrompt = system || `Kamu adalah asisten trading crypto yang membantu trader memahami analisis teknikal.
Fokus pada MA13/21, VuManChu Cipher B, Support & Resistance, dan 3-layer decision system.
Jawab singkat, padat, dan praktis dalam Bahasa Indonesia.
${context ? `\nKonteks analisis terkini:\n${context}` : ""}`;

    const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Claude API error" });

    const text = data.content?.map(b => b.text || "").join("") || "";
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
