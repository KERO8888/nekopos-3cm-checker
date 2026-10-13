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
for (const file of ['data.js', 'predictions.js', 'shipping_fit.js', 'demo_measurements.js', 'trial_products.js', 'sourcing.js', 'market_data.js', 'finance.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const app = fs.readFileSync('app.js', 'utf8');
const ending = /  renderStats\(\);\s*syncProfitButtons\(\);\s*syncDemoButton\(\);\s*syncMeasuredButton\(\);\s*syncTrialButton\(\);\s*render\(\);\s*\}\)\(\);\s*$/;
assert(ending.test(app), 'app bootstrap changed; inspect test harness');
vm.runInContext(app.replace(ending, '  window.__profitTest = { profitStateFor, profitFor, purchaseCeilingFor, suppliersFor, supplierBadge, supplierDisplayName, supplierQuick, createCsv, renderStats, render, recordFor, demoWithin3Cm, shippingLabelFor, setRecord(asin, record) { records[asin] = record; }, setSelectedAsin(asin) { selectedAsin = asin; }, setProfitFilter(value) { profitFilter = value; }, setDemoOnly(value) { demoOnly = value; profitFilter = value ? "all" : "candidate"; selectedAsin = demoMeasurements[0]?.asin || ""; }, setTrialOnly(value) { trialOnly = value; demoOnly = false; profitFilter = value ? "all" : "candidate"; selectedAsin = trialProducts[0]?.asin || ""; } };\n})();'), context, { filename: 'app.js' });

const products = context.window.NEKOPOST_PRODUCTS;
const test = context.window.__profitTest;
const demos = context.window.NEKOPOST_DEMO_MEASUREMENTS;
const trials = context.window.NEKOPOST_TRIAL_PRODUCTS;
assert.strictEqual(trials.length, 10);
assert.strictEqual(new Set(trials.map(trial => trial.asin)).size, 10);
assert(trials.every(trial => products.some(item => item.asin === trial.asin)));
assert.strictEqual(trials.reduce((sum, trial) => sum + trial.referencePriceYen, 0), 4965);
assert(trials.every(trial => Object.keys(test.recordFor(trial.asin)).length === 0), 'trial prices must not populate measurements');
assert.strictEqual(demos.length, 10);
assert.strictEqual(new Set(demos.map(demo => demo.asin)).size, 10);
assert(demos.every(demo => products.some(item => item.asin === demo.asin)));
assert.strictEqual(demos.filter(test.demoWithin3Cm).length, 7);
assert.strictEqual(demos.filter(demo => !test.demoWithin3Cm(demo)).length, 3);
assert.strictEqual(Object.keys(test.recordFor(demos[0].asin)).length, 0, 'sample dimensions must not populate real measurements');
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
const lavons = products.find(item => item.asin === 'B015CJ81X6');
assert.strictEqual(test.profitStateFor(lavons), 'price_risk');
test.setProfitFilter('all');
test.setSelectedAsin(lavons.asin);
test.render();
assert(element('#featured').innerHTML.includes('参考試算 · 安い競合出品より高く、販売成立は未確認'));
assert(element('#featured').innerHTML.includes('安い競合出品¥552'));
assert(element('#featured').innerHTML.includes('参考 +¥154'));
assert(!candidates.includes(lavons));
const chili = products.find(item => item.asin === 'B0FXLKX85S');
assert.strictEqual(test.profitStateFor(chili), 'price_risk', 'cheaper FBA offer must rule out a sellable MFN black candidate');
test.setSelectedAsin(chili.asin);
test.render();
assert(element('#featured').innerHTML.includes('安い競合出品¥897（FBA）'));
const ruby = products.find(item => item.asin === 'B0HCN2F8JQ');
assert.strictEqual(test.profitStateFor(ruby), 'price_risk', 'a cheaper FBA offer makes the MFN ceiling misleading even before supplier verification');
test.setSelectedAsin(ruby.asin);
test.render();
assert(element('#featured').innerHTML.includes('安い競合出品¥345（FBA）'));
assert(element('#featured').innerHTML.includes('販売成立未確認'));
assert(!element('#featured').innerHTML.includes('仕入上限'));
assert(!element('#featured').innerHTML.includes('収支ゼロ上限'));

test.setProfitFilter('candidate');
test.setSelectedAsin(candidates[0]?.asin || '');
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
  const item = products.find(product => product.asin === asin);
  assert(test.supplierQuick(item).includes('未確認'), asin);
  assert(['sourcing', 'price_risk'].includes(test.profitStateFor(item)), asin);
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
assert.strictEqual(element('#trialProgress').textContent, '厚さ 0/10件入力');
assert.strictEqual(element('#trialShippingStatus').textContent, '外装4項目 0/10件入力済み');
assert.strictEqual(element('#demoTotalCount').textContent, '10件の表示例');
assert.strictEqual(element('#demoWithinCount').textContent, 7);
assert.strictEqual(element('#demoOverCount').textContent, 3);
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
test.setTrialOnly(true);
test.render();
assert(element('#visibleCount').textContent.includes('/ 10件（実測待ちリスト）'));
assert.strictEqual((element('#list').innerHTML.match(/data-select-asin=/g) || []).length, 10);
assert.deepStrictEqual([...element('#list').innerHTML.matchAll(/data-select-asin="([A-Z0-9]+)"/g)].map(match => match[1]), Array.from(trials, trial => trial.asin));
assert(element('#featured').innerHTML.includes('実測待ちリスト 1 / 10'));
assert(element('#featured').innerHTML.includes('画像の参考価格 ¥402'));
assert(element('#featured').innerHTML.includes('placeholder="未測定"'));
assert.strictEqual(element('#demoSidebar').hidden, true);
test.setSelectedAsin('B0DWD4994X');
test.render();
assert(!element('#featured').innerHTML.includes('仮入力した梱包後サイズ'), 'fictional sample must be hidden in the measurement list');
test.setSelectedAsin(trials[0].asin);
test.setRecord(trials[0].asin, { pouchWidth: '11.1', thickness: '1.9' });
test.renderStats();
test.render();
assert.strictEqual(element('#trialProgress').textContent, '厚さ 1/10件入力');
assert.strictEqual(element('#trialThicknessStatus').textContent, '厚さ3cm以下 1件・超 0件');
assert.strictEqual(element('#trialShippingStatus').textContent, '外装4項目 0/10件入力済み');
assert.strictEqual(element('#trialPredictionStatus').textContent, '実測が予測上限より厚い 0/1件');
assert(element('#featured').innerHTML.includes('2/6項目入力'));
assert(element('#featured').innerHTML.includes('value="11.1"'));
assert(element('#featured').innerHTML.includes('value="1.9"'));
assert(element('#list').innerHTML.includes('最大厚 1.9cm · 3cm以下'));
test.setRecord('B001K7HWBM', { thickness: '4.2' });
test.renderStats();
test.render();
assert.strictEqual(element('#trialThicknessStatus').textContent, '厚さ3cm以下 1件・超 1件');
assert.strictEqual(element('#trialPredictionStatus').textContent, '実測が予測上限より厚い 1/2件');
assert(element('#list').innerHTML.includes('最大厚 4.2cm · 3cm超'));
test.setTrialOnly(false);
test.render();
test.setDemoOnly(true);
test.render();
assert(element('#visibleCount').textContent.includes('/ 10件'));
assert(element('#featured').innerHTML.includes('購入・実測の事実ではなく'));
assert.strictEqual((element('#list').innerHTML.match(/data-select-asin=/g) || []).length, 10);
assert.strictEqual((element('#list').innerHTML.match(/demo-row-badge within/g) || []).length, 7);
assert.strictEqual((element('#list').innerHTML.match(/demo-row-badge over/g) || []).length, 3);
test.setRecord(demos[0].asin, { pouchWidth: '11.1', pouchHeight: '23', thickness: '1.9' });
test.renderStats();
test.render();
assert.strictEqual(element('#actualCount').textContent, '3件');
assert(element('#featured').innerHTML.includes('一部実測'));
assert(element('#featured').innerHTML.includes('長辺：想定'));
assert(element('#featured').innerHTML.includes('最大厚：実測'));
assert(element('#featured').innerHTML.includes('未測定：外装の長辺・外装の短辺・重量'));
assert(element('#list').innerHTML.includes('実測入力 3/6項目'));
assert(element('#list').innerHTML.includes('一部実測・要確認'));
assert(!element('#featured').innerHTML.includes('購入・実測の事実ではなく'), 'real input must hide fictional sample panel');
assert.strictEqual(test.shippingLabelFor({ status: 'possible', fullyMeasured: false }, test.recordFor(demos[0].asin)), '一部実測・要確認');
test.setDemoOnly(false);
test.render();
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
