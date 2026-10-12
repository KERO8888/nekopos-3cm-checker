const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const elements = new Map();
const element = key => {
  if (!elements.has(key)) elements.set(key, {
    value: key === '#sortMode' ? 'profit' : key === '#category' || key === '#dimension' || key === '#forecast' || key === '#shippingFilter' ? 'all' : '',
    options: [], replaceChildren(...options) { this.options = options; },
    addEventListener() {}, setAttribute() {}, classList: { toggle() {} },
    textContent: '', innerHTML: '', dataset: {},
  });
  return elements.get(key);
};
const context = {
  window: { location: { search: '' } },
  document: { querySelector: key => key === '#featured .advanced[open]' ? null : element(key), querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() {} },
  Option: function Option(text, value) { this.text = text; this.value = value; },
  URLSearchParams,
  URL,
  console,
};
vm.createContext(context);
for (const file of ['data.js', 'predictions.js', 'shipping_fit.js', 'sourcing.js', 'market_data.js', 'finance.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const app = fs.readFileSync('app.js', 'utf8');
const ending = /  renderStats\(\);\s*syncProfitButtons\(\);\s*render\(\);\s*\}\)\(\);\s*$/;
assert(ending.test(app), 'app bootstrap changed; inspect test harness');
vm.runInContext(app.replace(ending, '  window.__profitTest = { profitStateFor, profitFor, purchaseCeilingFor, suppliersFor, supplierBadge, supplierDisplayName, supplierQuick, createCsv, renderStats, render, setProfitFilter(value) { profitFilter = value; } };\n})();'), context, { filename: 'app.js' });

const products = context.window.NEKOPOST_PRODUCTS;
const test = context.window.__profitTest;
for (const [url, key] of [
  ['https://item.rakuten.co.jp/shop/product/', 'rakuten'],
  ['https://store.shopping.yahoo.co.jp/shop/product.html', 'yahoo'],
  ['https://www.yodobashi.com/product/123/', 'yodobashi'],
  ['https://www.askul.co.jp/p/123/', 'askul'],
]) assert(test.supplierBadge({ url }).includes(`supplier-platform-${key}`), key);
assert.strictEqual(test.supplierDisplayName({ url: 'https://item.rakuten.co.jp/shop/item/', name: '楽天市場 / morro' }), 'morro');
assert.strictEqual(test.supplierDisplayName({ url: 'https://store.shopping.yahoo.co.jp/shop/item.html', name: '爽快ドラッグ（Yahoo!ショッピング）' }), '爽快ドラッグ');
const counts = products.reduce((out, product) => {
  const state = test.profitStateFor(product);
  out[state] = (out[state] || 0) + 1;
  return out;
}, {});
assert.strictEqual(Object.values(counts).reduce((a, b) => a + b, 0), products.length);
const candidates = products.filter(product => test.profitStateFor(product) === 'candidate');
const caramel = products.find(item => item.asin === 'B0GL6TYSJR');
const freeShippingProfit = test.profitFor(caramel, 'clickpost');
const singleOrderProfit = test.profitFor(caramel, 'clickpost', { buyShipping: 440 });
assert.strictEqual(test.suppliersFor(caramel.asin)[0].priceYen, 1080);
assert.strictEqual(freeShippingProfit.inbound, 0);
assert.strictEqual(freeShippingProfit.profit - singleOrderProfit.profit, 440);
assert.strictEqual(test.suppliersFor('B0DQDTBXJ7')[0].priceYen, 808);
const noFeaturedItem = products.find(item => item.asin === 'B093DGHBXC');
const originalFeatured = context.window.NEKOPOST_MARKET.offers.B093DGHBXC.featuredOffer;
context.window.NEKOPOST_MARKET.offers.B093DGHBXC.featuredOffer = null;
assert.strictEqual(test.profitStateFor(noFeaturedItem), test.profitFor(noFeaturedItem, 'clickpost').profit > 0 ? 'reference' : 'loss');
context.window.NEKOPOST_MARKET.offers.B093DGHBXC.featuredOffer = originalFeatured;
for (const item of candidates) {
  const profit = test.profitFor(item, 'clickpost');
  const supplier = context.window.NEKOPOST_SOURCING.suppliers[item.asin]?.[0]
    || context.window.NEKOPOST_MARKET.suppliers[item.asin]?.[0];
  if (supplier) assert.strictEqual(test.purchaseCeilingFor(item), profit.profit + profit.buy + profit.inbound);
}
for (const asin of ['B0GZDF7V69', 'B0H7HRMFMR']) {
  assert(test.supplierQuick(products.find(item => item.asin === asin)).includes('未確認'), asin);
  assert.strictEqual(test.profitStateFor(products.find(item => item.asin === asin)), 'sourcing', asin);
}

const csv = test.createCsv(candidates);
const caramelCsv = test.createCsv([caramel]);
assert(caramelCsv.includes('仕入先の単品注文時表示送料円'));
assert(caramelCsv.includes('"1080","440","0"'));
const lines = csv.split('\r\n');
assert.strictEqual(lines.length, candidates.length + 1);
function countCells(line) {
  let quoted = false;
  let cells = 1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (line[i] === ',' && !quoted) cells++;
  }
  return cells;
}
for (const line of lines.slice(1)) assert.strictEqual(countCells(lines[0]), countCells(line));
assert(lines[0].includes('利益区分'));
test.renderStats();
test.render();
assert.strictEqual(element('#profitCandidateCount').textContent, counts.candidate || 0);
assert.strictEqual(element('#profitReferenceCount').textContent, counts.reference || 0);
assert.strictEqual(element('#profitSourcingCount').textContent, counts.sourcing || 0);
assert.strictEqual(element('#profitPriceMissingCount').textContent, counts.price_missing || 0);
if (candidates.length) {
  assert(element('#featured').innerHTML.includes(candidates[0].asin));
  assert(element('#featured').innerHTML.includes('利益計算上の仕入額・1点'));
  assert(element('#featured').innerHTML.includes('仕入先の要約'));
  assert(element('#featured').innerHTML.includes('supplier-platform-'));
  assert(element('#featured').innerHTML.includes('この商品の楽天JAN検索'));
}
assert(element('#list').innerHTML.includes('candidate-source'));
assert(element('#list').innerHTML.includes('supplier-platform-'));
assert.strictEqual((element('#list').innerHTML.match(/data-select-asin=/g) || []).length, Math.min(candidates.length, 20));
test.setProfitFilter('sourcing');
test.render();
assert(element('#visibleCount').textContent.includes(`/ ${counts.sourcing || 0}件`));
assert(element('#featured').innerHTML.includes('仕入先の単品価格'));
assert(element('#featured').innerHTML.includes('仕入先の要約'));
assert(element('#featured').innerHTML.includes('未確認'));
test.setProfitFilter('price_missing');
test.render();
assert(element('#visibleCount').textContent.includes(`/ ${counts.price_missing || 0}件`));
console.log('profit explorer categories and CSV: ok');
