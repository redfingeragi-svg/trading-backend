// api/chat.js — Multi-model: DeepSeek + Groq (Hermes/Llama)
// Env vars: DEEPSEEK_API_KEY, GROQ_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, context, model = "deepseek" } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });

    const systemPrompt = `Kamu adalah asisten trading crypto yang ahli dalam analisis teknikal.
Kamu membantu trader memahami sinyal dari sistem 3-layer trading:
- Layer 1: MA13/21 + VuManChu Cipher B → menentukan arah trend
- Layer 2: Entry 2.5% dari zona Support (LONG) atau Resistance (SHORT)
- Layer 3: Entry 1-2% di atas support / 1-2% di bawah resistance | SL 2% di luar S&R | TP = RR 1:3

Jawab singkat, padat, dan praktis dalam Bahasa Indonesia. Gunakan angka spesifik jika tersedia.
${context ? `\nKONTEKS ANALISIS:\n${context}` : ""}`;

    let text = "", modelUsed = "";

    if (model === "hermes") {
      // ── GROQ — coba semua model yang tersedia ─────────────────
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

      // List model Groq yang aktif (urutan prioritas)
      const groqModels = [
        "llama-3.3-70b-versatile",
        "llama-3.1-70b-versatile",
        "llama3-70b-8192",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
        "llama3-8b-8192",
      ];

      let lastError = "";
      let success = false;

      for (const m of groqModels) {
        try {
          const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: m,
              max_tokens: 700,
              temperature: 0.3,
              messages: [{ role: "system", content: systemPrompt }, ...messages],
            }),
          });
          const data = await resp.json();
          if (resp.ok && data.choices?.[0]?.message?.content) {
            text = data.choices[0].message.content;
            modelUsed = `Hermes via ${m}`;
            success = true;
            break;
          } else {
            lastError = data.error?.message || `Model ${m} failed`;
          }
        } catch (e) {
          lastError = e.message;
        }
      }

      if (!success) {
        return res.status(500).json({
          error: `Groq gagal: ${lastError}. Pastikan GROQ_API_KEY valid di console.groq.com`
        });
      }

    } else {
      // ── DEEPSEEK — coba model yang tersedia ───────────────────
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "DEEPSEEK_API_KEY not configured" });

      // List model DeepSeek (coba dari yang terbaru)
      const deepseekModels = [
        "deepseek-chat",       // DeepSeek V3 (stable, selalu tersedia)
        "deepseek-reasoner",   // DeepSeek R1
      ];

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
              max_tokens: 700,
              temperature: 0.3,
              messages: [{ role: "system", content: systemPrompt }, ...messages],
            }),
          });
          const data = await resp.json();
          if (resp.ok && data.choices?.[0]?.message?.content) {
            text = data.choices[0].message.content;
            modelUsed = m;
            success = true;
            break;
          } else {
            lastError = data.error?.message || `Model ${m} failed`;
          }
        } catch (e) {
          lastError = e.message;
        }
      }

      if (!success) {
        return res.status(500).json({
          error: `DeepSeek gagal: ${lastError}`
        });
      }
    }

    return res.status(200).json({ text, model: modelUsed });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
