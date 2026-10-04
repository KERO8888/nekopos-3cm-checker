(() => {
  'use strict';

  const research = window.NEKOPOST_RESEARCH_STATUS;
  const products = window.NEKOPOST_PRODUCTS || [];
  const predictions = window.NEKOPOST_PREDICTIONS || {};
  const imageData = window.NEKOPOST_IMAGES || {};
  const apiData = window.NEKOPOST_API_DIMENSIONS || {};
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const productAsins = new Set(products.map(item => item.asin));
  const imageAsins = new Set(Object.keys(imageData.images || {}));
  const apiItems = apiData.items || {};

  if (!research || !products.length) {
    $('#statusError').hidden = false;
    return;
  }

  function dateTime(value) {
    if (!value) return '記録なし';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '記録なし';
    return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function percentage(count, total) {
    return total ? Math.max(1, Math.round(count / total * 100)) : 0;
  }

  function sourceCard({ title, status, tone, metric, detail, checkedAt, footnote }) {
    return `<article class="status-card source-card ${tone}"><div class="source-card-head"><h2>${escapeHtml(title)}</h2><span class="source-status">${escapeHtml(status)}</span></div><strong class="source-metric">${escapeHtml(metric)}</strong><p>${escapeHtml(detail)}</p><small>最終取得・確認：${escapeHtml(checkedAt)}</small>${footnote ? `<div class="source-footnote">${escapeHtml(footnote)}</div>` : ''}</article>`;
  }

  const additions = research.additions || [];
  const registeredAdditions = additions.filter(item => productAsins.has(item.asin));
  const imageCount = products.filter(item => imageAsins.has(item.asin)).length;
  const predictionCount = products.filter(item => predictions[item.asin]).length;
  const keepaCount = products.filter(item => apiItems[item.asin]?.keepa).length;
  const keepaItemCount = products.filter(item => apiItems[item.asin]?.keepa?.item).length;
  const keepaPackageCount = products.filter(item => apiItems[item.asin]?.keepa?.package).length;
  const manufacturerCount = products.filter(item => predictions[item.asin]?.footprintSource === 'manufacturer').length;
  const apiStatus = apiData.sourceStatus || {};

  $('#researchDate').textContent = `${research.searchedOn.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, year, month, day) => `${year}年${Number(month)}月${Number(day)}日`)}の検索結果`;
  $('#catalogCount').textContent = products.length;
  $('#addedCount').textContent = additions.length;
  $('#addedCheck').textContent = registeredAdditions.length === additions.length ? `${registeredAdditions.length}件すべて商品一覧に反映` : `${registeredAdditions.length} / ${additions.length}件を商品一覧に反映`;
  $('#discoveredCount').textContent = research.discoveredCount;
  $('#queryCount').textContent = `${research.queryCount}語の検索結果1ページ目`;
  $('#checkedCount').textContent = research.pageCheckedCount;
  $('#uncheckedCount').textContent = `${research.notFetchedCount}件は商品ページ未確認`;
  $('#researchScope').textContent = research.scope;
  $('#newProductsCount').textContent = `${additions.length}件`;

  const pipeline = [
    { label: '検索で発見', count: research.discoveredCount, description: `${research.queryCount}語の検索結果1ページ目`, tone: 'found' },
    { label: '商品ページ確認', count: research.pageCheckedCount, description: `${research.notFetchedCount}件はページ未確認`, tone: 'checked' },
    { label: '商品一覧に追加', count: research.addedCount, description: `${registeredAdditions.length}件を現在の一覧で確認`, tone: 'added' },
  ];
  $('#pipeline').innerHTML = pipeline.map(step => `<div class="pipeline-step ${step.tone}"><div><b>${step.label}</b><strong>${step.count}<em>件</em></strong></div><div class="pipeline-bar"><span style="width:${percentage(step.count, research.discoveredCount)}%"></span></div><small>${escapeHtml(step.description)}</small></div>`).join('');

  const imageComplete = imageCount === products.length;
  const keepaComplete = keepaCount === products.length;
  const keepaLatestError = apiStatus.keepa?.status === 'error';
  const predictionComplete = predictionCount === products.length;
  $('#sourceGrid').innerHTML = [
    sourceCard({ title: 'Amazon商品画像', status: imageComplete ? '取得済み' : '一部未取得', tone: imageComplete ? 'ok' : 'warn', metric: `${imageCount} / ${products.length}`, detail: '登録商品の画像URLを保存。画像本体はAmazonから表示します。', checkedAt: dateTime(imageData.fetchedAt), footnote: imageComplete ? '' : `${products.length - imageCount}件の画像URLがありません。` }),
    sourceCard({ title: 'Keepa API', status: keepaLatestError ? '再取得に失敗' : keepaComplete ? '応答取得済み' : '一部未取得', tone: keepaLatestError || !keepaComplete ? 'warn' : 'ok', metric: `${keepaCount} / ${products.length}`, detail: `保存済みの商品寸法 ${keepaItemCount}件・包装寸法 ${keepaPackageCount}件。応答があっても寸法が空の商品はあります。`, checkedAt: dateTime(apiStatus.keepa?.checkedAt || apiData.updatedAt), footnote: keepaLatestError ? '件数には以前に取得して保存したデータも含まれます。' : '' }),
    sourceCard({ title: '厚さ予測データ', status: predictionComplete ? '全件作成済み' : '一部欠落', tone: predictionComplete ? 'ok' : 'warn', metric: `${predictionCount} / ${products.length}`, detail: `メーカー公表の袋寸法を採用した商品は${manufacturerCount}件。残りは登録寸法や類似品などを根拠に推定。`, checkedAt: dateTime(research.predictionsUpdatedAt) }),
  ].join('');

  function renderAdditions() {
    const query = $('#newProductSearch').value.trim().toLowerCase();
    const filtered = additions.filter(item => !query || `${item.asin} ${item.title} ${item.category}`.toLowerCase().includes(query));
    $('#newProducts').innerHTML = filtered.length ? filtered.map(item => {
      const hasImage = imageAsins.has(item.asin);
      const hasPrediction = Boolean(predictions[item.asin]);
      const hasKeepa = Boolean(apiItems[item.asin]?.keepa);
      const ready = item.inCatalog && hasImage && hasPrediction && hasKeepa;
      return `<div class="new-product"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.asin)} · ${escapeHtml(item.category)}</small><small>発見した検索語：${escapeHtml(item.queries.join('、'))}</small></div><div class="new-product-side"><span class="ready-tag ${ready ? 'ok' : 'warn'}">${ready ? '画像・予測・Keepaあり' : 'データに欠落あり'}</span><a href="index.html?asin=${encodeURIComponent(item.asin)}">分析を見る ↗</a></div></div>`;
    }).join('') : '<p class="empty-result">該当する商品はありません。</p>';
  }
  $('#newProductSearch').addEventListener('input', renderAdditions);
  renderAdditions();

  $('#queryRows').innerHTML = research.queries.map(item => `<div class="query-row"><span>${escapeHtml(item.query)}</span><b>${item.discovered}</b><b>${item.pageChecked}</b><b class="added-number">${item.added}</b></div>`).join('');
  $('#statusContent').hidden = false;
})();
