const fs = require('fs');
const assert = require('assert');

const cloudreve = fs.readFileSync('public/js/cloudreve.js', 'utf8');
const stockData = fs.readFileSync('python/engine/stock_data.py', 'utf8');

assert(
  cloudreve.includes('_d.sh_net_inflow != null') &&
  cloudreve.includes('_d.sh_connect && _d.sh_connect.net_inflow'),
  'north-flow renderer must support flat and legacy nested response fields'
);
assert(
  !cloudreve.includes('_d.sh_connect.net_inflow || 0'),
  'north-flow renderer must not dereference missing nested fields directly'
);
assert(
  cloudreve.includes('let _amount = Number(_d.amount) || 0;'),
  'realtime renderer must tolerate markets without amount/turnover fields'
);
assert(
  stockData.includes('"Referer": "https://stockapp.finance.qq.com/"') &&
  stockData.includes('headers=HEADERS_TX, timeout=12') &&
  stockData.includes('headers=HEADERS_TX, timeout=10'),
  'Tencent quote and kline fallbacks must use Tencent-compatible headers'
);
assert(
  stockData.includes('price_decimals = max(0, min(int(d.get("f59", 2) or 2), 6))') &&
  stockData.includes('f57,f58,f59,'),
  'Eastmoney realtime prices must request and honor the f59 decimal precision field'
);
assert(
  stockData.includes("re.search(r'v_[^=]+="),
  'Tencent realtime parser must accept numeric ETF quote variable names'
);
assert(
  stockData.includes('"50", "51", "52", "56", "58"') &&
  stockData.includes('"15", "16", "18"'),
  'Tencent symbol mapping must recognize Shanghai and Shenzhen ETF prefixes'
);
assert(
  stockData.includes('"change_pct": round(change_pct, 2)') &&
  stockData.includes('"amplitude": round(amplitude, 2)'),
  'Tencent kline fallback must normalize fields consumed by the frontend'
);
assert(
  stockData.includes('"data": recent'),
  'indicator response must expose the frontend-compatible data array'
);

console.log('stock tools regression tests passed');
