const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const saved = new Map();
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    querySelector() { return { open: false }; },
  });
  return elements.get(selector);
};
const context = {
  window: { location: { search: '?asin=B08123FNFK' } },
  document: { querySelector: element },
  localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
  FormData: class { constructor(form) { this.form = form; } *entries() { yield* Object.entries(this.form.values); } },
  URLSearchParams, Date, Number, Object, String,
};
vm.createContext(context);
for (const file of ['requested_reviews.js', 'requested_feedback.js', 'requested_page.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const feedback = context.window.NEKOPOST_REQUESTED_FEEDBACK;
const items = context.window.NEKOPOST_REQUESTED_REVIEWS.items;
assert(element('#requestedList').innerHTML.includes('B08123FNFK'));
assert(!element('#requestedList').innerHTML.includes('B0976PJ6K9'), 'ASIN query should isolate the matching card');
assert(element('#requestedList').innerHTML.includes('予測へのフィードバック'));
assert(element('#copyFeedback').disabled);

const fieldInputs = Object.fromEntries(['lengthCm', 'widthCm', 'thicknessCm', 'weightG'].map(key => [key,
  { error: '', setCustomValidity(value) { this.error = value; } }]));
const form = {
  dataset: { asin: 'B08123FNFK' },
  values: { verdict: 'wrong', evidence: 'packed_measurement', reason: 'thickness', lengthCm: '', widthCm: '', thicknessCm: '', weightG: '580', comment: '外装込みで入った' },
  elements: { namedItem: key => fieldInputs[key] },
  reportValidity() { return Object.values(fieldInputs).every(input => !input.error); },
};
const submit = () => element('#requestedList').listeners.submit({ target: { closest: () => form }, preventDefault() {} });
submit();
assert(fieldInputs.thicknessCm.error.includes('最大厚'));
assert.strictEqual(feedback.summary(items, feedback.read()).total, 0, 'unmeasured evidence must not be saved as measured');
form.values.lengthCm = '26';
form.values.widthCm = '18';
form.values.thicknessCm = '2.8';
submit();
assert.strictEqual(feedback.read().B08123FNFK.thicknessCm, 2.8);
assert(element('#feedbackMessage').textContent.includes('保存しました'));

feedback.save('B08123FNFK', { verdict: 'wrong', evidence: 'packed_measurement', reason: 'thickness',
  lengthCm: '26', widthCm: '18', thicknessCm: '2.8', weightG: '580', comment: '外装込みで入った\n局所厚を測定' });
feedback.save('B00TI64YHW', { verdict: 'correct', evidence: 'physical_check', comment: '現物で確認' });
const data = feedback.read();
const stats = feedback.summary(items, data);
assert.strictEqual(stats.total, 2);
assert.strictEqual(stats.correct, 1);
assert.strictEqual(stats.wrong, 1);
assert.strictEqual(stats.measured, 1);
assert.strictEqual(stats.accuracy, 50);
assert.strictEqual(stats.topReason, 'thickness');
assert(stats.improvement.includes('局所最大厚'));
const report = feedback.report(items, data);
assert(report.includes('B08123FNFK'));
assert(report.includes('外装の長辺: 26cm'));
assert(report.includes('外装の短辺: 18cm'));
assert(report.includes('外装込み最大厚: 2.8cm'));
assert(report.includes('外装込み重量: 580g'));
assert(report.includes('コメント: 外装込みで入った 局所厚を測定'));
assert(!report.includes('B0976PJ6K9'), 'unreviewed items must not appear in copied feedback');

feedback.save('B0976PJ6K9', { verdict: 'unsupported', evidence: 'unknown', reason: 'none',
  lengthCm: '-1', widthCm: 'bad', thicknessCm: '-2', weightG: 'bad', comment: '<script>alert(1)</script>' });
const invalid = feedback.read().B0976PJ6K9;
assert.strictEqual(invalid.verdict, '');
assert.strictEqual(invalid.lengthCm, null);
assert.strictEqual(invalid.widthCm, null);
assert.strictEqual(invalid.thicknessCm, null);
assert.strictEqual(invalid.weightG, null);
element('#asinSearch').listeners.input();
assert(element('#feedbackStats').textContent.includes('評価済み 2件'));
assert(element('#feedbackAdvice').textContent.includes('厚さ'));
assert(!element('#copyFeedback').disabled);
element('#asinSearch').value = 'B0976PJ6K9';
element('#asinSearch').listeners.input();
assert(!element('#requestedList').innerHTML.includes('<script>alert(1)</script>'), 'comments must be escaped in card HTML');
assert(element('#requestedList').innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
console.log('requested feedback storage, calibration summary, copy report and UI rendering: ok');
