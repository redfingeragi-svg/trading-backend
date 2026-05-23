// api/demo.js — Demo Trading Engine + Supabase persistent storage
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, DEEPSEEK_API_KEY / OPENROUTER_API_KEY

const CORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

// ── SUPABASE CLIENT (lightweight, no SDK needed) ──────────────────
function supabase(table) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const base = `${url}/rest/v1/${table}`;
  const headers = {
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Prefer": "return=representation",
  };

  return {
    async select(query = "*", filters = "") {
      const r = await fetch(`${base}?select=${query}${filters}`, { headers });
      return r.json();
    },
    async insert(data) {
      const r = await fetch(base, { method:"POST", headers, body: JSON.stringify(data) });
      return r.json();
    },
    async update(data, filter) {
      const r = await fetch(`${base}?${filter}`, {
        method: "PATCH", headers: {...headers, "Prefer":"return=representation"}, body: JSON.stringify(data)
      });
      return r.json();
    }
  };
}

// ── BINGX PRICE FETCHER (DIPERBAIKI) ────────────────────────────
async function getBingXPrice(symbol) {
  try {
    const pair = symbol.toUpperCase().replace(/USDT$/, "") + "-USDT";
    // KITA KEMBALI MENGGUNAKAN KLINES KARENA SUDAH TERBUKTI BEKERJA DI BINGX
    const r = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/klines?symbol=${pair}&interval=1m&limit=1`);
    const d = await r.json();
    
    if (d && d.data && d.data.length > 0) {
      // Struktur array atau object dari klines BingX
      let price;
      if (typeof d.data[0] === 'object' && !Array.isArray(d.data[0])) {
         price = parseFloat(d.data[0].close);
      } else {
         price = parseFloat(d.data[0][4]); // Index 4 biasanya adalah close price
      }
      
      if (!isNaN(price)) {
         console.log(`[BingX] Harga terbaru ${symbol}: ${price}`);
         return price; // SEKARANG HARGA AKAN DI-RETURN KE FRONTEND
      }
    }
  } catch(e) {
    console.error(`[BingX] Error Fetch getBingXPrice ${symbol}:`, e.message);
  }
  return 0; // Fallback jika terjadi error
}

export default async function handler(req, res) {
  CORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, symbol } = req.query;

  try {
    // 1. GET PRICE
    if (action === "price" && symbol) {
      const p = await getBingXPrice(symbol);
      return res.status(200).json({ price: p });
    }

    // 2. LIST POSITIONS
    if (action === "list") {
      const positions = await supabase("positions").select("*", "&order=created_at.desc");
      const insights = await supabase("ai_insights").select("*", "&order=created_at.desc&limit=1");
      
      const posArray = Array.isArray(positions) ? positions : [];
      let wins = 0, losses = 0, totalPnl = 0;
      posArray.forEach(p => {
        if (p.status === "closed") {
          if (parseFloat(p.pnlPct) > 0) wins++;
          else if (parseFloat(p.pnlPct) < 0) losses++;
          totalPnl += parseFloat(p.pnlUsd || 0);
        }
      });
      
      const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0;
      
      let patterns = [];
      try {
          if (insights && insights.length > 0 && insights[0].win_patterns) {
              patterns = JSON.parse(insights[0].win_patterns);
          }
      } catch (e) {}

      return res.status(200).json({
        success: true,
        positions: posArray,
        stats: { wins, losses, winRate, totalPnl: totalPnl.toFixed(2), open: posArray.filter(p=>p.status==="open").length },
        patterns: patterns
      });
    }

    if (req.method === "POST") {
      const body = req.body;
      const act = req.query.action || body.action;

      // 3. OPEN POSITION
      if (act === "open") {
        const result = await supabase("positions").insert({
          coin: body.coin,
          direction: body.direction,
          size: body.size,
          entryPrice: body.entryPrice,
          slPrice: body.slPrice,
          tpPrice: body.tpPrice,
          indicators: body.indicators,
          signalConfidence: body.signalConfidence,
          notes: body.notes,
          status: "open"
        });
        return res.status(200).json({ success: true, data: result });
      }

      // 4. CLOSE POSITION
      if (act === "close") {
        const { id, closePrice, closedBy } = body;
        
        const posData = await supabase("positions").select("*", `&id=eq.${id}`);
        if (!posData || posData.length === 0) return res.status(404).json({ error: "Position not found" });
        const pos = posData[0];
        
        const entry = parseFloat(pos.entryPrice);
        const cp = parseFloat(closePrice);
        const pnlPct = pos.direction === "LONG" ? ((cp - entry) / entry * 100) : ((entry - cp) / entry * 100);
        const pnlUsd = (pnlPct / 100) * parseFloat(pos.size);
        
        let resultStatus = "BE";
        if (pnlPct > 0.5) resultStatus = "WIN";
        if (pnlPct < -0.5) resultStatus = "LOSS";

        const updateRes = await supabase("positions").update({
          status: "closed",
          closePrice: cp,
          pnlPct: pnlPct.toFixed(2),
          pnlUsd: pnlUsd.toFixed(2),
          result: resultStatus,
          closedBy: closedBy || "MANUAL"
        }, `id=eq.${id}`);
        
        return res.status(200).json({ success: true, data: updateRes });
      }

      // 5. LEARN (AI INSIGHT)
      if (act === "learn") {
        const posData = await supabase("positions").select("*", `&status=eq.closed`);
        if (!posData || posData.length < 3) return res.status(400).json({ error: "Not enough closed positions for AI to learn" });
        
        const prompt = `Analisis data posisi trading: ${JSON.stringify(posData)}. Berikan JSON berisi { "winPatterns": [], "lossPatterns": [], "rules": [], "insight": "kesimpulan" }`;
        let aiText = "";
        
        try {
          if (process.env.DEEPSEEK_API_KEY) {
            const r = await fetch("https://api.deepseek.com/chat/completions", {
              method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` },
              body: JSON.stringify({ model: "deepseek-chat", max_tokens: 1000, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
            });
            const d = await r.json();
            aiText = d.choices?.[0]?.message?.content || "";
          } else if (process.env.OPENROUTER_API_KEY) {
            const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENROUTER_API_KEY}`,"HTTP-Referer":"https://trading-fronted-six.vercel.app"},
              body:JSON.stringify({model:"nousresearch/hermes-3-llama-3.1-70b",max_tokens:1000,temperature:0.2,messages:[{role:"user",content:prompt}]}),
            });
            const d = await r.json();
            aiText = d.choices?.[0]?.message?.content || "";
          }
        } catch(e) { aiText = ""; }

        let aiInsight = null;
        try {
          const m = aiText.replace(/```json|```/g,"").trim().match(/\{[\s\S]*\}/);
          if (m) aiInsight = JSON.parse(m[0]);
        } catch {}

        if (aiInsight) {
          await supabase("ai_insights").insert({
            win_patterns:  JSON.stringify(aiInsight.winPatterns || []),
            loss_patterns: JSON.stringify(aiInsight.lossPatterns || []),
            rules:         JSON.stringify(aiInsight.rules || []),
            insight:       aiInsight.insight || "",
            raw_text:      aiText
          });
          return res.status(200).json({ success: true, insight: aiInsight });
        } else {
          return res.status(500).json({ error: "Failed to parse AI response" });
        }
      }
    }
    
    return res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
