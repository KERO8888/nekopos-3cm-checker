(() => {
  'use strict';

  const products = window.NEKOPOST_PRODUCTS || [];
  const predictions = window.NEKOPOST_PREDICTIONS || {};
  const storageKey = 'nekopos-candidates-v1';
  const verdictLabels = {
    likely: '3cm以内に収まりそう',
    borderline: '境界・情報不足',
    unlikely: '3cm以内は難しい',
  };
  const verdictOrder = { likely: 0, borderline: 1, unlikely: 2 };
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

  if (products.length !== 100 || products.some(item => !predictions[item.asin])) {
    $('#list').innerHTML = '<div class="empty">推定データを読み込めませんでした。ページを再読み込みしてください。</div>';
    return;
  }

  const sortedProducts = [...products].sort((a, b) => {
    const pa = predictions[a.asin];
    const pb = predictions[b.asin];
    return verdictOrder[pa.verdict] - verdictOrder[pb.verdict]
      || confidenceOrder[pa.confidence] - confidenceOrder[pb.confidence]
      || pa.roughThicknessCm[1] - pb.roughThicknessCm[1]
      || a.asin.localeCompare(b.asin);
  });

  function renderStats() {
    $('#totalCount').textContent = products.length;
    for (const verdict of Object.keys(verdictLabels)) {
      $(`#${verdict}Count`).textContent = products.filter(item => predictions[item.asin].verdict === verdict).length;
    }
  }

  function filteredProducts() {
    const query = $('#search').value.trim().toLowerCase();
    const category = $('#category').value;
    const dimension = $('#dimension').value;
    const forecast = $('#forecast').value;
    return sortedProducts.filter(item => {
      const prediction = predictions[item.asin];
      return (!query || `${item.asin} ${item.title} ${item.category} ${prediction.material}`.toLowerCase().includes(query))
        && (category === 'all' || item.category === category)
        && (dimension === 'all' || (dimension === 'confirmed') === item.sizeConfirmed)
        && (forecast === 'all' || forecast === prediction.verdict);
    });
  }

  function sourceLink(url, index) {
    const label = index === 0 ? 'Amazon商品ページ' : (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '参考情報'; }
    })();
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function card(item) {
    const prediction = predictions[item.asin];
    const record = recordFor(item.asin);
    const range = prediction.roughThicknessCm;
    const meterStart = Math.max(0, Math.min(98, range[0] / 5 * 100));
    const meterEnd = Math.max(meterStart + 2, Math.min(100, range[1] / 5 * 100));
    const measuredThickness = Number(record.thickness);
    const measuredLabel = record.thickness !== '' && record.thickness != null && measuredThickness > 0
      ? `<span class="pill ${measuredThickness <= 3 ? 'likely' : 'unlikely'}">実測 ${escapeHtml(record.thickness)}cm・${measuredThickness <= 3 ? '厚さOK' : '厚さNG'}</span>` : '';
    const dimensionLabel = item.sizeConfirmed
      ? `<span class="dim">Amazon ${escapeHtml(item.dimensionType)}：${escapeHtml(item.listedDimensions)}（最小 ${item.listedMinCm}cm）</span>`
      : '<span>Amazonの3辺寸法は未確認</span>';
    return `<article class="card" data-asin="${item.asin}">
      <div>
        <div class="card-top"><span class="pill ${prediction.verdict}">${verdictLabels[prediction.verdict]}</span>${measuredLabel}<span class="pill">${escapeHtml(item.category)}</span><span class="pill ${item.sizeConfirmed ? 'confirmed' : 'unconfirmed'}">${item.sizeConfirmed ? '掲載3cm超' : '寸法未確認'}</span></div>
        <h3 class="title"><a href="https://www.amazon.co.jp/dp/${item.asin}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
        <div class="meta"><span class="asin">${item.asin}</span>${dimensionLabel}</div>
        ${item.caution ? `<div class="caution">補足：${escapeHtml(item.caution)}</div>` : ''}
      </div>
      <div class="estimate">
        <div class="estimate-head"><span class="pill ${prediction.verdict}">${verdictLabels[prediction.verdict]}</span><small>推定の確信度：${prediction.confidence}</small></div>
        <strong>約 ${range[0].toFixed(1)}〜${range[1].toFixed(1)} cm</strong>
        <small>内容物を均し、薄い外装を加えた厚さの概算</small>
        <div class="thickness-meter" role="img" aria-label="厚さの推定範囲は約${range[0].toFixed(1)}から${range[1].toFixed(1)}センチ、基準は3センチ">
          <span class="thickness-meter-range ${prediction.verdict}" style="left:${meterStart}%;width:${Math.max(2, meterEnd - meterStart)}%"></span>
          <span class="thickness-meter-limit"></span>
        </div>
        <div class="thickness-meter-labels"><span>0cm</span><span>3cmの目安</span><span>5cm</span></div>
        <p>${escapeHtml(prediction.reason)}</p>
        <details><summary>根拠と仮定</summary>
          <ul><li>計算に使った質量：${prediction.massG}g ／ 中身：${escapeHtml(prediction.material)}</li>
          <li>袋の表面：約${prediction.assumedPouchCm[0]}×${prediction.assumedPouchCm[1]}cm（${escapeHtml(prediction.geometryNote)}）</li>
          <li>かさ密度の仮定：${prediction.densityRangeGml[0]}〜${prediction.densityRangeGml[1]}g/mL</li></ul>
          <div class="source-links">${prediction.sources.map(sourceLink).join('')}</div>
        </details>
        <details class="measurement"><summary>実物の寸法を記録</summary>
          <div class="measurement-fields">
            <label>商品袋の幅 cm<input data-measure="pouchWidth" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.pouchWidth)}" placeholder="例 15"></label>
            <label>商品袋の長さ cm<input data-measure="pouchHeight" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.pouchHeight)}" placeholder="例 24"></label>
            <label>梱包後の最大厚 cm<input data-measure="thickness" type="number" min="0" max="99" step="0.1" inputmode="decimal" value="${escapeHtml(record.thickness)}" placeholder="例 2.8"></label>
          </div>
          <p>袋を発送時と同じように梱包し、最も厚い部分を測ってください。記録はこのブラウザに保存されます。</p>
        </details>
      </div>
    </article>`;
  }

  function render() {
    const visible = filteredProducts();
    $('#visibleCount').textContent = `${visible.length}件を表示（判定・確信度順）`;
    $('#list').innerHTML = visible.length ? visible.map(card).join('') : '<div class="empty">該当する候補がありません。検索・絞り込みを変更してください。</div>';
  }

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

  function createCsv() {
    const header = ['ASIN', '商品名', '分類', '予測', '概算厚さ下限cm', '概算厚さ上限cm', '確信度', '理由', '内容量g', '中身', '仮定袋幅cm', '仮定袋長cm', '袋寸法の根拠', 'かさ密度下限g/mL', 'かさ密度上限g/mL', 'Amazon寸法確認', '掲載最小辺cm', '掲載寸法', '寸法種別', '実測袋幅cm', '実測袋長cm', '実測最大厚cm', '補足', '出典URL'];
    const rows = sortedProducts.map(item => {
      const p = predictions[item.asin];
      const record = recordFor(item.asin);
      return [item.asin, item.title, item.category, verdictLabels[p.verdict], ...p.roughThicknessCm, p.confidence, p.reason, p.massG, p.material, ...p.assumedPouchCm, p.geometryNote, ...p.densityRangeGml, item.sizeConfirmed ? '3cm超' : '未確認', item.listedMinCm, item.listedDimensions, item.dimensionType, record.pouchWidth, record.pouchHeight, record.thickness, item.caution, p.sources.join(' | ')];
    });
    return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function exportCsv() {
    const csv = '\ufeff' + createCsv();
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nekopos-100asins-predictions.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('#list').addEventListener('input', event => {
    const field = event.target.dataset.measure;
    const asin = event.target.closest('[data-asin]')?.dataset.asin;
    if (!field || !asin) return;
    records[asin] = { ...recordFor(asin), [field]: event.target.value };
    saveRecords();
  });
  $('#list').addEventListener('change', event => {
    if (event.target.dataset.measure === 'thickness') render();
  });
  ['search', 'category', 'dimension', 'forecast'].forEach(id => {
    $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render);
  });
  $('#export').addEventListener('click', () => {
    $('#csvText').value = createCsv();
    $('#csvDialog').showModal();
  });
  $('#closeCsv').addEventListener('click', () => $('#csvDialog').close());
  $('#saveCsv').addEventListener('click', exportCsv);
  renderStats();
  render();
})();
