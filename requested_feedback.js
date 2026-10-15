/* Feedback is private to this browser until the user copies the report. */
window.NEKOPOST_REQUESTED_FEEDBACK = (() => {
  const storageKey = 'nekopos-requested-feedback-v1';
  const verdicts = new Set(['correct', 'wrong']);
  const evidence = new Set(['packed_measurement', 'physical_check', 'listing_check']);
  const reasons = new Set(['sales_unit', 'package_shape', 'thickness', 'weight', 'listing_data', 'price', 'other']);
  const verdictLabels = { correct: '合っていた', wrong: '違った' };
  const evidenceLabels = { packed_measurement: '発送外装の4項目を実測', physical_check: '現物を確認', listing_check: '掲載情報で確認' };
  const reasonLabels = { sales_unit: '販売単位', package_shape: '袋・硬い部分', thickness: '厚さ', weight: '重量', listing_data: '掲載寸法・商品情報', price: '価格・仕入れ', other: 'その他' };
  const advice = {
    sales_unit: 'Amazonの販売単位と単品JANを先に照合する。',
    package_shape: '未開封の袋、マチ、キャップ、硬い部品を現物画像で確認する。',
    thickness: '平置き後と発送外装込みの局所最大厚を別々に記録する。',
    weight: '商品重量と発送外装込みの重量を分けて照合する。',
    listing_data: 'Keepaの梱包値を実寸と混同せず、同一ASINの現行情報と突き合わせる。',
    price: '自己発送の実売価格、同一JANの仕入価格、送料、手数料を再確認する。',
    other: 'コメントを見て、判定基準に足りない条件を追加する。',
  };
  const positiveNumber = value => {
    const number = Number(value);
    return value !== '' && Number.isFinite(number) && number > 0 ? number : null;
  };
  const clean = raw => ({
    verdict: verdicts.has(raw?.verdict) ? raw.verdict : '',
    evidence: evidence.has(raw?.evidence) ? raw.evidence : '',
    reason: reasons.has(raw?.reason) ? raw.reason : '',
    lengthCm: positiveNumber(raw?.lengthCm),
    widthCm: positiveNumber(raw?.widthCm),
    thicknessCm: positiveNumber(raw?.thicknessCm),
    weightG: positiveNumber(raw?.weightG),
    comment: String(raw?.comment || '').trim().slice(0, 2000),
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  });
  const read = () => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  };
  const save = (asin, raw) => {
    const data = read();
    data[asin] = clean({ ...raw, updatedAt: new Date().toISOString() });
    localStorage.setItem(storageKey, JSON.stringify(data));
    return data;
  };
  const summary = (items, data) => {
    const records = items.map(item => data[item.asin]).filter(row => verdicts.has(row?.verdict));
    const correct = records.filter(row => row.verdict === 'correct').length;
    const wrong = records.filter(row => row.verdict === 'wrong');
    const measured = records.filter(row => row.evidence === 'packed_measurement'
      && [row.lengthCm, row.widthCm, row.thicknessCm, row.weightG].every(value => Number(value) > 0)).length;
    const reasonCounts = {};
    for (const row of wrong) if (row.reason) reasonCounts[row.reason] = (reasonCounts[row.reason] || 0) + 1;
    const topReason = Object.keys(reasonCounts).sort((a, b) => reasonCounts[b] - reasonCounts[a])[0] || '';
    return { total: records.length, correct, wrong: wrong.length, measured, topReason,
      accuracy: records.length ? Math.round(correct / records.length * 100) : null,
      improvement: topReason ? advice[topReason] : '間違いが出たら、発送外装込みの最大厚・重量とズレた理由を記録すると、次に直す条件を絞れます。' };
  };
  const report = (items, data) => {
    const rows = items.filter(item => {
      const row = data[item.asin];
      return row && (row.verdict || row.evidence || row.reason || row.lengthCm || row.widthCm || row.thicknessCm || row.weightG || row.comment);
    });
    return ['発送サイズ研究所｜指定ASINのフィードバック', '※ユーザー入力。掲載寸法や未測定値を実測として扱わない。',
      ...rows.map(item => {
        const row = clean(data[item.asin]);
        const parts = [item.asin, item.title, `サイト判定: ${item.status === 'shipping_hold' ? '小型発送見込み・要実測' : item.status === 'hold' ? '形状確認待ち' : '主一覧対象外'}`,
          `評価: ${verdictLabels[row.verdict] || '未確認'}`, `根拠: ${evidenceLabels[row.evidence] || '未選択'}`];
        if (row.lengthCm !== null) parts.push(`外装の長辺: ${row.lengthCm}cm`);
        if (row.widthCm !== null) parts.push(`外装の短辺: ${row.widthCm}cm`);
        if (row.thicknessCm !== null) parts.push(`外装込み最大厚: ${row.thicknessCm}cm`);
        if (row.weightG !== null) parts.push(`外装込み重量: ${row.weightG}g`);
        if (row.reason) parts.push(`ズレた点: ${reasonLabels[row.reason]}`);
        if (row.comment) parts.push(`コメント: ${row.comment.replace(/\s+/g, ' ')}`);
        return parts.join(' / ');
      })].join('\n');
  };
  return { read, save, summary, report, verdictLabels, evidenceLabels, reasonLabels };
})();
