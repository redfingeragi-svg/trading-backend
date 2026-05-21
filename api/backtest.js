// Contoh logika sederhana untuk Engine Backtesting
async function runBacktest(historicalData) {
  let balance = 1000; // Modal awal
  let results = [];

  for (let i = 1; i < historicalData.length; i++) {
    const candle = historicalData[i];
    
    // Logika Layer 1: Cek Trend
    const trendUp = candle.ma13 > candle.ma21 && candle.vmc_signal === 'LONG';
    
    // Logika simulasi entry
    if (trendUp) {
      // Simulasi eksekusi Layer 2 & 3
      const entryPrice = candle.close;
      const sl = entryPrice * 0.98; // SL 2%
      const tp = entryPrice * 1.06; // TP 1:3
      
      // Cek apakah di masa depan harga menyentuh TP atau SL
      const tradeResult = checkFuturePerformance(historicalData.slice(i), sl, tp);
      balance += tradeResult.profit;
      results.push(tradeResult);
    }
  }
  return { finalBalance: balance, stats: results };
}
