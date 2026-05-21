// api/chat.js — DeepSeek proxy
// API key disimpan di environment variable Vercel: DEEPSEEK_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "DEEPSEEK_API_KEY not configured" });

  try {
    const { messages, context } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });

    const systemPrompt = `Kamu adalah asisten trading crypto yang membantu trader memahami analisis teknikal.
Fokus pada MA13/21, VuManChu Cipher B, Support & Resistance, dan 3-layer decision system.
Jawab singkat, padat, dan praktis dalam Bahasa Indonesia.
${context ? `\nKonteks analisis terkini:\n${context}` : ""}`;

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-reasoner",
        max_tokens: 800,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "DeepSeek API error" });

    const text = data.choices?.[0]?.message?.content || "Tidak ada respons";
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
