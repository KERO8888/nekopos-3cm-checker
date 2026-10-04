/* Pure, conservative screening logic. Measurements always refer to the packed parcel. */
(() => {
  'use strict';

  const services = {
    nekopos: { name: 'ネコポス', maxLong: 34, maxSum: 60, maxThickness: 3, maxWeight: 1000, minLong: 23, minShort: 11.5 },
    clickpost: { name: 'クリックポスト', maxLong: 34, maxSum: 60, maxThickness: 3, maxWeight: 2000, minLong: 14, minShort: 9 },
  };
  const positive = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const rounded = value => Math.round(value * 10) / 10;

  function checkService(spec, prediction, record = {}) {
    const pouchWidth = positive(record.pouchWidth);
    const pouchHeight = positive(record.pouchHeight);
    const packedLength = positive(record.shipLength);
    const packedWidth = positive(record.shipWidth);
    const packedThickness = positive(record.thickness);
    const packedWeight = positive(record.shipWeight);
    const measuredFootprint = packedLength !== null && packedWidth !== null;
    const measuredPouch = pouchWidth !== null && pouchHeight !== null;
    const source = measuredPouch ? 'measured_pouch' : prediction.footprintSource;
    const pouch = measuredPouch ? [pouchWidth, pouchHeight] : prediction.assumedPouchCm;
    const [pouchLong, pouchShort] = [...pouch].sort((a, b) => b - a);
    const [outerLong, outerShort] = measuredFootprint ? [packedLength, packedWidth].sort((a, b) => b - a) : [null, null];
    const longMin = measuredFootprint ? outerLong : Math.max(pouchLong, spec.minLong);
    const shortMin = measuredFootprint ? outerShort : Math.max(pouchShort, spec.minShort);
    // 0–2 cm total per axis is a planning allowance, not a measured mailer size.
    const longMax = measuredFootprint ? outerLong : Math.max(pouchLong + 2, spec.minLong);
    const shortMax = measuredFootprint ? outerShort : Math.max(pouchShort + 2, spec.minShort);
    const thicknessMin = packedThickness ?? prediction.roughThicknessCm[0];
    const thicknessMax = packedThickness ?? prediction.roughThicknessCm[1];
    const weightBase = prediction.manufacturerGrossWeightG ?? prediction.weightEstimateG ?? prediction.massG;
    const weightMax = packedWeight ?? (weightBase + 100); // provisional allowance for the outer mailer
    const weightMin = packedWeight ?? weightBase;
    const projected = { longMin: rounded(longMin), longMax: rounded(longMax), shortMin: rounded(shortMin), shortMax: rounded(shortMax), thicknessMin: rounded(thicknessMin), thicknessMax: rounded(thicknessMax), sumMin: rounded(longMin + shortMin + thicknessMin), sumMax: rounded(longMax + shortMax + thicknessMax), weightMin: rounded(weightMin), weightMax: rounded(weightMax) };
    const reasons = [];
    const definite = [];
    const uncertain = [];
    const reliableFootprint = measuredFootprint || source === 'manufacturer' || source === 'measured_pouch';

    if (measuredFootprint && (outerLong < spec.minLong || outerShort < spec.minShort)) {
      uncertain.push(`宛名面の最小${spec.minLong}×${spec.minShort}cmに不足。大きい封筒が必要`);
    }
    if (longMin > spec.maxLong) {
      (reliableFootprint ? definite : uncertain).push(`長辺${rounded(longMin)}cmが34cmを超える`);
    } else if (longMax > spec.maxLong) uncertain.push('梱包余白を入れると長辺34cmを超える可能性');
    if (projected.sumMin > spec.maxSum) {
      (reliableFootprint ? definite : uncertain).push(`3辺合計${projected.sumMin}cmが60cmを超える`);
    } else if (projected.sumMax > spec.maxSum) uncertain.push('梱包余白を入れると3辺合計60cmを超える可能性');
    if (weightMin > spec.maxWeight) {
      (packedWeight !== null || prediction.manufacturerGrossWeightG != null ? definite : uncertain).push(`重量${rounded(weightMin)}gが${spec.maxWeight}gを超える`);
    } else if (weightMax > spec.maxWeight) uncertain.push(`梱包材を加えると${spec.maxWeight}gを超える可能性`);
    if (thicknessMin > spec.maxThickness) {
      if (spec.name === 'ネコポス') {
        (packedThickness !== null ? definite : uncertain).push(`厚さ${rounded(thicknessMin)}cmが3cmを超える`);
      } else uncertain.push('厚さ3cmの投函目安を超えるため投函口の確認が必要');
    } else if (thicknessMax > spec.maxThickness) uncertain.push('厚さが3cmを超える可能性');
    if (source !== 'manufacturer' && source !== 'measured_pouch' && !measuredFootprint) uncertain.push('商品袋の縦横が未確認');
    if (!measuredFootprint) uncertain.push('発送用外装の縦横は未測定');
    if (packedThickness === null) uncertain.push('梱包後の厚さは未測定');
    if (packedWeight === null && weightMax > spec.maxWeight - 100) uncertain.push('梱包後の重量は未測定');

    let status = 'possible';
    if (definite.length) status = 'over';
    else if (uncertain.some(reason => /超える|不足|未確認|3cmの投函目安|重量は未測定/.test(reason))) status = 'check';
    // With measured packed dimensions and weight, all numeric criteria can be confirmed.
    const fullyMeasured = measuredFootprint && packedThickness !== null && packedWeight !== null;
    if (fullyMeasured && !definite.length && !uncertain.length) status = 'measured_ok';
    if (spec.name === 'クリックポスト' && status === 'measured_ok') reasons.push('規格数値内。使用するポストの投函口は要確認');
    else if (status === 'measured_ok') reasons.push('梱包後の外寸・重量で規格数値内');
    else if (status === 'possible') reasons.push('外装余白2cmと梱包材100gを仮置きした範囲では規格内');
    reasons.push(...definite, ...uncertain);
    return { status, reasons, projected, source, measuredFootprint, fullyMeasured };
  }

  function evaluate(prediction, record = {}) {
    return Object.fromEntries(Object.entries(services).map(([key, spec]) => [key, checkService(spec, prediction, record)]));
  }

  window.NEKOPOST_SHIPPING = { services, evaluate };
})();
