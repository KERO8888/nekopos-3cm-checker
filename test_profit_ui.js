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
vm.runInContext(app.replace(ending, '  window.__profitTest = { profitStateFor, profitFor, purchaseCeilingFor, supplierQuick, createCsv, renderStats, render, setProfitFilter(value) { profitFilter = value; } };\n})();'), context, { filename: 'app.js' });

const products = context.window.NEKOPOST_PRODUCTS;
const test = context.window.__profitTest;
const counts = products.reduce((out, product) => {
  const state = test.profitStateFor(product);
  out[state] = (out[state] || 0) + 1;
  return out;
}, {});
assert.strictEqual(Object.values(counts).reduce((a, b) => a + b, 0), products.length);
const candidates = products.filter(product => test.profitStateFor(product) === 'candidate');
assert(candidates.some(item => item.asin === 'B093DGHBXC'));
assert(candidates.some(item => item.asin === 'B0DQDTBXJ7'));
assert.strictEqual(test.purchaseCeilingFor(candidates.find(item => item.asin === 'B0DQDTBXJ7')), 1345);
assert.strictEqual(test.profitFor(candidates.find(item => item.asin === 'B093DGHBXC'), 'clickpost').profit, 129);
assert(test.supplierQuick(products.find(item => item.asin === 'B0GZDF7V69')).includes('商品代・仕入総額は未確定'));

const csv = test.createCsv(candidates);
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
assert(element('#featured').innerHTML.includes('B0DQDTBXJ7'));
assert(element('#featured').innerHTML.includes('+¥465'));
assert(element('#featured').innerHTML.includes('仕入総額・1点'));
assert(element('#featured').innerHTML.includes('仕入先の要約'));
assert(element('#list').innerHTML.includes('candidate-source'));
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
