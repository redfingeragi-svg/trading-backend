// api/chat.js — Multi-model: DeepSeek V3 + Nous Hermes 3 via OpenRouter
// Env vars: DEEPSEEK_API_KEY, OPENROUTER_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, context, model = "deepseek" } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });

    // ── SYSTEM PROMPTS ────────────────────────────────────────────

    // DeepSeek: asisten teknikal berbasis rules 3-layer
    const deepseekSystem = `Kamu adalah asisten trading crypto yang ahli dalam analisis teknikal.
Kamu membantu trader memahami sinyal dari sistem indikator MA13/21, VuManChu Cipher B, dan Support/Resistance.
Jawab singkat, padat, dan praktis dalam Bahasa Indonesia. Gunakan angka spesifik dari konteks jika tersedia.
${context ? `\nKONTEKS ANALISIS TERKINI:\n${context}` : ""}`;

    // Hermes: trader berpengalaman dengan logic natural — TIDAK ada constraint rules kaku
    const hermesSystem = `You are Hermes, an experienced crypto futures trader with deep intuition and market wisdom.
You analyze markets naturally — using price action, momentum, market structure, and trader psychology.
You are NOT bound by any fixed rules or mechanical systems. You think freely and holistically.

When responding:
- Answer in Bahasa Indonesia
- Share your genuine trader perspective — what the market is telling you
- Consider sentiment, momentum, key levels, and context holistically
- Be direct: give specific price levels, timing, and actionable advice
- If something looks risky, say so bluntly
- Draw from experience, not rigid formulas
${context ? `\nMarket context provided by the trader:\n${context}` : ""}`;

    let text = "", modelUsed = "";

    if (model === "hermes") {
      // ── NOUS HERMES 3 via OpenRouter ──────────────────────────
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) return res.status(500).json({
        error: "OPENROUTER_API_KEY not configured. Daftar gratis di openrouter.ai"
      });

      // Model Hermes di OpenRouter (urutan prioritas)
      const hermesModels = [
        "nousresearch/hermes-3-llama-3.1-405b",       // Hermes 3 terbesar
        "nousresearch/hermes-3-llama-3.1-70b",         // Hermes 3 70B
        "nousresearch/nous-hermes-2-mixtral-8x7b",     // Hermes 2 fallback
        "meta-llama/llama-3.1-70b-instruct",           // Llama fallback
      ];

      let lastError = "";
      let success = false;

      for (const m of hermesModels) {
        try {
          const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              "HTTP-Referer": "https://trading-fronted-six.vercel.app",
              "X-Title": "Trading AI Agent",
            },
            body: JSON.stringify({
              model: m,
              max_tokens: 800,
              temperature: 0.7,  // Lebih tinggi untuk Hermes agar lebih natural
              messages: [
                { role: "system", content: hermesSystem },
                ...messages,
              ],
            }),
          });

          const data = await resp.json();

          if (resp.ok && data.choices?.[0]?.message?.content) {
            text = data.choices[0].message.content;
            modelUsed = `Hermes — ${m.split("/")[1]}`;
            success = true;
            break;
          } else {
            lastError = data.error?.message || `${m} unavailable`;
          }
        } catch (e) {
          lastError = e.message;
        }
      }

      if (!success) {
        return res.status(500).json({
          error: `OpenRouter gagal: ${lastError}. Pastikan OPENROUTER_API_KEY valid di openrouter.ai`
        });
      }

    } else {
      // ── DEEPSEEK — technical assistant ───────────────────────
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "DEEPSEEK_API_KEY not configured" });

      const deepseekModels = ["deepseek-chat", "deepseek-reasoner"];
      let lastError = "";
      let success = false;

      for (const m of deepseekModels) {
        try {
          const resp = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: m,
              max_tokens: 800,
              temperature: 0.3,
              messages: [
                { role: "system", content: deepseekSystem },
                ...messages,
              ],
            }),
          });

          const data = await resp.json();

          if (resp.ok && data.choices?.[0]?.message?.content) {
            text = data.choices[0].message.content;
            modelUsed = m;
            success = true;
            break;
          } else {
            lastError = data.error?.message || `${m} failed`;
          }
        } catch (e) {
          lastError = e.message;
        }
      }

      if (!success) {
        return res.status(500).json({ error: `DeepSeek gagal: ${lastError}` });
      }
    }

    return res.status(200).json({ text, model: modelUsed });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
