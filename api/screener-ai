export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  try {
    const { results, model = "deepseek" } = req.body;
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "results array required" });
    }

    // ── Bangun konteks untuk AI ───────────────────────────────────
    const readyCoins = results.filter(r => r.status === "READY");
    const watchCoins = results.filter(r => r.status === "WATCH");
    const longReady  = readyCoins.filter(r => r.signal === "LONG");
    const shortReady = readyCoins.filter(r => r.signal === "SHORT");

    // Format data untuk prompt
    const formatCoin = (r) =>
      `${r.coin} | ${r.signal} | Harga: $${r.currentPrice} | Target: $${r.targetLevel} | Jarak: ${r.distanceToTarget}% | ${r.details}`;

    const readySection = readyCoins.length > 0
      ? `COIN READY (${readyCoins.length} coin — sudah breakout/breakdown):\n${readyCoins.map(formatCoin).join("\n")}`
      : "COIN READY: Tidak ada coin yang sudah breakout/breakdown.";

    const watchSection = watchCoins.length > 0
      ? `COIN WATCH (${watchCoins.length} coin — mendekati level):\n${watchCoins.slice(0,15).map(formatCoin).join("\n")}`
      : "COIN WATCH: Tidak ada.";

    const prompt = `Kamu adalah analis trading crypto berpengalaman. Berikut adalah hasil scan ${results.length} coin dari screener breakout/breakdown:

${readySection}

${watchSection}

STATISTIK SCAN:
- Total coin dipindai: ${results.length}
- READY (breakout terkonfirmasi): ${readyCoins.length} (LONG: ${longReady.length}, SHORT: ${shortReady.length})
- WATCH (mendekati level): ${watchCoins.length}

Berikan analisis dalam format JSON berikut (HANYA JSON, tanpa teks lain):
{
  "marketOverview": "1-2 kalimat gambaran kondisi market secara keseluruhan dari hasil scan ini",
  "marketBias": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL",
  "top3": [
    {
      "coin": "nama coin",
      "signal": "LONG atau SHORT",
      "reason": "alasan singkat kenapa ini terbaik (max 2 kalimat)",
      "entry": "harga entry ideal",
      "riskNote": "catatan risiko jika ada"
    }
  ],
  "topPick": {
    "coin": "1 coin pilihan utama",
    "signal": "LONG atau SHORT",
    "fullAnalysis": "analisis mendalam 3-4 kalimat: kenapa ini pilihan terbaik, kondisi teknisnya, dan apa yang perlu diperhatikan",
    "entry": "harga entry",
    "confidence": angka 0-100
  },
  "warnings": ["peringatan 1 jika ada coin dengan sinyal palsu atau risiko tinggi", "peringatan 2 jika ada"],
  "watchlist": ["coin1", "coin2", "coin3"],
  "summary": "1 kalimat kesimpulan actionable untuk trader"
}`;

    // ── Panggil AI ────────────────────────────────────────────────
    let aiText = "";
    let modelUsed = "";

    if (model === "hermes" && process.env.OPENROUTER_API_KEY) {
      const hermesModels = [
        "nousresearch/hermes-3-llama-3.1-405b",
        "nousresearch/hermes-3-llama-3.1-70b",
        "meta-llama/llama-3.1-70b-instruct",
      ];
      for (const m of hermesModels) {
        try {
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "https://trading-fronted-six.vercel.app",
              "X-Title": "Trading AI Screener",
            },
            body: JSON.stringify({
              model: m, max_tokens: 1500, temperature: 0.4,
              messages: [{ role: "user", content: prompt }],
            }),
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) {
            aiText = d.choices[0].message.content;
            modelUsed = `Hermes — ${m.split("/")[1]}`;
            break;
          }
        } catch {}
      }
    }

    // Default: DeepSeek
    if (!aiText && process.env.DEEPSEEK_API_KEY) {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat", max_tokens: 1500, temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const d = await r.json();
      if (r.ok && d.choices?.[0]?.message?.content) {
        aiText = d.choices[0].message.content;
        modelUsed = "deepseek-chat";
      }
    }

    if (!aiText) {
      return res.status(500).json({ error: "Semua AI API gagal. Cek DEEPSEEK_API_KEY / OPENROUTER_API_KEY." });
    }

    // ── Parse JSON dari response AI ───────────────────────────────
    let analysis = null;
    try {
      const clean = aiText.replace(/```json|```/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) analysis = JSON.parse(match[0]);
    } catch (e) {
      // Jika parse gagal, return raw text
      return res.status(200).json({
        success: true,
        analysis: null,
        rawText: aiText,
        model: modelUsed,
        stats: { total: results.length, ready: readyCoins.length, watch: watchCoins.length, longReady: longReady.length, shortReady: shortReady.length },
      });
    }

    return res.status(200).json({
      success: true,
      analysis,
      model: modelUsed,
      stats: {
        total:       results.length,
        ready:       readyCoins.length,
        watch:       watchCoins.length,
        longReady:   longReady.length,
        shortReady:  shortReady.length,
      },
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
