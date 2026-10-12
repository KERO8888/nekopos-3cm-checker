const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { window: {} };
vm.createContext(context);
for (const file of ['data.js', 'sourcing.js', 'market_data.js', 'finance.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const products = context.window.NEKOPOST_PRODUCTS;
const market = context.window.NEKOPOST_MARKET;
const sourcing = context.window.NEKOPOST_SOURCING;
const finance = context.window.NEKOPOST_FINANCE;
const rawMfnFees = JSON.parse(fs.readFileSync('fee_estimates.json', 'utf8')).items;
assert.strictEqual(Object.keys(market.offers).length, products.length);
assert.strictEqual(Object.keys(market.supplierSearch).length, products.length);
assert(market.referenceFees.B0GZ4CP7BV, 'new pouch lacks a reference MFN fee scenario');

for (const product of products) {
  const offer = market.offers[product.asin]?.lowestMerchant;
  const fee = market.fees[product.asin];
  if (!offer) {
    assert.strictEqual(fee, undefined, `fee without a merchant offer: ${product.asin}`);
    continue;
  }
  assert.strictEqual(offer.landedYen, offer.listingYen + offer.shippingYen, product.asin);
  assert.strictEqual(fee.status, 'Success', `fee estimate missing: ${product.asin}`);
  assert.strictEqual(fee.listingYen, offer.listingYen, product.asin);
  assert.strictEqual(fee.shippingYen, offer.shippingYen, product.asin);
  assert.strictEqual(rawMfnFees[product.asin].totalFeeYen, rawMfnFees[product.asin].referralFeeYen, `MFN estimate contains an additional fee: ${product.asin}`);
  for (const supplier of market.suppliers[product.asin] || []) {
    assert(/^(?:JAN \d{13}|店舗間JAN一致 \d{13}（Amazon側未照合）)/.test(supplier.identity), `supplier missing JAN evidence: ${product.asin}`);
    assert(supplier.priceYen >= 0, product.asin);
  }
}

assert(!products.some(product => product.asin === 'B0997R1575'), '600g + 200g with spoon is not a single flexible pouch');
assert(!market.suppliers.B0997R1575, '600g-only source must not be used for 600g + 200g');

for (const asin of ['B0H7HRMFMR', 'B0GZDF7V69']) {
  assert.strictEqual(market.suppliers[asin]?.length, 0, `multi-unit supplier leaked into one-unit profit: ${asin}`);
  assert.strictEqual(market.supplierSearch[asin].verified, false, asin);
}

assert.strictEqual(sourcing.suppliers.B0GL6TYSJR[0].priceYen + sourcing.suppliers.B0GL6TYSJR[0].inboundShippingYen, 1520);
assert(market.suppliers.B0DQDTBXJ7.some(supplier => supplier.identity.includes('Amazon側未照合')));
assert.strictEqual(market.supplierSearch.B0DQDTBXJ7.discoveredJan, '4548514159327');
assert.strictEqual(market.supplierSearch.B0DQDTBXJ7.rakutenJanQueries, 1);
assert.strictEqual(market.supplierSearch.B0GL6TYSJR.rakutenJanQueries, 1);

for (const [asin, fee] of Object.entries(market.referenceFees)) {
  const offer = market.offers[asin];
  assert.strictEqual(offer.lowestMerchant, null, `reference fee has MFN offer: ${asin}`);
  const reference = offer.featuredOffer?.fulfilledByAmazon ? offer.featuredOffer : offer.lowestAmazonFulfilled;
  assert.strictEqual(reference?.fulfilledByAmazon, true, asin);
  assert.strictEqual(fee.status, 'Success', asin);
  assert.strictEqual(fee.listingYen, reference.listingYen, asin);
  assert.strictEqual(fee.shippingYen, reference.shippingYen, asin);
}

function observedProfit(asin, supplier) {
  const offer = market.offers[asin].lowestMerchant;
  const fee = market.fees[asin];
  return finance.estimate({
    salePrice: offer.listingYen + offer.shippingYen,
    pointsCost: offer.points,
    buyPrice: supplier.priceYen,
    buyShipping: supplier.inboundShippingYen,
    outboundShipping: 240,
    packagingCost: 20,
    observedFeeYen: fee.totalFeeYen,
    profile: 'beauty',
    plan: 'professional',
  }).profit;
}

for (const asin of ['B093DGHBXC', 'B0DQDTBXJ7']) {
  const supplier = sourcing.suppliers[asin][0];
  const offer = market.offers[asin].lowestMerchant;
  const fee = market.fees[asin];
  const expected = offer.landedYen - offer.points - supplier.priceYen - supplier.inboundShippingYen - 240 - 20 - Math.ceil(fee.totalFeeYen * 1.1);
  assert.strictEqual(observedProfit(asin, supplier), expected, asin);
}
console.log('market data and observed MFN profit: ok');
