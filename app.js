(() => {
  'use strict';

  const products = window.NEKOPOST_PRODUCTS || [];
  const predictions = window.NEKOPOST_PREDICTIONS || {};
  const productImages = window.NEKOPOST_IMAGES?.images || {};
  const localProductImages = window.NEKOPOST_LOCAL_IMAGES || {};
  const apiDimensions = window.NEKOPOST_API_DIMENSIONS?.items || {};
  const shipping = window.NEKOPOST_SHIPPING;
  const sourcing = window.NEKOPOST_SOURCING || { suppliers: {}, amazonPrices: {} };
  const market = window.NEKOPOST_MARKET || { offers: {}, fees: {}, referenceFees: {}, suppliers: {}, supplierSearch: {} };
  const research = window.NEKOPOST_RESEARCH_STATUS || {};
  const finance = window.NEKOPOST_FINANCE;
  const demoMeasurements = window.NEKOPOST_DEMO_MEASUREMENTS || [];
  const demoByAsin = new Map(demoMeasurements.map((sample, index) => [sample.asin, { ...sample, order: index }]));
  const trialProducts = window.NEKOPOST_TRIAL_PRODUCTS || [];
  const trialByAsin = new Map(trialProducts.map((trial, index) => [trial.asin, { ...trial, order: index }]));
  const storageKey = 'nekopos-candidates-v1';
  let visibleLimit = 20;
  let selectedAsin = products.some(item => item.asin === 'B0DQDTBXJ7') ? 'B0DQDTBXJ7' : '';
  let profitFilter = 'candidate';
  let demoOnly = false;
  let measuredOnly = false;
  let trialOnly = false;
  const verdictLabels = {
    likely: '3cm以内に収まりそう',
    borderline: '境界・情報不足',
    unlikely: '3cm以内は難しい',
  };
  const verdictOrder = { likely: 0, borderline: 1, unlikely: 2 };
  const shippingLabels = { possible: '概算内・要実測', check: '要実測', over: '規格外', measured_ok: '実測値は規格内' };
  const shippingClasses = { possible: 'borderline', check: 'borderline', over: 'unlikely', measured_ok: 'likely' };
  const footprintLabels = { manufacturer: 'メーカー公表寸法', catalog_item: '登録商品寸法', catalog_package: '登録包装寸法から仮定', analogue: '同系品・画像から仮定' };
  const confidenceOrder = { 高: 0, 中: 1, 低: 2 };
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const imageFor = asin => localProductImages[asin] || productImages[asin] || '';
  let records = {};
  try { records = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { records = {}; }
  const recordFor = asin => records[asin] || {};
  const demoFor = asin => demoByAsin.get(asin);
  const demoWithin3Cm = sample => sample.length >= 23 && sample.width >= 11.5 && sample.length <= 34
    && sample.length + sample.width + sample.thickness <= 60 && sample.thickness <= 3 && sample.weight <= 1000;
  const measurementFields = ['pouchWidth', 'pouchHeight', 'shipLength', 'shipWidth', 'thickness', 'shipWeight'];
  const isMeasured = (record, key) => record[key] !== '' && record[key] != null && Number.isFinite(Number(record[key])) && Number(record[key]) > 0;
  const measurementCount = record => measurementFields.filter(key => isMeasured(record, key)).length;
  const hasRealMeasurements = record => ['shipLength', 'shipWidth', 'thickness', 'shipWeight'].every(key => isMeasured(record, key));
  const shippingLabelFor = (result, record) => result.status !== 'over' && !result.fullyMeasured && measurementCount(record)
    ? '一部実測・要確認' : shippingLabels[result.status];
  function saveRecords() {
    try { localStorage.setItem(storageKey, JSON.stringify(records)); }
    catch { alert('実測記録を保存できませんでした。CSVに書き出して控えてください。'); }
  }

  if (!products.length || !shipping || new Set(products.map(item => item.asin)).size !== products.length || products.some(item => !predictions[item.asin])
    || trialByAsin.size !== trialProducts.length || trialProducts.some(trial => !products.some(item => item.asin === trial.asin))) {
    $('#list').innerHTML = '<div class="empty">推定データを読み込めませんでした。ページを再読み込みしてください。</div>';
    return;
  }

  const pageParams = new URLSearchParams(window.location?.search || '');
  if (pageParams.get('demo') === '1') {
    demoOnly = true;
    profitFilter = 'all';
    selectedAsin = demoMeasurements[0]?.asin || '';
  }
  if (pageParams.get('trial') === '1') {
    trialOnly = true;
    demoOnly = false;
    profitFilter = 'all';
    selectedAsin = trialProducts[0]?.asin || '';
  }
  const requestedAsin = pageParams.get('asin');
  if (requestedAsin && products.some(item => item.asin === requestedAsin)) {
    selectedAsin = requestedAsin;
    profitFilter = 'all';
    $('#search').value = requestedAsin;
  }

  const categories = [...new Set(products.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'ja'));
  $('#category').replaceChildren(new Option('すべて', 'all'), ...categories.map(category => new Option(category, category)));
  const fitFor = item => shipping.evaluate(predictions[item.asin], recordFor(item.asin));
  const isFit = status => status === 'possible' || status === 'measured_ok';
  const fitRank = item => {
    const fit = fitFor(item);
    const possible = Number(isFit(fit.nekopos.status)) + Number(isFit(fit.clickpost.status));
    const over = Number(fit.nekopos.status === 'over') + Number(fit.clickpost.status === 'over');
    return possible === 2 ? 0 : possible === 1 ? 1 : over === 2 ? 4 : over === 1 ? 3 : 2;
  };
  function sortedProducts() {
    return [...products].sort((a, b) => {
      if (trialOnly) return (trialByAsin.get(a.asin)?.order ?? Infinity) - (trialByAsin.get(b.asin)?.order ?? Infinity);
      if (demoOnly) return (demoFor(a.asin)?.order ?? Infinity) - (demoFor(b.asin)?.order ?? Infinity);
      const pa = predictions[a.asin];
      const pb = predictions[b.asin];
      if ($('#sortMode').value === 'profit') {
        const states = { candidate: 0, reference: 1, price_risk: 2, loss: 3, sourcing: 4, price_missing: 5, over: 6 };
        const stateDiff = states[profitStateFor(a)] - states[profitStateFor(b)];
        if (stateDiff) return stateDiff;
        const profitDiff = (profitFor(b, 'clickpost')?.profit ?? -Infinity) - (profitFor(a, 'clickpost')?.profit ?? -Infinity);
        if (Number.isFinite(profitDiff) && profitDiff) return profitDiff;
      }
      return fitRank(a) - fitRank(b)
        || verdictOrder[pa.verdict] - verdictOrder[pb.verdict]
        || confidenceOrder[pa.confidence] - confidenceOrder[pb.confidence]
        || pa.roughThicknessCm[1] - pb.roughThicknessCm[1]
        || a.asin.localeCompare(b.asin);
    });
  }

  function renderStats() {
    $('#totalCount').textContent = products.length;
    $('#heroCount').textContent = products.length;
    $('#researchLink').textContent = Number.isInteger(research.discoveredCount)
      ? `ASIN発見 ${research.discoveredCount.toLocaleString('ja-JP')}件（未確認含む）`
      : 'データ取得状況';
    $('#csvTitle').textContent = `${products.length}件のCSV`;
    const fits = products.map(fitFor);
    $('#likelyCount').textContent = fits.filter(fit => isFit(fit.nekopos.status) && isFit(fit.clickpost.status)).length;
    $('#unlikelyCount').textContent = fits.filter(fit => fit.nekopos.status === 'over' && fit.clickpost.status === 'over').length;
    $('#borderlineCount').textContent = products.length - Number($('#likelyCount').textContent) - Number($('#unlikelyCount').textContent);
    const states = products.map(profitStateFor);
    $('#profitCandidateCount').textContent = states.filter(state => state === 'candidate').length;
    $('#profitReferenceCount').textContent = states.filter(state => state === 'reference').length;
    $('#profitSourcingCount').textContent = states.filter(state => state === 'sourcing').length;
    $('#profitPriceMissingCount').textContent = states.filter(state => state === 'price_missing').length;
    $('#profitAllCount').textContent = products.length;
    const actualCount = products.filter(item => measurementCount(recordFor(item.asin))).length;
    $('#actualCount').textContent = `${actualCount}件`;
    $('#measuredToggle').disabled = actualCount === 0;
    const measuredThicknesses = trialProducts.filter(trial => isMeasured(recordFor(trial.asin), 'thickness'));
    const within3cm = measuredThicknesses.filter(trial => Number(recordFor(trial.asin).thickness) <= 3).length;
    const forecastExceeded = measuredThicknesses.filter(trial => Number(recordFor(trial.asin).thickness) > predictions[trial.asin].roughThicknessCm[1]).length;
    $('#trialProgress').textContent = `厚さ ${measuredThicknesses.length}/${trialProducts.length}件入力`;
    $('#trialThicknessStatus').textContent = measuredThicknesses.length ? `厚さ3cm以下 ${within3cm}件・超 ${measuredThicknesses.length - within3cm}件` : '厚さの入力待ち';
    $('#trialShippingStatus').textContent = `外装4項目 ${trialProducts.filter(trial => hasRealMeasurements(recordFor(trial.asin))).length}/${trialProducts.length}件入力済み`;
    $('#trialPredictionStatus').hidden = measuredThicknesses.length === 0;
    $('#trialPredictionStatus').textContent = `実測が予測上限より厚い ${forecastExceeded}/${measuredThicknesses.length}件`;
    const registeredDemos = demoMeasurements.filter(sample => products.some(item => item.asin === sample.asin));
    $('#demoTotalCount').textContent = `${registeredDemos.length}件の表示例`;
    $('#demoWithinCount').textContent = registeredDemos.filter(demoWithin3Cm).length;
    $('#demoOverCount').textContent = registeredDemos.length - registeredDemos.filter(demoWithin3Cm).length;
  }

  function filteredProducts() {
    const query = $('#search').value.trim().toLowerCase();
    const category = $('#category').value;
    const dimension = $('#dimension').value;
    const forecast = $('#forecast').value;
    const shippingFilter = $('#shippingFilter').value;
    return sortedProducts().filter(item => {
      const prediction = predictions[item.asin];
      const fit = fitFor(item);
      const fitMatches = shippingFilter === 'all'
        || (shippingFilter === 'both' && isFit(fit.nekopos.status) && isFit(fit.clickpost.status))
        || (shippingFilter === 'nekopos' && isFit(fit.nekopos.status))
        || (shippingFilter === 'clickpost' && isFit(fit.clickpost.status))
        || (shippingFilter === 'check' && (fit.nekopos.status === 'check' || fit.clickpost.status === 'check'))
        || (shippingFilter === 'over' && fit.nekopos.status === 'over' && fit.clickpost.status === 'over');
      return (!query || `${item.asin} ${item.title} ${item.category} ${prediction.material}`.toLowerCase().includes(query))
        && (profitFilter === 'all' || profitStateFor(item) === profitFilter)
        && (!measuredOnly || measurementCount(recordFor(item.asin)) > 0)
        && (!trialOnly || trialByAsin.has(item.asin))
        && (!demoOnly || demoByAsin.has(item.asin))
        && (category === 'all' || item.category === category)
        && (dimension === 'all' || (dimension === 'confirmed') === item.sizeConfirmed)
        && (forecast === 'all' || forecast === prediction.verdict)
        && fitMatches;
    });
  }

  function sourceLink(url, index) {
    const label = index === 0 ? 'Amazon商品ページ' : (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '参考情報'; }
    })();
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function dimensionText(dims) {
    if (!dims || !Array.isArray(dims.cm) || dims.cm.length !== 3) return '寸法データなし';
    return `${dims.cm.map(value => Number(value).toFixed(1)).join(' × ')} cm`;
  }

  function sourceRow(label, value, tone = '') {
    return `<div class="source-row"><b>${escapeHtml(label)}</b><span class="${tone}">${value}</span></div>`;
  }

  function shippingRow(name, result, record) {
    const detail = result.reasons.find(reason => /超える|不足|未確認|投函目安|重量は未測定/.test(reason)) || result.reasons[0];
    const note = result.status === 'possible' ? '発送可否は未確定。梱包後の外寸・重量を実測' : detail;
    const yamato = name === 'ネコポス';
    const mark = yamato ? 'assets/yamato-official-logo.png' : 'assets/clickpost-official-brand.png';
    const carrier = yamato ? 'ヤマト運輸' : '日本郵便';
    const source = yamato ? 'https://business.kuronekoyamato.co.jp/service/lineup/nekoposu/index.html' : 'https://www.post.japanpost.jp/service/send/domestic/delivery/clickpost/';
    return `<div class="shipping-row service-${yamato ? 'yamato' : 'clickpost'} ${shippingClasses[result.status]}"><div class="shipping-brand"><span class="service-emblem" aria-hidden="true"><img class="service-mark" src="${mark}" alt=""></span><div class="service-identity"><small>${carrier}</small><b>${name}</b></div></div><a class="shipping-source" href="${source}" target="_blank" rel="noopener noreferrer" aria-label="${name}の公式規格を見る">↗</a><div class="shipping-spec"><span>サイズ上限</span><strong>長辺34cm · 3辺計60cm · 厚さ3cm${yamato ? '以内' : '目安'}</strong><span>重さ上限</span><strong>${yamato ? '1kg' : '2kg'}以内</strong></div><div class="shipping-verdict"><span class="pill ${shippingClasses[result.status]}">${shippingLabelFor(result, record)}</span><small>${escapeHtml(note)}</small></div></div>`;
  }

  const yen = value => `¥${Math.round(value).toLocaleString('ja-JP')}`;
  const inputValue = (record, key, fallback = '') => record[key] == null ? fallback : record[key];
  function suppliersFor(asin) {
    const combined = [...(market.suppliers?.[asin] || []), ...(sourcing.suppliers?.[asin] || [])];
    const unique = [...new Map(combined.map(supplier => [supplier.url, supplier])).values()];
    return unique.sort((a, b) => a.priceYen - b.priceYen || (a.inboundShippingYen ?? Infinity) - (b.inboundShippingYen ?? Infinity));
  }
  function supplierPlatform(supplier) {
    let host = '';
    try { host = new URL(supplier.url).hostname; } catch (_) { /* Keep unknown stores labeled as other. */ }
    if (host === 'item.rakuten.co.jp') return { key: 'rakuten', icon: '楽', label: '楽天市場' };
    if (host === 'store.shopping.yahoo.co.jp') return { key: 'yahoo', icon: 'Y!', label: 'Yahoo!' };
    if (host === 'www.yodobashi.com') return { key: 'yodobashi', icon: 'ヨ', label: 'ヨドバシ' };
    if (host === 'www.askul.co.jp') return { key: 'askul', icon: 'A', label: 'アスクル' };
    return { key: 'other', icon: '店', label: 'その他の店舗' };
  }
  function supplierBadge(supplier) {
    const platform = supplierPlatform(supplier);
    return `<span class="supplier-platform supplier-platform-${platform.key}"><span class="supplier-platform-icon" aria-hidden="true">${platform.icon}</span><span class="supplier-platform-label">${platform.label}</span></span>`;
  }
  function supplierDisplayName(supplier) {
    const name = supplier.name || '';
    const platform = supplierPlatform(supplier).key;
    if (platform === 'rakuten') return name.replace(/^楽天市場\s*\/\s*/, '');
    if (platform === 'yahoo') return name.replace(/\s*（Yahoo!ショッピング）$/, '');
    return name;
  }
  const merchantOfferFor = asin => market.offers?.[asin]?.lowestMerchant || null;
  const referenceOfferFor = asin => merchantOfferFor(asin) ? null : (market.offers?.[asin]?.featuredOffer?.fulfilledByAmazon ? market.offers[asin].featuredOffer : market.offers?.[asin]?.lowestAmazonFulfilled || null);
  function saleInputsFor(item, record) {
    const merchant = merchantOfferFor(item.asin);
    const reference = referenceOfferFor(item.asin);
    const offer = merchant || reference;
    const listing = inputValue(record, 'saleListing', inputValue(record, 'salePrice', offer?.listingYen ?? ''));
    const shipping = inputValue(record, 'saleShipping', record.salePrice == null ? (offer?.shippingYen ?? '') : 0);
    const points = inputValue(record, 'salePoints', offer?.points ?? 0);
    const priceEdited = record.saleListing != null || record.saleShipping != null || record.salePrice != null;
    return { listing, shipping, points, basis: priceEdited ? 'manual' : merchant ? 'mfn' : reference ? 'fba_reference' : 'none' };
  }
  function feeEstimateFor(item, sale, record) {
    const source = merchantOfferFor(item.asin) ? market.fees?.[item.asin] : market.referenceFees?.[item.asin];
    return source?.status === 'Success'
      && Number(sale.listing) === source.listingYen
      && Number(sale.shipping) === source.shippingYen
      && inputValue(record, 'sellingPlan', 'professional') === 'professional'
      ? source.totalFeeYen : null;
  }
  function profitFor(item, method, record = recordFor(item.asin)) {
    const supplier = suppliersFor(item.asin)[0];
    const sale = saleInputsFor(item, record);
    return finance?.estimate({
      salePrice: sale.listing === '' || sale.shipping === '' ? null : Number(sale.listing) + Number(sale.shipping),
      buyPrice: inputValue(record, 'buyPrice', supplier?.priceYen ?? ''),
      buyShipping: inputValue(record, 'buyShipping', 0),
      outboundShipping: method === 'clickpost' ? 240 : inputValue(record, 'nekoposFee'),
      packagingCost: inputValue(record, 'packagingCost', 20),
      pointsCost: sale.points,
      manualReferralRate: inputValue(record, 'manualReferralRate'),
      observedFeeYen: feeEstimateFor(item, sale, record),
      profile: finance.profileFor(item.category),
      plan: inputValue(record, 'sellingPlan', 'professional'),
    }) || null;
  }
  function purchaseCeilingFor(item, record = recordFor(item.asin)) {
    const sale = saleInputsFor(item, record);
    if (sale.listing === '' || sale.shipping === '') return null;
    const result = finance?.estimate({
      salePrice: Number(sale.listing) + Number(sale.shipping), pointsCost: sale.points,
      buyPrice: 0, buyShipping: 0, outboundShipping: 240,
      packagingCost: inputValue(record, 'packagingCost', 20),
      manualReferralRate: inputValue(record, 'manualReferralRate'),
      observedFeeYen: feeEstimateFor(item, sale, record),
      profile: finance.profileFor(item.category),
      plan: inputValue(record, 'sellingPlan', 'professional'),
    });
    return result?.profit ?? null;
  }
  function priceGapFor(item, record = recordFor(item.asin)) {
    const sale = saleInputsFor(item, record);
    const featured = market.offers?.[item.asin]?.featuredOffer;
    if (!featured || sale.listing === '' || sale.shipping === '') return 0;
    const gap = Number(sale.listing) + Number(sale.shipping) - featured.landedYen;
    return gap >= Math.max(100, featured.landedYen * 0.05) ? gap : 0;
  }
  function profitStateFor(item, record = recordFor(item.asin)) {
    if (fitFor(item).clickpost.status === 'over') return 'over';
    const result = profitFor(item, 'clickpost', record);
    if (!result) return purchaseCeilingFor(item, record) == null ? 'price_missing' : 'sourcing';
    const sale = saleInputsFor(item, record);
    if (sale.basis === 'fba_reference' || sale.basis === 'manual') return 'reference';
    if (result.profit <= 0) return 'loss';
    if (!market.offers?.[item.asin]?.featuredOffer) return 'reference';
    return priceGapFor(item, record) ? 'price_risk' : 'candidate';
  }

  function profitResult(item, method, record) {
    const shippingStatus = fitFor(item)[method].status;
    const result = profitFor(item, method, record);
    const sale = saleInputsFor(item, record);
    const featured = market.offers?.[item.asin]?.featuredOffer;
    const gap = priceGapFor(item, record);
    const priceWarning = gap ? ` · おすすめ出品${yen(featured.landedYen)}より${yen(gap)}高い。販売成立は未確認。` : '';
    const label = method === 'clickpost' ? 'クリックポスト（送料240円）' : 'ネコポス（契約運賃）';
    if (shippingStatus === 'over') return `<div class="profit-result pending"><b>${label}</b><strong>規格外</strong><small>この発送方法の運賃では利益を計算しません。</small></div>`;
    if (!result) {
      const ceiling = method === 'clickpost' ? purchaseCeilingFor(item, record) : null;
      const reason = method === 'nekopos' && !inputValue(record, 'nekoposFee') ? '契約運賃を入力してください。'
        : sale.listing === '' || sale.shipping === '' ? '自己発送価格が未取得。実際の出品条件を入力してください。'
          : ceiling != null && ceiling >= 0 ? `仕入先が未照合。仕入送料0円の仮定では、仕入価格が${yen(ceiling)}以下なら収支0円以上の計算です。`
            : '仕入先の単品価格が未照合です。';
      return `<div class="profit-result pending"><b>${label}</b><strong>${ceiling != null && ceiling >= 0 && method === 'clickpost' ? `仕入上限 ${yen(ceiling)}` : '未計算'}</strong><small>${reason}${sale.basis === 'fba_reference' ? ' FBA価格を自己発送へ当てはめた参考値です。' : ''}</small></div>`;
    }
    const reference = sale.basis === 'fba_reference' || sale.basis === 'manual';
    const tone = reference || priceWarning ? 'pending' : result.profit >= 0 ? 'positive' : 'negative';
    const basisLabel = sale.basis === 'fba_reference' ? ' · FBA価格で仮計算' : sale.basis === 'manual' ? ' · 入力価格で試算' : '';
    return `<div class="profit-result ${tone}"><b>${label}${shippingStatus === 'check' ? ' · サイズ要実測' : ''}${basisLabel}${priceWarning ? ' · 価格差あり' : ''}</b><strong>${result.profit < 0 ? '−' : '+'}${yen(Math.abs(result.profit))}</strong><small>利益率 ${result.margin}% · Amazon自己発送手数料 ${yen(result.fees)}（${result.feeSource === 'sp_api_estimate' ? 'SP-API見積もり＋消費税' : 'カテゴリー料率の概算'}${result.planFee ? `＋小口 ${yen(result.planFee)}` : ''}、FBA配送代行手数料なし）${sale.basis === 'fba_reference' ? ' · 実際の自己発送出品価格は未確認。' : ''}${priceWarning}</small></div>`;
  }

  function quickBreakdownFor(item, record) {
    if (fitFor(item).clickpost.status === 'over') return '<p class="profit-empty">クリックポストの規格外です。</p>';
    const result = profitFor(item, 'clickpost', record);
    if (!result) {
      const ceiling = purchaseCeilingFor(item, record);
      return `<p class="profit-empty">${ceiling != null && ceiling >= 0 ? `仕入価格の収支ゼロ上限：${yen(ceiling)}（仕入送料0円の仮定）。仕入先の単品価格を確認してください。` : '自己発送の出品価格・購入者送料・仕入条件がそろうと概算を表示します。'}</p>`;
    }
    const sale = saleInputsFor(item, record);
    return `<div class="profit-breakdown"><div><span>${sale.basis === 'fba_reference' ? 'FBA価格を転用した仮の売価' : '自己発送の出品価格'}</span><b>${yen(Number(sale.listing))}</b></div><div><span>購入者負担の配送料</span><b>＋${yen(Number(sale.shipping))}</b></div><div><span>付与ポイント（保守的に費用化）</span><b>−${yen(result.points)}</b></div><div><span>仕入価格</span><b>${yen(result.buy)}</b></div><div><span>仕入送料</span><b>${yen(result.inbound)}</b></div><div><span>送料（クリックポスト）</span><b>${yen(result.outbound)}</b></div><div><span>梱包材・Amazon自己発送手数料</span><b>${yen(result.packing + result.fees)}</b></div></div>`;
  }

  function profitPanel(item, record) {
    const suppliers = suppliersFor(item.asin);
    const supplierSearch = market.supplierSearch?.[item.asin];
    const amazon = merchantOfferFor(item.asin);
    const reference = referenceOfferFor(item.asin);
    const sale = saleInputsFor(item, record);
    const featured = market.offers?.[item.asin]?.featuredOffer;
    const offerChecked = market.offers?.[item.asin]?.checkedAt
      ? new Date(market.offers[item.asin].checkedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '日時不明';
    const offerNote = amazon
      ? `${offerChecked} SP-API照会の自己発送の最安出品例：商品${yen(amazon.listingYen)}＋購入者送料${yen(amazon.shippingYen)}＝合計${yen(amazon.landedYen)}${amazon.points ? `、付与ポイント${amazon.points}pt` : ''}。${featured ? `おすすめ出品は合計${yen(featured.landedYen)}（${featured.fulfilledByAmazon ? 'FBA' : '自己発送'}）。` : 'おすすめ出品価格は未取得。'}価格は販売成立額ではありません。`
      : reference ? `${offerChecked} SP-APIで自己発送の新規出品は未確認。${featured?.fulfilledByAmazon ? 'FBAおすすめ出品' : '取得できたFBAの最安出品'}の商品${yen(reference.listingYen)}＋購入者送料${yen(reference.shippingYen)}を自己発送の仮の売価として用い、自己発送手数料を別途見積もりました。実際にその価格で販売できる保証はありません。`
        : 'SP-APIで自己発送の新規出品も、おすすめ出品も確認できません。出品額は手入力が必要です。';
    const searchTerm = suppliers.find(s => /JAN \d{13}/.test(s.identity || ''))?.identity?.match(/JAN (\d{13})/)?.[1] || supplierSearch?.discoveredJan || item.title.slice(0, 38);
    const hasSupplierSearch = supplierSearch && (supplierSearch.status !== 'not_searched' || supplierSearch.rakutenQueries);
    const supplierRows = suppliers.length ? suppliers.map(s => `<div class="supplier-row"><div><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.name)}">${supplierBadge(s)}<span class="supplier-store-name">${escapeHtml(supplierDisplayName(s))} ↗</span></a><small>${escapeHtml(s.identity)} · ${escapeHtml(s.checkedOn)}確認</small></div><b>${yen(s.priceYen)}<small>単品注文時送料 ${s.inboundShippingYen == null ? '未確認' : yen(s.inboundShippingYen)}（利益には未計上）</small></b><p>${escapeHtml(s.note)}</p></div>`).join('') : `<p class="supplier-empty">${hasSupplierSearch ? `Yahoo!ショッピングの検索候補${supplierSearch.primaryHits + supplierSearch.fallbackHits}件、楽天の検索${supplierSearch.rakutenQueries || 0}条件を調査しました。単品・JAN・価格・送料・在庫の照合が済んだ仕入先は未確認です。` : '仕入先の照合は未着手です。'} 検索リンクは仕入先の確認済み記録ではありません。</p>`;
    return `<section class="profit-panel" aria-label="仕入先と利益の試算">
      <div class="panel-title"><div><span class="page-kicker">SOURCING & PROFIT</span><h4>仕入先と利益の試算</h4></div><small>自社発送・1点あたり</small></div>
      <div class="supplier-list">${supplierRows}<div class="supplier-search"><span>ほかの仕入先を探す</span><a href="https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(searchTerm)}" target="_blank" rel="noopener noreferrer">Yahoo!ショッピング ↗</a><a href="https://search.rakuten.co.jp/search/mall/${encodeURIComponent(searchTerm)}/" target="_blank" rel="noopener noreferrer">楽天市場 ↗</a><small class="supplier-search-status">この商品の楽天JAN検索：${supplierSearch?.rakutenJanQueries ? `${supplierSearch.rakutenJanQueries}条件済み` : '未実施'}。検索結果と仕入先の照合は別です。</small></div></div>
      <div class="profit-fields">
        <label>${sale.basis === 'fba_reference' ? 'FBA出品の参考価格（税込）' : 'Amazon自己発送の出品価格（税込）'}<input data-profit="saleListing" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(sale.listing)}" placeholder="確認後に入力"></label>
        <label>購入者から受け取る配送料（税込）<input data-profit="saleShipping" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(sale.shipping)}" placeholder="送料無料なら0"></label>
        <label>付与ポイント数（1pt＝1円で控除）<input data-profit="salePoints" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(sale.points)}"></label>
        <label>仕入価格（税込）<input data-profit="buyPrice" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(inputValue(record, 'buyPrice', suppliers[0]?.priceYen ?? ''))}" placeholder="確認後に入力"></label>
        <label>利益計算に入れる仕入送料（税込・初期値0円）<input data-profit="buyShipping" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(inputValue(record, 'buyShipping', 0))}" placeholder="送料無料なら0"></label>
        <label>梱包資材費（税込）<input data-profit="packagingCost" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(inputValue(record, 'packagingCost', 20))}"></label>
        <label>ネコポス契約運賃（税込）<input data-profit="nekoposFee" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(inputValue(record, 'nekoposFee'))}" placeholder="契約額を入力"></label>
        <label>販売手数料率を上書き（%）<input data-profit="manualReferralRate" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${escapeHtml(inputValue(record, 'manualReferralRate'))}" placeholder="公式区分で自動計算"></label>
        <label>Amazon出品プラン<select data-profit="sellingPlan"><option value="professional" ${inputValue(record, 'sellingPlan', 'professional') === 'professional' ? 'selected' : ''}>大口（月額は別）</option><option value="individual" ${inputValue(record, 'sellingPlan', 'professional') === 'individual' ? 'selected' : ''}>小口（1点110円税込）</option></select></label>
      </div>
      <div class="profit-results" data-profit-results>${profitResult(item, 'clickpost', record)}${profitResult(item, 'nekopos', record)}</div>
      <p class="profit-note">${escapeHtml(offerNote)} 仕入送料は同一店舗でまとめ買いし、送料無料条件を満たす前提で初期値0円です。仕入先の単品注文時送料は参考表示で、利益には入れていません。送料無料条件を満たせない場合は上の仕入送料欄を変更してください。利益＝出品価格＋購入者送料−付与ポイント−仕入価格−入力した仕入送料−発送運賃−梱包資材−Amazon自己発送手数料。FBA配送代行手数料は引いていません。ネコポスは入力した契約運賃を発送費として引きます。価格がSP-API照会時と同じ場合はこのアカウントの自己発送手数料見積もりを使い、消費税10%を加算します。変更時は<a href="https://sell.amazon.co.jp/pricing" target="_blank" rel="noopener noreferrer">公式料率 ↗</a>から概算。大口の月額、広告・返品費用、仕入税額控除は含めません。実際の販売価格・出品カテゴリー・在庫は再確認してください。</p>
    </section>`;
  }

  function thicknessGauge(values, actual) {
    const low = Math.max(0, Number(Array.isArray(values) ? values[0] : values) || 0);
    const high = Math.max(low, Number(Array.isArray(values) ? values[1] : values) || 0);
    const max = Math.max(4, Math.ceil(high + 0.5));
    const bottom = 354;
    const scale = 315 / max;
    const yFor = cm => bottom - cm * scale;
    const ticks = Array.from({ length: Math.round(max * 10) + 1 }, (_, index) => {
      const cm = index / 10;
      const y = yFor(cm).toFixed(2);
      const half = index % 5 === 0;
      const label = index % 10 === 0
        ? `<text x="274" y="${Number(y) + 4}" class="gauge-tick-label">${cm.toFixed(0)}</text>`
        : '';
      return `<line x1="242" y1="${y}" x2="${half ? 267 : 257}" y2="${y}" class="${half ? 'gauge-major-tick' : 'gauge-minor-tick'}"/>${label}`;
    }).join('');
    const limitY = yFor(3).toFixed(2);
    const lowY = yFor(low).toFixed(2);
    const highY = yFor(high).toFixed(2);
    const tone = high > 3 ? 'over' : 'within';
    const result = actual
      ? high > 3 ? '入力値は3cmを超えています' : '入力値は3cm以内です'
      : low > 3 ? '計算上は3cmを超える見込み' : high > 3 ? '計算上は3cmを超える可能性' : '計算上は3cm以内の見込み';
    const amount = `${low.toFixed(1)}${low === high ? '' : `〜${high.toFixed(1)}`}cm`;
    const pouchTop = Math.max(43, Math.min(327, Number(highY)));
    const pouchMid = pouchTop + (bottom - pouchTop) * 0.43;
    return `<div class="thickness-gauge ${tone}" role="group" aria-label="${actual ? '入力された梱包後の実測最大厚' : '計算上の厚み'}${low.toFixed(1)}${low === high ? '' : `から${high.toFixed(1)}`}センチと3センチ上限の比較。図は実寸ではありません">
      <svg class="gauge-svg" viewBox="0 0 330 380" role="img" aria-label="袋の側面模式図と縦の定規。赤い破線が3センチ上限、${actual ? '入力実測値' : '計算値'}は${amount}。画面上の実寸ではありません">
        <defs><linearGradient id="pouch-side" x1="0" y1="0" x2="0.15" y2="1"><stop offset="0" stop-color="#f4f8fa"/><stop offset=".55" stop-color="#b4c1c7"/><stop offset="1" stop-color="#73828d"/></linearGradient><linearGradient id="mailer-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ead7b1"/><stop offset="1" stop-color="#c9ad7a"/></linearGradient></defs>
        <rect x="1" y="1" width="328" height="378" rx="15" class="gauge-stage"/>
        <rect x="13" y="14" width="52" height="24" rx="6" class="gauge-schematic-tag"/><text x="39" y="30" text-anchor="middle" class="gauge-schematic-label">模式図</text>
        <path d="M 11 352 Q 85 348 219 351 L 224 363 Q 112 369 11 363 Z" class="gauge-mailer"/>
        <path d="M 12 347 Q 9 ${pouchMid.toFixed(1)} 66 ${(pouchTop + 25).toFixed(1)} Q 128 ${(pouchTop - 10).toFixed(1)} 207 ${(pouchTop + 15).toFixed(1)} Q 231 ${(pouchTop + 26).toFixed(1)} 225 ${pouchMid.toFixed(1)} Q 228 338 211 346 Q 112 359 12 347 Z" class="gauge-pouch"/>
        <path d="M 21 ${(pouchMid + 6).toFixed(1)} Q 85 ${(pouchTop + 18).toFixed(1)} 199 ${(pouchTop + 27).toFixed(1)}" class="gauge-pouch-fold"/>
        <rect x="240" y="33" width="31" height="325" rx="3" class="gauge-body"/>
        ${ticks}
        <rect x="278" y="${highY}" width="11" height="${Math.max(3, Number(lowY)-Number(highY))}" rx="4" class="gauge-range"/>
        <line x1="10" y1="${limitY}" x2="318" y2="${limitY}" class="gauge-limit-line"/>
        <text x="318" y="${Number(limitY)-8}" text-anchor="end" class="gauge-limit-text">3cm 上限</text>
        <line x1="13" y1="${highY}" x2="221" y2="${highY}" class="gauge-value-line"/>
        <text x="12" y="372" class="gauge-bottom-note">袋と外装を重ねた側面イメージ</text>
      </svg>
      <div class="gauge-result"><strong>${result}</strong><span>${actual ? '入力された最大厚' : '厚みの目安'} ${amount}${actual ? '' : ' · 要実測'}</span></div>
      <p class="gauge-disclaimer">側面は模式図・画面上の実寸ではありません。${actual ? '入力値と測り方を再確認してください。' : '梱包後の最大厚は未測定です。'}</p>
    </div>`;
  }

  function packingVisual(item, prediction, fit, record, imageUrl) {
    const outer = fit.nekopos.projected;
    const measuredPouch = isMeasured(record, 'pouchWidth') && isMeasured(record, 'pouchHeight');
    const measuredThickness = isMeasured(record, 'thickness');
    const complete = fit.nekopos.fullyMeasured;
    const inputCount = measurementCount(record);
    const missingParcel = [['shipLength', '外装の長辺'], ['shipWidth', '外装の短辺'], ['thickness', '最大厚'], ['shipWeight', '重量']]
      .filter(([key]) => !isMeasured(record, key)).map(([, label]) => label);
    const knownPouch = measuredPouch || prediction.footprintSource === 'manufacturer';
    const pouch = measuredPouch ? [Number(record.pouchWidth), Number(record.pouchHeight)] : prediction.assumedPouchCm;
    const [pouchLong, pouchShort] = [...pouch].sort((a, b) => b - a);
    // This diagram is proportional to the cited numbers within the SVG only. It is never 1:1 on screen.
    const diagram = pouchLong > 0 && pouchShort > 0
      ? (() => {
          const chartLong = Math.max(outer.longMax, pouchLong);
          const chartShort = Math.max(outer.shortMax, pouchShort);
          const scale = Math.min(250 / chartLong, 170 / chartShort);
          const boxW = chartShort * scale;
          const boxH = chartLong * scale;
          const itemW = pouchShort * scale;
          const itemH = pouchLong * scale;
          const x = 165 - boxW / 2;
          const y = 128 - boxH / 2;
          const bagSource = measuredPouch ? '入力実測' : knownPouch ? 'メーカー公表' : '掲載値などから仮定';
          return `<svg class="footprint-svg" viewBox="0 0 330 380" role="img" aria-label="外装${outer.longMax}×${outer.shortMax}cmと商品袋${pouchLong}×${pouchShort}cmの数値比模式図。${bagSource}。画面上の実寸ではありません"><text x="165" y="34" text-anchor="middle" class="footprint-overline">外装の${fit.nekopos.measuredFootprint ? '入力実測' : '仮置き'} ${outer.longMax} × ${outer.shortMax} cm</text><line x1="${x}" y1="72" x2="${x+boxW}" y2="72" class="footprint-measure"/><text x="165" y="64" text-anchor="middle" class="footprint-number">${outer.shortMax} cm</text><rect x="${x}" y="91" width="${boxW}" height="${boxH}" rx="9" class="footprint-outer"/><rect x="${165-itemW/2}" y="${91+(boxH-itemH)/2}" width="${itemW}" height="${itemH}" rx="7" class="footprint-inner ${knownPouch ? '' : 'assumed'}"/><line x1="${x-12}" y1="91" x2="${x-12}" y2="${91+boxH}" class="footprint-measure"/><text x="${Math.max(15,x-22)}" y="${91+boxH/2}" text-anchor="middle" class="footprint-number" transform="rotate(-90 ${Math.max(15,x-22)} ${91+boxH/2})">${outer.longMax} cm</text><text x="165" y="${Math.min(369, 111+boxH)}" text-anchor="middle" class="footprint-label">商品袋 ${pouchLong} × ${pouchShort} cm</text><text x="165" y="${Math.min(385, 129+boxH)}" text-anchor="middle" class="footprint-overline">${bagSource}</text></svg>`;
        })()
      : `<div class="footprint-unknown"><strong>商品袋の平置き寸法は未確認</strong><span>掲載された商品・梱包寸法は、平らにした袋の実測値として描きません。</span></div>`;
    const photo = imageUrl ? `<img class="packing-product-photo" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}の商品写真。縮尺なし" loading="eager" decoding="async"><span class="pack-image-fallback" hidden>商品写真を表示できません</span>` : '<span class="photo-empty">商品写真なし</span>';
    const thicknessPanel = thicknessGauge(measuredThickness ? Number(record.thickness) : prediction.roughThicknessCm, measuredThickness);
    const instruction = prediction.material === '液体詰め替え' ? '1袋を平置きし、注ぎ口・シール・膨らみを含む最大厚を測る。' : '1袋を平置きし、粒・粉を均等に広げ、硬い部分・マチを含む最大厚を測る。';
    return `<section class="packing-visual" aria-label="商品写真と寸法の根拠">
      <div class="visual-heading"><span class="visual-maker">ASIN : ${item.asin}</span><h1 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h1><p>${escapeHtml(item.category)} · ${escapeHtml(prediction.material)} · 単品 <a href="https://www.amazon.co.jp/dp/${item.asin}" target="_blank" rel="noopener noreferrer">商品ページ ↗</a></p></div>
      <div class="evidence-alert"><b>${complete ? '梱包後の外寸・重量を入力済み' : inputCount ? `実測入力 ${inputCount}/6項目を反映` : '発送可否は未確定'}</b><span>${complete ? '登録した外寸・最大厚・重量を下の規格と照合してください。' : inputCount ? `未測定：${missingParcel.join('・') || '外装の確認'}。入力済みの値は実測として表示しています。` : '画面上の画像は実寸大ではありません。梱包した現物の外寸・最大厚・重量を測ってください。'}</span></div>
      <div class="packing-layout">
        <div class="evidence-panel"><div class="evidence-title"><i>1</i><b>商品写真</b></div><p class="evidence-intro">商品全体がわかる写真です。画面上の大きさは実物のサイズではありません。</p><div class="product-photo-stage">${photo}</div><p class="scene-caption">縮尺なし・全体表示。写真から厚みは測れません。</p></div>
        <div class="evidence-panel"><div class="evidence-title"><i>2</i><b>縦横の模式図</b></div><p class="evidence-intro">外装と商品袋の寸法を数値比で比較します。画面上の実寸ではありません。</p>${!knownPouch ? '<div class="evidence-caution">商品袋の実測なし。描いた形は寸法値からの仮定です。</div>' : ''}<div class="footprint-stage">${diagram}</div><p class="scene-caption">${knownPouch ? `${measuredPouch ? '入力実測' : 'メーカー公表'}の袋寸法を使用。平置き後の形状は未確認。` : '商品袋の形・平置き寸法・外装余白は未確認です。'}</p></div>
        <div class="evidence-panel"><div class="evidence-title"><i>3</i><b>3cm定規での厚み確認</b></div><p class="evidence-intro">袋と外装の側面を模式図にし、${measuredThickness ? '入力された実測値' : '計算上の厚みの目安'}を3cmの線と比べます。</p>${thicknessPanel}</div>
      </div>
      <div class="size-callout"><div class="size-callout-main"><span class="size-status">${complete ? '実測' : inputCount ? '一部実測' : '仮定'}</span><strong>発送用外装 ${complete ? '入力された実測値' : inputCount ? '実測値と想定値を区別' : '計算上の仮置き'}</strong><div class="size-values"><b>${outer.longMax}</b><em>×</em><b>${outer.shortMax}</b><em>×</em><b>${outer.thicknessMax}</b><small>cm</small></div><div class="size-sources"><span>長辺：${fit.nekopos.measuredFootprint ? '実測' : '想定'}</span><span>短辺：${fit.nekopos.measuredFootprint ? '実測' : '想定'}</span><span>最大厚：${measuredThickness ? '実測' : '推定'}</span></div></div><p>${complete ? '入力した実測値です。梱包状態と測り方を再確認してください。' : inputCount ? `未測定：${missingParcel.join('・') || '外装の確認'}。発送可否は未確定です。` : '未測定の項目に予測値を使用。厚みの数値は最大厚の保証ではありません。'}</p></div>
      <div class="packing-instructions"><b>実測の手順</b><span>① ${instruction}</span><span>② 実際に使う外装に入れ、封をする。</span><span>③ 長辺・短辺・最大厚・重量を測り、詳細に入力する。</span></div>
    </section>`;
  }

  function card(item) {
    const prediction = predictions[item.asin];
    const record = recordFor(item.asin);
    const imageUrl = imageFor(item.asin);
    const api = apiDimensions[item.asin] || {};
    const fit = fitFor(item);
    const inputCount = measurementCount(record);
    const bothFit = fit.nekopos.status === 'measured_ok' && fit.clickpost.status === 'measured_ok';
    const anyOver = fit.nekopos.status === 'over' || fit.clickpost.status === 'over';
    const missingParcel = [['shipLength', '外装の長辺'], ['shipWidth', '外装の短辺'], ['thickness', '最大厚'], ['shipWeight', '重量']]
      .filter(([key]) => !isMeasured(record, key)).map(([, label]) => label);
    const outcomeDetail = bothFit ? '入力された実測値は規格の数値条件内です。梱包状態と測り方を再確認してください。' : anyOver ? '判定理由と実測値を確認してください。' : `発送可否は未確定。未測定：${missingParcel.join('・') || '梱包状態の確認'}。`;
    const amazonUrl = `https://www.amazon.co.jp/dp/${item.asin}`;
    const keepaUrl = `https://keepa.com/#!product/5-${item.asin}`;
    const graphUrl = `https://graph.keepa.com/pricehistory.png?asin=${item.asin}&domain=co.jp`;
    const range = prediction.roughThicknessCm;
    const hasMeasuredWidth = Number(record.pouchWidth) > 0;
    const hasMeasuredLength = Number(record.pouchHeight) > 0;
    const hasMeasuredPouch = hasMeasuredWidth && hasMeasuredLength;
    const pouchWidth = hasMeasuredWidth ? record.pouchWidth : prediction.assumedPouchCm[0];
    const pouchLength = hasMeasuredLength ? record.pouchHeight : prediction.assumedPouchCm[1];
    const meterStart = Math.max(0, Math.min(98, range[0] / 5 * 100));
    const meterEnd = Math.max(meterStart + 2, Math.min(100, range[1] / 5 * 100));
    const measuredThickness = Number(record.thickness);
    const hasMeasuredThickness = record.thickness !== '' && record.thickness != null && measuredThickness > 0;
    const meterPoint = Math.max(0, Math.min(100, measuredThickness / 5 * 100));
    const thicknessText = hasMeasuredThickness ? escapeHtml(record.thickness) : `${range[0].toFixed(1)}〜${range[1].toFixed(1)}`;
    const pouchSource = footprintLabels[prediction.footprintSource] || '寸法は仮定';
    const sourceTone = prediction.footprintSource === 'manufacturer' ? 'known' : 'assumed';
    const formatApi = dims => dims ? escapeHtml(dimensionText(dims)) : '寸法なし';
    const sourceRows = [
      sourceRow('メーカー', prediction.footprintSource === 'manufacturer' ? '同一商品の個装寸法を採用（平置き寸法ではない）' : '同一商品の袋寸法は未確認', prediction.footprintSource === 'manufacturer' ? 'source-known' : 'source-muted'),
      sourceRow('Amazon掲載', item.listedDimensions ? `${escapeHtml(item.dimensionType || '種別不明')} ${escapeHtml(item.listedDimensions)}` : '3辺寸法なし', item.listedDimensions ? '' : 'source-muted'),
      sourceRow('Keepa商品', formatApi(api.keepa?.item), api.keepa?.item ? '' : 'source-muted'),
      sourceRow('Keepa包装', formatApi(api.keepa?.package), api.keepa?.package ? '' : 'source-muted'),
    ].join('');
    const thicknessMethod = prediction.thicknessModel === 'liquid_volume'
      ? '液体の表示容量を袋の有効面積に広げ、薄い外装分を加算。'
      : prediction.thicknessModel === 'special_case'
        ? escapeHtml(prediction.specialReason || '内袋や硬い部分の影響を考慮して計算範囲を補正。')
        : `内容量を仮定したかさ密度と袋の有効面積 ${escapeHtml(prediction.usableAreaCm2)}cm² で割り、外装分を加算。`;
    const photo = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}の商品画像" loading="lazy" decoding="async"><span class="product-photo-fallback" hidden>画像を表示できません</span>`
      : '<span class="product-photo-fallback">画像未取得</span>';
    const quickSupplier = suppliersFor(item.asin)[0];
    const quickBreakdown = quickBreakdownFor(item, record);
    return `<article class="card detail-card" data-asin="${item.asin}">
      ${packingVisual(item, prediction, fit, record, imageUrl)}
      <aside class="decision-rail" aria-label="商品の判定と概算利益">
        <section class="decision-fit"><span class="rail-eyebrow">配送サイズ判定 <small>${fit.nekopos.fullyMeasured ? '実測' : inputCount ? '一部実測' : '予測'}</small></span>${shippingRow('ネコポス', fit.nekopos, record)}${shippingRow('クリックポスト', fit.clickpost, record)}</section>
        <section class="decision-profit"><div class="profit-title"><span class="yen-mark">¥</span><span class="rail-eyebrow">仕入・利益</span><a href="#profit-editor">編集する</a></div>${quickBreakdown}<div data-quick-profit>${profitResult(item, 'clickpost', record)}</div><small>${quickSupplier ? `仕入先：<a href="${escapeHtml(quickSupplier.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(quickSupplier.name)} ↗</a> · ${escapeHtml(quickSupplier.checkedOn)}確認` : '仕入価格は未確認です。詳細で入力できます。'}</small></section>
        <p class="decision-warning">${outcomeDetail}</p>
      </aside>
      <details class="advanced"><summary>利益の内訳・実測入力・判定根拠を見る <span>実測値を入力できます</span></summary><div class="advanced-body">
      <div class="product-main">
        <div class="product-photo-panel">
          <a class="product-photo" href="${amazonUrl}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)}をAmazonで開く">${photo}</a>
          <h3 class="title"><a href="${amazonUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
          <div class="card-top"><span class="pill">${escapeHtml(item.category)}</span><span class="asin">${item.asin}</span></div>
          <div class="product-actions"><a href="${amazonUrl}" target="_blank" rel="noopener noreferrer">Amazonで見る ↗</a><a href="${keepaUrl}" target="_blank" rel="noopener noreferrer">Keepaで見る ↗</a></div>
        </div>
        <div class="product-copy ${bothFit ? 'likely' : anyOver ? 'unlikely' : 'borderline'}">
          <span class="outcome-icon ${bothFit ? 'is-good' : anyOver ? 'is-bad' : 'is-check'}" aria-hidden="true">${bothFit ? '✓' : anyOver ? '×' : '?'}</span>
          <div class="outcome-content"><span class="outcome-eyebrow">配送規格との照合</span><div class="outcome-services"><span>ネコポス <b class="${shippingClasses[fit.nekopos.status]}">${shippingLabelFor(fit.nekopos, record)}</b></span><span>クリックポスト <b class="${shippingClasses[fit.clickpost.status]}">${shippingLabelFor(fit.clickpost, record)}</b></span></div><p>${outcomeDetail}</p></div>
        </div>
      </div>
      <div class="estimate">
        <div class="estimate-head"><span class="estimate-label">サイズの結論</span><small>${inputCount ? '未測定部分の推定確信度' : '推定の確信度'}：${prediction.confidence}</small></div>
        <div class="dimension-summary" aria-label="商品袋の幅・長さと梱包時の厚さ">
          <div class="dimension-item"><span>${hasMeasuredWidth || sourceTone === 'known' ? '商品袋の幅' : '袋幅の仮定'}</span><strong>${escapeHtml(pouchWidth)}<em>cm</em></strong><small class="source-state ${hasMeasuredWidth ? 'known' : sourceTone}">${hasMeasuredWidth ? '実測' : escapeHtml(pouchSource)}</small></div>
          <div class="dimension-item"><span>${hasMeasuredLength || sourceTone === 'known' ? '商品袋の長さ' : '袋長の仮定'}</span><strong>${escapeHtml(pouchLength)}<em>cm</em></strong><small class="source-state ${hasMeasuredLength ? 'known' : sourceTone}">${hasMeasuredLength ? '実測' : escapeHtml(pouchSource)}</small></div>
          <div class="dimension-item"><span>${hasMeasuredThickness ? '梱包後の最大厚' : '梱包時の推定厚さ'}</span><strong>${thicknessText}<em>cm</em></strong><small class="source-state ${hasMeasuredThickness ? 'known' : 'assumed'}">${hasMeasuredThickness ? '実測' : '推定'}</small></div>
        </div>
        ${hasMeasuredWidth !== hasMeasuredLength ? '<small class="partial-note">袋の幅と長さは両方測ると発送判定に反映されます。</small>' : ''}
        <div class="thickness-meter" role="img" aria-label="${hasMeasuredThickness ? `入力した最大厚は${measuredThickness}センチ` : `厚さの推定範囲は約${range[0].toFixed(1)}から${range[1].toFixed(1)}センチ`}、基準は3センチ">
          ${hasMeasuredThickness ? `<span class="thickness-meter-point" style="left:${meterPoint}%"></span>` : `<span class="thickness-meter-range ${prediction.verdict}" style="left:${meterStart}%;width:${Math.max(2, meterEnd - meterStart)}%"></span>`}
          <span class="thickness-meter-limit"></span>
        </div>
        <div class="thickness-meter-labels"><span>0cm</span><span>3cmの目安</span><span>5cm</span></div>
        <div class="parcel-summary"><div class="parcel-heading"><span>発送用外装の寸法</span><small>商品袋とは別の寸法</small></div><div class="parcel-measures"><div><span>長辺 ${fit.nekopos.measuredFootprint ? '・実測' : '・想定'}</span><strong>${fit.nekopos.projected.longMax}<em>cm</em></strong></div><div><span>短辺 ${fit.nekopos.measuredFootprint ? '・実測' : '・想定'}</span><strong>${fit.nekopos.projected.shortMax}<em>cm</em></strong></div><div><span>最大厚 ${hasMeasuredThickness ? '・実測' : '・推定'}</span><strong>${fit.nekopos.projected.thicknessMax}<em>cm</em></strong></div><div><span>${isMeasured(record, 'shipWeight') ? '重量・実測' : '重量・目安'}</span><strong>${fit.nekopos.projected.weightMin}${isMeasured(record, 'shipWeight') ? '' : `〜${fit.nekopos.projected.weightMax}`}<em>g</em></strong></div></div></div>
        <div class="shipping-results" aria-label="発送方法別の推定判定">
          ${shippingRow('ネコポス', fit.nekopos, record)}
          ${shippingRow('クリックポスト', fit.clickpost, record)}
        </div>
        ${item.caution ? `<div class="caution">補足：${escapeHtml(item.caution)}</div>` : ''}
      </div>
      <div class="card-details">
        <section class="card-section evidence" aria-label="推定の根拠と仮説"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 14c-1.4-1.2-2-2.5-2-4a6 6 0 0 1 12 0c0 1.5-.6 2.8-2 4-.8.7-1 1.5-1 2h-6c0-.5-.2-1.3-1-2Z"/></svg>推定の根拠と仮説</h4>
          <ul class="evidence-steps">
            <li><b>商品袋の幅と長さ <span class="source-state ${hasMeasuredPouch || sourceTone === 'known' ? 'known' : 'assumed'}">${hasMeasuredPouch ? '実測' : sourceTone === 'known' ? 'メーカー公表' : '仮定'}</span></b><span>${hasMeasuredPouch ? '入力した袋寸法を発送判定に反映。' : escapeHtml(prediction.geometryNote)}</span></li>
            <li><b>内容量と素材 <span class="source-state assumed">${prediction.material === '液体詰め替え' ? '掲載容量を使用' : 'かさ密度は仮定'}</span></b><span>${escapeHtml(prediction.amountText || `${prediction.massG}g`)}の${escapeHtml(prediction.material)}。${prediction.thicknessModel === 'liquid_volume' || prediction.material === '液体詰め替え' ? '液体は表示容量を体積として扱います。' : `かさ密度は ${prediction.densityRangeGml[0]}〜${prediction.densityRangeGml[1]}g/mL の目安。`}</span></li>
            <li><b>${hasMeasuredThickness ? '梱包後の最大厚' : '厚さの計算'} <span class="source-state ${hasMeasuredThickness ? 'known' : 'assumed'}">${hasMeasuredThickness ? '実測' : '推定'}</span></b><span>${hasMeasuredThickness ? `入力値 ${escapeHtml(record.thickness)}cmを判定に優先。計算上の厚みは測定前の参考値です。` : thicknessMethod}</span></li>
            <li><b>発送用外装で判定 <span class="source-state ${fit.nekopos.fullyMeasured ? 'known' : 'assumed'}">${fit.nekopos.fullyMeasured ? '実測' : '想定'}</span></b><span>${fit.nekopos.fullyMeasured ? '外装の3辺と重量を入力値で照合。' : '外装の余白と梱包材を見込み、各配送方法の条件と照合。'}</span></li>
          </ul>
          <div class="evidence-warning">${hasMeasuredPouch ? '商品袋の縦横は入力実測値です。外装の縦横・最大厚・重量はそれぞれの入力欄で確認してください。' : prediction.footprintSource === 'manufacturer' ? '袋の縦横はメーカー公表。厚さと外装は現物で確認。' : '袋の縦横は未実測。発送可否は現物で確認。'}</div>
          <div class="source-links">${prediction.sources.map(sourceLink).join('')}</div>
        </section>
        <div class="card-side">
          <section class="card-section keepa" aria-label="Keepaの価格推移"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18M6 16l5-5 4 3 5-7"/></svg>Keepaの価格推移</h4>
            <div class="keepa-graph"><img src="${graphUrl}" alt="${escapeHtml(item.title)}のKeepa価格履歴" loading="lazy" decoding="async"><p class="graph-fallback" hidden>グラフを表示できませんでした。<a href="${keepaUrl}" target="_blank" rel="noopener noreferrer">Keepaで確認 ↗</a></p></div>
            <small>価格履歴は厚さの根拠ではありません。<a href="${keepaUrl}" target="_blank" rel="noopener noreferrer">Keepaで開く ↗</a></small>
          </section>
          <section class="card-section api-dimensions" aria-label="寸法の情報源"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>寸法の情報源</h4>
            <div class="source-rows">${sourceRows}</div>
            <small>比較用の掲載値です。「包装」は今回の発送用外装の実測値ではありません。</small>
          </section>
          <section class="card-section measurement" aria-label="実物の寸法を記録"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7 7 3l14 14-4 4L3 7Zm5-1-2 2m6 2-2 2m6 2-2 2"/></svg>実物の寸法を記録</h4>
            <div class="measurement-fields">
              <label>商品袋の幅 cm<input data-measure="pouchWidth" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.pouchWidth)}" placeholder="例 15"></label>
              <label>商品袋の長さ cm<input data-measure="pouchHeight" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.pouchHeight)}" placeholder="例 24"></label>
              <label>外装の長辺 cm<input data-measure="shipLength" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.shipLength)}" placeholder="例 26"></label>
              <label>外装の短辺 cm<input data-measure="shipWidth" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.shipWidth)}" placeholder="例 18"></label>
              <label>梱包後の最大厚 cm<input data-measure="thickness" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.thickness)}" placeholder="例 2.8"></label>
              <label>梱包後の重量 g<input data-measure="shipWeight" type="number" min="0" max="9999" step="1" inputmode="decimal" value="${escapeHtml(record.shipWeight)}" placeholder="例 240"></label>
            </div>
            <p>入力済みの項目は実測として反映します。発送可否の確定には、外装の長辺・短辺・最大厚・重量をすべて測ってください。このブラウザに保存します。</p>
          </section>
        </div>
      </div>
      <div id="profit-editor">${profitPanel(item, record)}</div>
      </div></details>
    </article>`;
  }

  function candidateRow(item) {
    const prediction = predictions[item.asin];
    const record = recordFor(item.asin);
    const demo = demoFor(item.asin);
    const trial = trialByAsin.get(item.asin);
    const fit = fitFor(item);
    const imageUrl = imageFor(item.asin);
    const width = Number(record.pouchWidth) > 0 ? record.pouchWidth : prediction.assumedPouchCm[0];
    const length = Number(record.pouchHeight) > 0 ? record.pouchHeight : prediction.assumedPouchCm[1];
    const thickness = Number(record.thickness) > 0 ? record.thickness : prediction.roughThicknessCm.map(n => n.toFixed(1)).join('〜');
    const listTitle = item.asin === 'B09S3BRQJ1' ? 'AGF マキシム 袋 60g' : item.title;
    const profit = profitFor(item, 'clickpost', record);
    const state = profitStateFor(item, record);
    const supplier = suppliersFor(item.asin)[0];
    const sourceBuy = inputValue(record, 'buyPrice', supplier?.priceYen ?? '');
    const sourceInbound = inputValue(record, 'buyShipping', 0);
    const sourceTotal = supplier && sourceBuy !== '' && sourceInbound !== '' ? Number(sourceBuy) + Number(sourceInbound) : null;
    const ceiling = state === 'sourcing' ? purchaseCeilingFor(item, record) : null;
    const profitText = state === 'candidate' ? `+${yen(profit.profit)} · 要実測`
      : state === 'reference' && profit ? `参考 ${profit.profit < 0 ? '−' : '+'}${yen(Math.abs(profit.profit))}`
        : state === 'price_risk' && profit ? `価格差あり +${yen(profit.profit)}`
          : state === 'loss' && profit ? `−${yen(Math.abs(profit.profit))}`
            : state === 'over' ? '配送規格外'
              : ceiling != null && ceiling >= 0 ? `仕入上限 ${yen(ceiling)}` : '売価未取得';
    const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async"><span class="candidate-photo-fallback" hidden>画像なし</span>` : '<span class="candidate-photo-fallback">画像なし</span>';
    const trialThickness = isMeasured(record, 'thickness') ? Number(record.thickness) : null;
    const trialThicknessText = trialThickness === null ? '厚さ未入力' : trialThickness > 3 ? `最大厚 ${trialThickness}cm · 3cm超` : trialThickness === 3 ? '最大厚 3cm · 境界' : `最大厚 ${trialThickness}cm · 3cm以下`;
    const trialThicknessClass = trialThickness === null ? '' : trialThickness > 3 ? 'over' : trialThickness === 3 ? 'edge' : 'within';
    return `<button class="candidate-row ${selectedAsin === item.asin ? 'is-selected' : ''}" type="button" data-select-asin="${item.asin}" aria-pressed="${selectedAsin === item.asin}">
      <span class="candidate-thumb">${image}</span>
      <span class="candidate-ident"><strong title="${escapeHtml(item.title)}">${escapeHtml(listTitle)}</strong><small>${item.asin} · ${escapeHtml(item.category)}</small>${trialOnly && trial ? `<span class="trial-row-badge ${trialThicknessClass}">${trial.order + 1}/10 · ${trialThicknessText} · ${measurementCount(record)}/6項目 · 画像参考 ${yen(trial.referencePriceYen)}</span>` : measurementCount(record) ? `<span class="real-row-badge">実測入力 ${measurementCount(record)}/6項目${hasRealMeasurements(record) ? ' · 外装の判定値が揃いました' : ''}</span>` : demo ? `<span class="demo-row-badge ${demoWithin3Cm(demo) ? 'within' : 'over'}">表示例 · ${demoWithin3Cm(demo) ? '3cm以内' : '3cm超'}</span>` : ''}<small class="candidate-profit ${state === 'price_risk' ? 'price-risk' : state}">${profitText}</small></span>
      <span class="candidate-measures">${Number(record.pouchWidth) > 0 && Number(record.pouchHeight) > 0 || prediction.footprintSource === 'manufacturer' ? '袋' : '仮の袋面'} ${escapeHtml(width)}×${escapeHtml(length)} cm <span>厚さ ${escapeHtml(thickness)} cm</span></span>
      <span class="candidate-source ${supplier ? '' : 'unconfirmed'}" title="${supplier ? `仕入先 ${escapeHtml(supplier.name)}・仕入送料${sourceInbound === '' ? '未入力' : yen(Number(sourceInbound))}で試算` : '仕入先の単品価格は未確認'}">${supplier ? `${supplierBadge(supplier)}<span class="candidate-source-text">${escapeHtml(supplierDisplayName(supplier))} · ${sourceTotal == null ? '仕入額未入力' : yen(sourceTotal)}</span>` : '仕入先 未確認'}</span>
      <span class="candidate-verdict"><span class="pill ${shippingClasses[fit.nekopos.status]}"><b>ネコポス</b> ${shippingLabelFor(fit.nekopos, record)}</span><span class="pill ${shippingClasses[fit.clickpost.status]}"><b>クリックポスト</b> ${shippingLabelFor(fit.clickpost, record)}</span></span>
    </button>`;
  }

  function profitSpotlight(item) {
    const record = recordFor(item.asin);
    const state = profitStateFor(item, record);
    const result = profitFor(item, 'clickpost', record);
    const sale = saleInputsFor(item, record);
    const ceiling = purchaseCeilingFor(item, record);
    const label = state === 'candidate' ? '黒字候補 · 送料無料条件と厚さ・重量は要確認'
      : state === 'reference' ? (sale.basis === 'mfn' ? '参考試算 · おすすめ出品未確認' : '参考試算 · 自己発送の実売価格は未確認')
        : state === 'price_risk' ? '価格差あり · おすすめ出品より高い'
          : state === 'sourcing' ? '仕入先の単品価格を確認してください'
            : state === 'price_missing' ? 'Amazonの売価・購入者送料が未取得'
            : state === 'over' ? 'クリックポスト規格外' : '現在の条件では赤字';
    const detail = result ? `売価${yen(Number(sale.listing) + Number(sale.shipping))} · 仕入総額${yen(result.buy + result.inbound)} · 送料・手数料込み`
      : ceiling != null && ceiling >= 0 ? `仕入価格の収支ゼロ上限 ${yen(ceiling)}（仕入送料0円の仮定）` : '確認できた価格だけで計算しています';
    const amount = result ? `${result.profit < 0 ? '−' : '+'}${yen(Math.abs(result.profit))}`
      : ceiling != null && ceiling >= 0 ? `上限 ${yen(ceiling)}` : '売価未取得';
    return `<div class="profit-spotlight ${state === 'reference' ? 'is-reference' : state === 'sourcing' || state === 'price_missing' ? 'is-missing' : ''}" aria-label="選択商品の利益状況"><div><small>${label}</small><b title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</b><small>${detail}</small></div><strong>${amount}</strong></div>`;
  }

  function supplierQuick(item) {
    const supplier = suppliersFor(item.asin)[0];
    const record = recordFor(item.asin);
    if (!supplier) {
      const ceiling = purchaseCeilingFor(item, record);
      return `<section class="supplier-quick is-unconfirmed" aria-label="仕入先の要約"><span class="supplier-quick-label">仕入先</span><strong class="supplier-quick-name">未確認</strong><strong class="supplier-quick-cost">${ceiling == null ? '利益未計算' : ceiling >= 0 ? `仕入上限 ${yen(ceiling)}` : '現行売価では採算不可'}</strong><small class="supplier-quick-meta">単品価格が分かれば仕入送料0円の仮定で計算できます</small></section>`;
    }
    const buyPrice = inputValue(record, 'buyPrice', supplier.priceYen);
    const buyShipping = inputValue(record, 'buyShipping', 0);
    const total = buyPrice === '' || buyShipping === '' ? null : Number(buyPrice) + Number(buyShipping);
    const identity = /^JAN \d{13}/.test(supplier.identity || '') ? 'JAN照合' : '商品名・容量照合';
    const edited = record.buyPrice != null || record.buyShipping != null;
    return `<section class="supplier-quick" aria-label="仕入先の要約"><span class="supplier-quick-label">仕入先</span><a class="supplier-quick-name" href="${escapeHtml(supplier.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(supplier.name)}">${supplierBadge(supplier)}<span class="supplier-store-name">${escapeHtml(supplierDisplayName(supplier))} ↗</span></a><strong class="supplier-quick-cost">${total == null ? '入力待ち' : yen(total)}<small>${total == null ? '仕入額は未入力' : '利益計算上の仕入額・1点'}</small></strong><span class="supplier-quick-meta">商品 ${yen(supplier.priceYen)} · 利益計算の仕入送料 ${yen(Number(buyShipping) || 0)}<br>単品注文時の表示送料 ${supplier.inboundShippingYen == null ? '未確認' : yen(supplier.inboundShippingYen)}（未計上） · ${identity} · ${escapeHtml(supplier.checkedOn)}確認${edited ? ' · 利益は入力値で再計算' : ''}</span></section>`;
  }

  function demoDetail(item) {
    const demo = demoFor(item.asin);
    if (trialOnly || !demo || measurementCount(recordFor(item.asin))) return '';
    const within = demoWithin3Cm(demo);
    const position = Math.min(100, demo.thickness / 5 * 100);
    return `<section class="demo-detail ${within ? 'within' : 'over'}" aria-label="仮入力した梱包サイズの表示例">
      <div class="demo-detail-heading"><div><span class="demo-detail-kicker">検証サンプル ${String(demo.order + 1).padStart(2, '0')} / 10</span><h2>仮入力した梱包後サイズ</h2></div><span class="demo-detail-status">${within ? '3cm基準内の例' : '3cm基準超の例'}</span></div>
      <div class="demo-detail-body"><div class="demo-detail-numbers"><strong>${demo.length}<small>長辺</small></strong><em>×</em><strong>${demo.width}<small>短辺</small></strong><em>×</em><strong class="demo-thickness">${demo.thickness.toFixed(1)}<small>最大厚</small></strong><span class="demo-unit">cm</span><span class="demo-weight">${demo.weight} g</span></div><div class="demo-ruler" aria-label="仮の最大厚${demo.thickness.toFixed(1)}cmと3cm線の比較"><div class="demo-ruler-track"><span class="demo-ruler-limit"></span><span class="demo-ruler-point" style="left:${position}%"></span></div><div class="demo-ruler-labels"><span>0</span><span>1</span><span>2</span><b>3cm</b><span>4</span><span>5</span></div></div></div>
      <p>表示の確認用に置いた数値です。購入・実測の事実ではなく、上の配送判定や利益計算にも使っていません。現物を梱包した後、詳細の実測欄に入力してください。</p>
    </section>`;
  }

  function trialDetail(item) {
    const trial = trialByAsin.get(item.asin);
    if (!trial || !trialOnly) return '';
    const record = recordFor(item.asin);
    const fields = [
      ['pouchWidth', '商品袋の幅', 'cm', '0.1'], ['pouchHeight', '商品袋の長さ', 'cm', '0.1'],
      ['shipLength', '外装の長辺', 'cm', '0.1'], ['shipWidth', '外装の短辺', 'cm', '0.1'],
      ['thickness', '梱包後の最大厚', 'cm', '0.1'], ['shipWeight', '梱包後の重量', 'g', '1'],
    ];
    return `<section class="trial-detail" data-asin="${item.asin}" aria-label="実測待ちリストの入力欄"><div class="trial-detail-head"><div><small>実測待ちリスト ${trial.order + 1} / ${trialProducts.length}</small><h2>${escapeHtml(item.title)}</h2></div><strong>${measurementCount(record)}/6項目入力</strong></div><p>画像の参考価格 ${yen(trial.referencePriceYen)}。購入・梱包の事実は登録していません。入力済みの値だけを実測として扱い、空欄は未測定です。数値を入れると、このブラウザに保存して下の判定へ反映します。</p><div class="trial-fields">${fields.map(([key, label, unit, step]) => `<label>${label} ${unit}<input data-measure="${key}" type="number" min="0" step="${step}" inputmode="decimal" value="${escapeHtml(record[key] ?? '')}" placeholder="未測定"></label>`).join('')}</div></section>`;
  }

  function render() {
    $('#demoSidebar').hidden = trialOnly;
    const advancedAsin = $('#featured .advanced[open]')?.closest('[data-asin]')?.dataset.asin;
    const matched = filteredProducts();
    if (!matched.some(item => item.asin === selectedAsin)) selectedAsin = matched[0]?.asin || '';
    const selected = matched.find(item => item.asin === selectedAsin);
    const visible = matched.slice(0, visibleLimit);
    if (selected && !visible.some(item => item.asin === selectedAsin)) visible.unshift(selected);
    $('#visibleCount').textContent = `${visible.length} / ${matched.length}件（${trialOnly ? '実測待ちリスト' : measuredOnly ? '実測入力あり' : demoOnly ? '検証用表示例' : $('#sortMode').value === 'profit' ? '利益順' : '発送見込み順'}）`;
    $('#list').innerHTML = visible.length ? visible.map(candidateRow).join('') : '<div class="empty">該当する候補がありません。検索・絞り込みを変更してください。</div>';
    $('#featured').innerHTML = selected ? trialDetail(selected) + demoDetail(selected) + profitSpotlight(selected) + supplierQuick(selected) + card(selected) : '<div class="empty">該当商品がありません。検索・絞り込みを変更してください。</div>';
    if (selected && advancedAsin === selected.asin) $('#featured .advanced').open = true;
    $('#more').hidden = visible.length >= matched.length;
  }

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

  function createCsv(items = sortedProducts()) {
    const header = ['ASIN', '商品名', '分類', '厚さ予測', '概算厚さ下限cm', '概算厚さ上限cm', '確信度', '理由', '計算に使った量', '中身', '仮定袋幅cm', '仮定袋長cm', '袋寸法の根拠', '袋寸法の根拠区分', 'メーカー公表の単品重量g', 'かさ密度下限g/mL', 'かさ密度上限g/mL', 'Amazon寸法確認', '掲載最小辺cm', '掲載寸法', '寸法種別', 'Keepa API商品寸法cm', 'Keepa APIパッケージ寸法cm', 'ネコポス判定', 'ネコポス理由', 'クリックポスト判定', 'クリックポスト理由', '外装の想定長辺上限cm', '外装の想定短辺上限cm', '想定3辺合計上限cm', '実測袋幅cm', '実測袋長cm', '実測外装長辺cm', '実測外装短辺cm', '実測最大厚cm', '実測梱包後重量g', '仕入先', '仕入先URL', '仕入先確認日', 'Amazon自己発送出品価格円', '購入者負担の配送料円', '付与ポイント数', '仕入価格円', '仕入先の単品注文時表示送料円', '利益計算に入れた仕入送料円', '梱包資材費円', 'クリックポスト概算利益円', 'ネコポス概算利益円', '利益区分', '売価の根拠', '仕入価格＋入力した仕入送料の収支ゼロ上限円', 'おすすめ出品の購入者総額円', 'おすすめ出品との価格差円', '補足', '出典URL'];
    const rows = items.map(item => {
      const p = predictions[item.asin];
      const record = recordFor(item.asin);
      const api = apiDimensions[item.asin] || {};
      const fit = fitFor(item);
      const apiCell = dims => Array.isArray(dims?.cm) ? dims.cm.join(' × ') : '';
      const supplier = suppliersFor(item.asin)[0];
      const sale = saleInputsFor(item, record);
      return [item.asin, item.title, item.category, verdictLabels[p.verdict], ...p.roughThicknessCm, p.confidence, p.reason, p.amountText || `${p.massG}g`, p.material, ...p.assumedPouchCm, p.geometryNote, p.footprintSource, p.manufacturerGrossWeightG, ...p.densityRangeGml, item.sizeConfirmed ? '3cm超' : '未確認', item.listedMinCm, item.listedDimensions, item.dimensionType, apiCell(api.keepa?.item), apiCell(api.keepa?.package), shippingLabels[fit.nekopos.status], fit.nekopos.reasons.join(' / '), shippingLabels[fit.clickpost.status], fit.clickpost.reasons.join(' / '), fit.nekopos.projected.longMax, fit.nekopos.projected.shortMax, fit.nekopos.projected.sumMax, record.pouchWidth, record.pouchHeight, record.shipLength, record.shipWidth, record.thickness, record.shipWeight, supplier?.name, supplier?.url, supplier?.checkedOn, sale.listing, sale.shipping, sale.points, inputValue(record, 'buyPrice', supplier?.priceYen ?? ''), supplier?.inboundShippingYen, inputValue(record, 'buyShipping', 0), inputValue(record, 'packagingCost', 20), fit.clickpost.status === 'over' ? '' : profitFor(item, 'clickpost', record)?.profit, fit.nekopos.status === 'over' ? '' : profitFor(item, 'nekopos', record)?.profit, profitStateFor(item, record), sale.basis, purchaseCeilingFor(item, record), market.offers?.[item.asin]?.featuredOffer?.landedYen, priceGapFor(item, record), item.caution, p.sources.join(' | ')];
    });
    return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function exportCsv(items = sortedProducts(), name = 'predictions') {
    const csv = '\ufeff' + createCsv(items);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nekopos-${items.length}asins-${name}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('#featured').addEventListener('input', event => {
    const profitField = event.target.dataset.profit;
    if (profitField) {
      const asin = event.target.closest('[data-asin]')?.dataset.asin;
      const item = products.find(product => product.asin === asin);
      if (!item) return;
      records[asin] = { ...recordFor(asin), [profitField]: event.target.value };
      saveRecords();
      renderStats();
      event.target.closest('[data-asin]').querySelector('[data-profit-results]').innerHTML = profitResult(item, 'clickpost', recordFor(asin)) + profitResult(item, 'nekopos', recordFor(asin));
      event.target.closest('[data-asin]').querySelector('[data-quick-profit]').innerHTML = profitResult(item, 'clickpost', recordFor(asin));
      event.target.closest('[data-asin]').querySelector('.decision-profit .profit-breakdown, .decision-profit .profit-empty').outerHTML = quickBreakdownFor(item, recordFor(asin));
      return;
    }
    const field = event.target.dataset.measure;
    const asin = event.target.closest('[data-asin]')?.dataset.asin;
    if (!field || !asin) return;
    records[asin] = { ...recordFor(asin), [field]: event.target.value };
    saveRecords();
  });
  $('#featured').addEventListener('change', event => {
    if (event.target.dataset.profit) {
      const asin = event.target.closest('[data-asin]')?.dataset.asin;
      const item = products.find(product => product.asin === asin);
      if (item) { renderStats(); render(); }
      return;
    }
    if (event.target.dataset.measure) { renderStats(); render(); }
  });
  $('#featured').addEventListener('error', event => {
    const image = event.target;
    if (!image.matches('.product-photo img, .decision-thumb img, .packing-product-photo, .keepa-graph img')) return;
    image.hidden = true;
    const fallback = image.parentElement.querySelector('.product-photo-fallback, .pack-image-fallback, .graph-fallback');
    if (fallback) fallback.hidden = false;
  }, true);
  $('#list').addEventListener('click', event => {
    const button = event.target.closest('[data-select-asin]');
    if (!button) return;
    selectedAsin = button.dataset.selectAsin;
    render();
    if (window.innerWidth <= 1300) $('#featured').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#list').addEventListener('error', event => {
    const image = event.target;
    if (!image.matches('.candidate-thumb img')) return;
    image.hidden = true;
    const fallback = image.parentElement.querySelector('.candidate-photo-fallback');
    if (fallback) fallback.hidden = false;
  }, true);
  ['search', 'category', 'dimension', 'forecast', 'shippingFilter'].forEach(id => {
    $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', () => { visibleLimit = 20; render(); });
  });
  function syncProfitButtons() {
    document.querySelectorAll('[data-profit-filter]').forEach(button => {
      const active = button.dataset.profitFilter === profitFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  document.querySelector('.profit-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-profit-filter]');
    if (!button) return;
    profitFilter = button.dataset.profitFilter;
    demoOnly = false;
    measuredOnly = false;
    trialOnly = false;
    syncDemoButton();
    syncMeasuredButton();
    syncTrialButton();
    visibleLimit = 20;
    syncProfitButtons();
    render();
  });
  function syncDemoButton() {
    $('#demoToggle').setAttribute('aria-pressed', String(demoOnly));
    $('#demoToggle').textContent = demoOnly ? '表示例を閉じる' : '10件の表示例を見る →';
  }
  function syncMeasuredButton() {
    $('#measuredToggle').setAttribute('aria-pressed', String(measuredOnly));
  }
  function syncTrialButton() {
    $('#trialToggle').setAttribute('aria-pressed', String(trialOnly));
    $('#trialToggle').textContent = trialOnly ? '実測待ちリストを閉じる' : 'この10商品を開く →';
  }
  $('#trialToggle').addEventListener('click', () => {
    trialOnly = !trialOnly;
    if (trialOnly) {
      demoOnly = false;
      measuredOnly = false;
      profitFilter = 'all';
      selectedAsin = trialProducts[0]?.asin || '';
      $('#search').value = '';
      $('#category').value = 'all';
      $('#dimension').value = 'all';
      $('#forecast').value = 'all';
      $('#shippingFilter').value = 'all';
    }
    visibleLimit = 20;
    syncProfitButtons();
    syncDemoButton();
    syncMeasuredButton();
    syncTrialButton();
    render();
  });
  $('#measuredToggle').addEventListener('click', () => {
    measuredOnly = !measuredOnly;
    if (measuredOnly) {
      demoOnly = false;
      trialOnly = false;
      profitFilter = 'all';
      $('#search').value = '';
      $('#category').value = 'all';
      $('#dimension').value = 'all';
      $('#forecast').value = 'all';
      $('#shippingFilter').value = 'all';
    }
    visibleLimit = 20;
    syncProfitButtons();
    syncDemoButton();
    syncMeasuredButton();
    syncTrialButton();
    render();
  });
  $('#demoToggle').addEventListener('click', () => {
    demoOnly = !demoOnly;
    if (demoOnly) {
      measuredOnly = false;
      trialOnly = false;
      profitFilter = 'all';
      $('#search').value = '';
      $('#category').value = 'all';
      $('#dimension').value = 'all';
      $('#forecast').value = 'all';
      $('#shippingFilter').value = 'all';
      selectedAsin = demoMeasurements[0]?.asin || '';
    }
    visibleLimit = 20;
    syncProfitButtons();
    syncDemoButton();
    syncMeasuredButton();
    syncTrialButton();
    render();
  });
  $('#sortMode').addEventListener('change', () => { visibleLimit = 20; render(); });
  document.querySelectorAll('[data-category-shortcut]').forEach(button => button.addEventListener('click', () => {
    const wanted = button.dataset.categoryShortcut;
    $('#category').value = [...$('#category').options].some(option => option.value === wanted) ? wanted : 'all';
    demoOnly = false;
    measuredOnly = false;
    syncDemoButton();
    syncMeasuredButton();
    document.querySelectorAll('[data-category-shortcut]').forEach(tab => tab.classList.toggle('active', tab === button));
    visibleLimit = 20;
    render();
  }));
  $('#featured').addEventListener('click', event => {
    if (!event.target.closest('a[href="#profit-editor"]')) return;
    $('#featured .advanced').open = true;
  });
  $('#more').addEventListener('click', () => { visibleLimit += 20; render(); });
  $('#searchGo').addEventListener('click', () => $('#candidates').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#export').addEventListener('click', () => {
    $('#csvText').value = createCsv();
    $('#csvDialog').showModal();
  });
  $('#closeCsv').addEventListener('click', () => $('#csvDialog').close());
  $('#saveCsv').addEventListener('click', () => exportCsv());
  $('#exportProfitCandidates').addEventListener('click', () => exportCsv(sortedProducts().filter(item => profitStateFor(item) === 'candidate'), 'profit-candidates'));
  $('#sideExport')?.addEventListener('click', () => $('#export').click());
  document.querySelector('.side-nav a[href="#method"]')?.addEventListener('click', () => { $('#method').open = true; });
  renderStats();
  syncProfitButtons();
  syncDemoButton();
  syncMeasuredButton();
  syncTrialButton();
  render();
})();
