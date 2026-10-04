(() => {
  'use strict';

  const products = window.NEKOPOST_PRODUCTS || [];
  const predictions = window.NEKOPOST_PREDICTIONS || {};
  const productImages = window.NEKOPOST_IMAGES?.images || {};
  const apiDimensions = window.NEKOPOST_API_DIMENSIONS?.items || {};
  const shipping = window.NEKOPOST_SHIPPING;
  const storageKey = 'nekopos-candidates-v1';
  let visibleLimit = 20;
  let selectedAsin = '';
  const verdictLabels = {
    likely: '3cm以内に収まりそう',
    borderline: '境界・情報不足',
    unlikely: '3cm以内は難しい',
  };
  const verdictOrder = { likely: 0, borderline: 1, unlikely: 2 };
  const shippingLabels = { possible: '概算で規格内', check: '要実測', over: '規格外', measured_ok: '実測で規格内' };
  const shippingClasses = { possible: 'likely', check: 'borderline', over: 'unlikely', measured_ok: 'likely' };
  const footprintLabels = { manufacturer: 'メーカー公表寸法', catalog_item: '登録商品寸法', catalog_package: '登録包装寸法から仮定', analogue: '同系品・画像から仮定' };
  const confidenceOrder = { 高: 0, 中: 1, 低: 2 };
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let records = {};
  try { records = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { records = {}; }
  const recordFor = asin => records[asin] || {};
  function saveRecords() {
    try { localStorage.setItem(storageKey, JSON.stringify(records)); }
    catch { alert('実測記録を保存できませんでした。CSVに書き出して控えてください。'); }
  }

  if (!products.length || !shipping || new Set(products.map(item => item.asin)).size !== products.length || products.some(item => !predictions[item.asin])) {
    $('#list').innerHTML = '<div class="empty">推定データを読み込めませんでした。ページを再読み込みしてください。</div>';
    return;
  }

  const requestedAsin = new URLSearchParams(window.location?.search || '').get('asin');
  if (requestedAsin && products.some(item => item.asin === requestedAsin)) {
    selectedAsin = requestedAsin;
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
      const pa = predictions[a.asin];
      const pb = predictions[b.asin];
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
    $('#csvTitle').textContent = `${products.length}件のCSV`;
    const fits = products.map(fitFor);
    $('#likelyCount').textContent = fits.filter(fit => isFit(fit.nekopos.status) && isFit(fit.clickpost.status)).length;
    $('#unlikelyCount').textContent = fits.filter(fit => fit.nekopos.status === 'over' && fit.clickpost.status === 'over').length;
    $('#borderlineCount').textContent = products.length - Number($('#likelyCount').textContent) - Number($('#unlikelyCount').textContent);
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

  function shippingRow(name, result) {
    const detail = result.reasons.find(reason => /超える|不足|未確認|投函目安|重量は未測定/.test(reason)) || result.reasons[0];
    const note = result.status === 'possible' ? '※概算。梱包後の外寸・重量を実測' : detail;
    return `<div class="shipping-row ${shippingClasses[result.status]}"><b>${name}</b><span class="pill ${shippingClasses[result.status]}">${shippingLabels[result.status]}</span><small>${escapeHtml(note)}</small></div>`;
  }

  function card(item) {
    const prediction = predictions[item.asin];
    const record = recordFor(item.asin);
    const imageUrl = productImages[item.asin];
    const api = apiDimensions[item.asin] || {};
    const fit = fitFor(item);
    const bothFit = isFit(fit.nekopos.status) && isFit(fit.clickpost.status);
    const anyOver = fit.nekopos.status === 'over' || fit.clickpost.status === 'over';
    const outcomeDetail = bothFit ? '※概算を含みます。発送前に梱包後の外寸・重量を実測してください。' : anyOver ? '判定理由と実測値を確認してください。' : '商品袋と梱包後の外寸・重量を測ると判定を更新できます。';
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
    const thicknessText = hasMeasuredThickness ? escapeHtml(record.thickness) : `${range[0].toFixed(1)}〜${range[1].toFixed(1)}`;
    const pouchSource = footprintLabels[prediction.footprintSource] || '寸法は仮定';
    const sourceTone = prediction.footprintSource === 'manufacturer' ? 'known' : 'assumed';
    const formatApi = dims => dims ? escapeHtml(dimensionText(dims)) : '寸法なし';
    const sourceRows = [
      sourceRow('メーカー', prediction.footprintSource === 'manufacturer' ? '商品袋の幅・長さを採用' : '同一商品の袋寸法は未確認', prediction.footprintSource === 'manufacturer' ? 'source-known' : 'source-muted'),
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
    return `<article class="card detail-card" data-asin="${item.asin}">
      <div class="product-main">
        <div class="product-photo-panel">
          <a class="product-photo" href="${amazonUrl}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)}をAmazonで開く">${photo}</a>
          <h3 class="title"><a href="${amazonUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
          <div class="card-top"><span class="pill">${escapeHtml(item.category)}</span><span class="asin">${item.asin}</span></div>
          <div class="product-actions"><a href="${amazonUrl}" target="_blank" rel="noopener noreferrer">Amazonで見る ↗</a><a href="${keepaUrl}" target="_blank" rel="noopener noreferrer">Keepaで見る ↗</a></div>
        </div>
        <div class="product-copy ${bothFit ? 'likely' : anyOver ? 'unlikely' : 'borderline'}">
          <span class="outcome-icon ${bothFit ? 'is-good' : anyOver ? 'is-bad' : 'is-check'}" aria-hidden="true">${bothFit ? '✓' : anyOver ? '×' : '?'}</span>
          <div class="outcome-content"><span class="outcome-eyebrow">配送規格との照合</span><div class="outcome-services"><span>ネコポス <b class="${shippingClasses[fit.nekopos.status]}">${shippingLabels[fit.nekopos.status]}</b></span><span>クリックポスト <b class="${shippingClasses[fit.clickpost.status]}">${shippingLabels[fit.clickpost.status]}</b></span></div><p>${outcomeDetail}</p></div>
        </div>
      </div>
      <div class="estimate">
        <div class="estimate-head"><span class="estimate-label">サイズの結論</span><small>根拠の確かさ：${prediction.confidence}</small></div>
        <div class="dimension-summary" aria-label="商品袋の幅・長さと梱包時の厚さ">
          <div class="dimension-item"><span>商品袋の幅</span><strong>${escapeHtml(pouchWidth)}<em>cm</em></strong><small class="source-state ${hasMeasuredWidth ? 'known' : sourceTone}">${hasMeasuredWidth ? '実測' : escapeHtml(pouchSource)}</small></div>
          <div class="dimension-item"><span>商品袋の長さ</span><strong>${escapeHtml(pouchLength)}<em>cm</em></strong><small class="source-state ${hasMeasuredLength ? 'known' : sourceTone}">${hasMeasuredLength ? '実測' : escapeHtml(pouchSource)}</small></div>
          <div class="dimension-item"><span>${hasMeasuredThickness ? '梱包後の最大厚' : '梱包時の推定厚さ'}</span><strong>${thicknessText}<em>cm</em></strong><small class="source-state ${hasMeasuredThickness ? 'known' : 'assumed'}">${hasMeasuredThickness ? '実測' : '推定'}</small></div>
        </div>
        ${hasMeasuredWidth !== hasMeasuredLength ? '<small class="partial-note">袋の幅と長さは両方測ると発送判定に反映されます。</small>' : ''}
        <div class="thickness-meter" role="img" aria-label="厚さの推定範囲は約${range[0].toFixed(1)}から${range[1].toFixed(1)}センチ、基準は3センチ">
          <span class="thickness-meter-range ${prediction.verdict}" style="left:${meterStart}%;width:${Math.max(2, meterEnd - meterStart)}%"></span>
          <span class="thickness-meter-limit"></span>
        </div>
        <div class="thickness-meter-labels"><span>0cm</span><span>3cmの目安</span><span>5cm</span></div>
        <div class="parcel-summary"><div class="parcel-heading"><span>${fit.nekopos.measuredFootprint ? '発送用外装の実測' : '発送用外装の想定'}</span><small>商品袋とは別の寸法</small></div><div class="parcel-measures"><div><span>長辺</span><strong>${fit.nekopos.projected.longMax}<em>cm</em></strong></div><div><span>短辺</span><strong>${fit.nekopos.projected.shortMax}<em>cm</em></strong></div><div><span>最大厚</span><strong>${fit.nekopos.projected.thicknessMax}<em>cm</em></strong></div><div><span>${record.shipWeight ? '実測重量' : '重量目安'}</span><strong>${fit.nekopos.projected.weightMin}〜${fit.nekopos.projected.weightMax}<em>g</em></strong></div></div></div>
        <div class="shipping-results" aria-label="発送方法別の推定判定">
          ${shippingRow('ネコポス', fit.nekopos)}
          ${shippingRow('クリックポスト', fit.clickpost)}
        </div>
        ${item.caution ? `<div class="caution">補足：${escapeHtml(item.caution)}</div>` : ''}
      </div>
      <div class="card-details">
        <section class="card-section evidence" aria-label="推定の根拠と仮説"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 14c-1.4-1.2-2-2.5-2-4a6 6 0 0 1 12 0c0 1.5-.6 2.8-2 4-.8.7-1 1.5-1 2h-6c0-.5-.2-1.3-1-2Z"/></svg>推定の根拠と仮説</h4>
          <ul class="evidence-steps">
            <li><b>商品袋の幅と長さ <span class="source-state ${hasMeasuredPouch || sourceTone === 'known' ? 'known' : 'assumed'}">${hasMeasuredPouch ? '実測' : sourceTone === 'known' ? 'メーカー公表' : '仮定'}</span></b><span>${hasMeasuredPouch ? '入力した袋寸法を発送判定に反映。' : escapeHtml(prediction.geometryNote)}</span></li>
            <li><b>内容量と素材 <span class="source-state assumed">${prediction.material === '液体詰め替え' ? '掲載容量を使用' : 'かさ密度は仮定'}</span></b><span>${escapeHtml(prediction.amountText || `${prediction.massG}g`)}の${escapeHtml(prediction.material)}。${prediction.thicknessModel === 'liquid_volume' || prediction.material === '液体詰め替え' ? '液体は表示容量を体積として扱います。' : `かさ密度は ${prediction.densityRangeGml[0]}〜${prediction.densityRangeGml[1]}g/mL の目安。`}</span></li>
            <li><b>厚さの計算 <span class="source-state assumed">推定</span></b><span>${thicknessMethod}</span></li>
            <li><b>発送用外装で判定 <span class="source-state ${fit.nekopos.fullyMeasured ? 'known' : 'assumed'}">${fit.nekopos.fullyMeasured ? '実測' : '想定'}</span></b><span>${fit.nekopos.fullyMeasured ? '外装の3辺と重量を入力値で照合。' : '外装の余白と梱包材を見込み、各配送方法の条件と照合。'}</span></li>
          </ul>
          <div class="evidence-warning">${prediction.footprintSource === 'manufacturer' ? '袋の縦横はメーカー公表。厚さと外装は現物で確認。' : '袋の縦横は未実測。発送可否は現物で確認。'}</div>
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
            <p>入力すると判定を更新し、このブラウザに保存します。</p>
          </section>
        </div>
      </div>
    </article>`;
  }

  function candidateRow(item) {
    const prediction = predictions[item.asin];
    const record = recordFor(item.asin);
    const fit = fitFor(item);
    const imageUrl = productImages[item.asin];
    const width = Number(record.pouchWidth) > 0 ? record.pouchWidth : prediction.assumedPouchCm[0];
    const length = Number(record.pouchHeight) > 0 ? record.pouchHeight : prediction.assumedPouchCm[1];
    const thickness = Number(record.thickness) > 0 ? record.thickness : prediction.roughThicknessCm.map(n => n.toFixed(1)).join('〜');
    const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async"><span class="candidate-photo-fallback" hidden>画像なし</span>` : '<span class="candidate-photo-fallback">画像なし</span>';
    return `<button class="candidate-row ${selectedAsin === item.asin ? 'is-selected' : ''}" type="button" data-select-asin="${item.asin}" aria-pressed="${selectedAsin === item.asin}">
      <span class="candidate-thumb">${image}</span>
      <span class="candidate-ident"><strong>${escapeHtml(item.title)}</strong><small>${item.asin} · ${escapeHtml(item.category)}</small></span>
      <span class="candidate-measures">袋 ${escapeHtml(width)}×${escapeHtml(length)} cm <span>厚さ ${escapeHtml(thickness)} cm</span></span>
      <span class="candidate-verdict"><span class="pill ${shippingClasses[fit.nekopos.status]}"><b>ネコポス</b> ${shippingLabels[fit.nekopos.status]}</span><span class="pill ${shippingClasses[fit.clickpost.status]}"><b>クリックポスト</b> ${shippingLabels[fit.clickpost.status]}</span></span>
    </button>`;
  }

  function render() {
    const matched = filteredProducts();
    const visible = matched.slice(0, visibleLimit);
    if (!matched.some(item => item.asin === selectedAsin)) selectedAsin = matched[0]?.asin || '';
    const selected = matched.find(item => item.asin === selectedAsin);
    $('#visibleCount').textContent = `${visible.length} / ${matched.length}件を表示（発送見込み・確信度順）`;
    $('#list').innerHTML = visible.length ? visible.map(candidateRow).join('') : '<div class="empty">該当する候補がありません。検索・絞り込みを変更してください。</div>';
    $('#featured').innerHTML = selected ? card(selected) : '';
    $('#more').hidden = visible.length >= matched.length;
  }

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

  function createCsv() {
    const header = ['ASIN', '商品名', '分類', '厚さ予測', '概算厚さ下限cm', '概算厚さ上限cm', '確信度', '理由', '計算に使った量', '中身', '仮定袋幅cm', '仮定袋長cm', '袋寸法の根拠', '袋寸法の根拠区分', 'メーカー公表の単品重量g', 'かさ密度下限g/mL', 'かさ密度上限g/mL', 'Amazon寸法確認', '掲載最小辺cm', '掲載寸法', '寸法種別', 'Keepa API商品寸法cm', 'Keepa APIパッケージ寸法cm', 'ネコポス判定', 'ネコポス理由', 'クリックポスト判定', 'クリックポスト理由', '外装の想定長辺上限cm', '外装の想定短辺上限cm', '想定3辺合計上限cm', '実測袋幅cm', '実測袋長cm', '実測外装長辺cm', '実測外装短辺cm', '実測最大厚cm', '実測梱包後重量g', '補足', '出典URL'];
    const rows = sortedProducts().map(item => {
      const p = predictions[item.asin];
      const record = recordFor(item.asin);
      const api = apiDimensions[item.asin] || {};
      const fit = fitFor(item);
      const apiCell = dims => Array.isArray(dims?.cm) ? dims.cm.join(' × ') : '';
      return [item.asin, item.title, item.category, verdictLabels[p.verdict], ...p.roughThicknessCm, p.confidence, p.reason, p.amountText || `${p.massG}g`, p.material, ...p.assumedPouchCm, p.geometryNote, p.footprintSource, p.manufacturerGrossWeightG, ...p.densityRangeGml, item.sizeConfirmed ? '3cm超' : '未確認', item.listedMinCm, item.listedDimensions, item.dimensionType, apiCell(api.keepa?.item), apiCell(api.keepa?.package), shippingLabels[fit.nekopos.status], fit.nekopos.reasons.join(' / '), shippingLabels[fit.clickpost.status], fit.clickpost.reasons.join(' / '), fit.nekopos.projected.longMax, fit.nekopos.projected.shortMax, fit.nekopos.projected.sumMax, record.pouchWidth, record.pouchHeight, record.shipLength, record.shipWidth, record.thickness, record.shipWeight, item.caution, p.sources.join(' | ')];
    });
    return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function exportCsv() {
    const csv = '\ufeff' + createCsv();
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nekopos-${products.length}asins-predictions.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('#featured').addEventListener('input', event => {
    const field = event.target.dataset.measure;
    const asin = event.target.closest('[data-asin]')?.dataset.asin;
    if (!field || !asin) return;
    records[asin] = { ...recordFor(asin), [field]: event.target.value };
    saveRecords();
  });
  $('#featured').addEventListener('change', event => {
    if (event.target.dataset.measure) { renderStats(); render(); }
  });
  $('#featured').addEventListener('error', event => {
    const image = event.target;
    if (!image.matches('.product-photo img, .keepa-graph img')) return;
    image.hidden = true;
    const fallback = image.parentElement.querySelector('.product-photo-fallback, .graph-fallback');
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
  $('#more').addEventListener('click', () => { visibleLimit += 20; render(); });
  $('#searchGo').addEventListener('click', () => $('#candidates').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#export').addEventListener('click', () => {
    $('#csvText').value = createCsv();
    $('#csvDialog').showModal();
  });
  $('#closeCsv').addEventListener('click', () => $('#csvDialog').close());
  $('#saveCsv').addEventListener('click', exportCsv);
  $('#sideExport').addEventListener('click', () => $('#export').click());
  document.querySelector('.side-nav a[href="#method"]').addEventListener('click', () => { $('#method').open = true; });
  renderStats();
  render();
})();
