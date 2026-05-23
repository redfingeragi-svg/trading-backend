export default async function handler(req, res) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── 1. LOGIKA SCAN (GET) ──────────────────────────────────
  if (req.method === "GET") {
    const { coin } = req.query;
    if (!coin) return res.status(400).json({ success: false, error: "Parameter 'coin' wajib diisi" });

    try {
      const pair = coin + "-USDT";
      const [res4h, res1h] = await Promise.all([
        fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=4h&limit=100`).then(r => r.json()),
        fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=1h&limit=100`).then(r => r.json())
      ]);

      if (!res4h?.data || !res1h?.data) return res.status(200).json({ success: true, data: null });

      const parseCandles = (data) => data.map(c => ({
        time: Number(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), 
        low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
      })).sort((a, b) => a.time - b.time);

      const c4 = parseCandles(res4h.data);
      const c1 = parseCandles(res1h.data);
      if (c4.length < 60 || c1.length < 72) return res.status(200).json({ success: true, data: null });

      // ... (Logika EMA, VMC, S&R Anda tetap di sini) ...
      // Tambahkan logic indikator yang sama seperti file lama Anda
      
      // PASTIKAN MENGIRIM DATA VMC AGAR FRONTEND TIDAK CRASH
      return res.status(200).json({
        success: true,
        data: {
          coin,
          currentPrice: c4[c4.length - 1].close.toFixed(4),
          status: "READY", // Sesuaikan dengan logika deteksi Anda
          signal: "LONG",
          vmc: { bullish: true, moneyFlow: 0.5, dot: "GREEN" }, // Sesuaikan dengan hasil kalkulasi
          trendBullish: true
        }
      });
    } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
  }

  // ── 2. LOGIKA AI ANALYZER (POST) ──────────────────────────
  if (req.method === "POST") {
    try {
      const { results, model } = req.body;
      if (!results) return res.status(400).json({ error: "No results" });

      // Tambahkan logika pemanggilan AI (DeepSeek/OpenRouter) Anda di sini
      // ... (Gunakan kode dari file screener-ai.js Anda) ...
      
      return res.status(200).json({ success: true, analysis: "Data analisis AI Anda" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
