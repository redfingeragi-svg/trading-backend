async function runBacktest(historicalData) {
  let balance = 1000;
  let results = [];

  for (let i = 20; i < historicalData.length - 10; i++) { // Mulai dari i=20 untuk buffer MA
    const candle = historicalData[i];
    
    // 1. Layer 1: Filter Matematis (Kecepatan Tinggi)
    const trendUp = candle.ma13 > candle.ma21 && candle.vmc_signal === 'LONG';
    
    if (trendUp) {
      // 2. Layer 4: Hermes Agent sebagai Hakim (Filtering)
      // Kita panggil Hermes untuk memvalidasi setup ini berdasarkan konteks history
      const decision = await analyzeWithHermes(historicalData.slice(i-20, i)); 
      
      if (decision.keputusan === "LONG") {
        // 3. Layer 3: Gunakan TP/SL dari hasil analisis Hermes/S&R
        const entryPrice = candle.close;
        const sl = decision.eksekusi.sl; 
        const tp = decision.eksekusi.tp;
        
        const tradeResult = checkFuturePerformance(historicalData.slice(i), entryPrice, sl, tp);
        
        balance += tradeResult.profit;
        results.push({...tradeResult, confidence: decision.confidenceLevel});
      }
    }
  }
  return { finalBalance: balance, stats: results };
}
