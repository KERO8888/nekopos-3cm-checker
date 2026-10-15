(() => {
  const items = window.NEKOPOST_REQUESTED_REVIEWS?.items || [];
  const feedback = window.NEKOPOST_REQUESTED_FEEDBACK;
  const input = document.querySelector('#asinSearch');
  const list = document.querySelector('#requestedList');
  const count = document.querySelector('#resultCount');
  const message = document.querySelector('#feedbackMessage');
  const copyButton = document.querySelector('#copyFeedback');
  const copyText = document.querySelector('#feedbackCopyText');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const yen = value => `¥${Number(value).toLocaleString('ja-JP')}`;
  const offer = value => value ? `${yen(value.listingYen)} ＋購入者送料 ${yen(value.shippingYen)}${value.points ? `・付与 ${value.points}pt` : ''}` : '出品取得なし';
  const statusLabel = item => item.status === 'shipping_hold' ? '小型発送見込み・要実測' : item.status === 'hold' ? '形状確認待ち' : '主一覧対象外';
  const option = (value, label, selected) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`;

  function feedbackPanel(item, saved = {}) {
    const label = feedback.verdictLabels[saved.verdict] || (saved.comment ? 'コメント保存済み' : '予測を評価する');
    return `<details class="requested-feedback"><summary>予測へのフィードバック：${label}</summary>
      <form class="feedback-form" data-asin="${item.asin}">
        <label>この判定は合っていた？<select name="verdict">
          ${option('', 'まだ判断できない', saved.verdict)}${option('correct', '合っていた', saved.verdict)}${option('wrong', '違った', saved.verdict)}
        </select></label>
        <label>確認した根拠<select name="evidence">
          ${option('', '未選択', saved.evidence)}${option('packed_measurement', '発送外装の4項目を実測', saved.evidence)}${option('physical_check', '現物を確認', saved.evidence)}${option('listing_check', '掲載情報で確認', saved.evidence)}
        </select></label>
        <label>発送外装の長辺（cm）<input name="lengthCm" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escape(saved.lengthCm ?? '')}" placeholder="未測定なら空欄"></label>
        <label>発送外装の短辺（cm）<input name="widthCm" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escape(saved.widthCm ?? '')}" placeholder="未測定なら空欄"></label>
        <label>発送外装込みの最大厚（cm）<input name="thicknessCm" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escape(saved.thicknessCm ?? '')}" placeholder="未測定なら空欄"></label>
        <label>発送外装込みの重量（g）<input name="weightG" type="number" min="1" step="1" inputmode="numeric" value="${escape(saved.weightG ?? '')}" placeholder="未測定なら空欄"></label>
        <label class="wide">判定とズレた点<select name="reason">
          ${option('', '未選択', saved.reason)}${Object.entries(feedback.reasonLabels).map(([value, text]) => option(value, text, saved.reason)).join('')}
        </select></label>
        <label class="wide">コメント・形状のメモ<textarea name="comment" maxlength="2000" placeholder="例：未開封袋の底に硬いマチがあり、外装込みの最大厚は3.4cm">${escape(saved.comment || '')}</textarea></label>
        <button class="wide" type="submit">この商品のフィードバックを保存</button>
      </form><p class="feedback-help">「合っていた／違った」は上のサイト判定への評価です。数値を入れていない場合は実測扱いしません。</p>
    </details>`;
  }

  function card(item, saved) {
    const dims = item.packageCm.map(value => Number(value).toFixed(1));
    const reference = !item.merchant;
    return `<article class="requested-card" id="${item.asin}">
      <div class="requested-title"><h2>${escape(item.title)}</h2><span class="requested-status ${item.status}">${statusLabel(item)}</span></div>
      <p class="requested-asin">ASIN ${item.asin} · JAN ${escape(item.eanList.join(' / ') || '未確認')}</p>
      <div class="requested-facts"><div><small>Keepa掲載の梱包3辺・重量</small><strong>${dims.join(' × ')}cm / ${escape(item.packageWeightG)}g</strong></div><div><small>Amazon自己発送の新規出品</small><strong>${offer(item.merchant)}</strong></div><div><small>自己発送手数料見積もり</small><strong>${yen(item.merchantFeeYen)}（税込概算 ${yen(Math.ceil(item.merchantFeeYen * 1.1))}）${reference ? '・FBA売価で参考算出' : ''}</strong></div></div>
      <p class="requested-reason">${escape(item.reason)}</p>
      <p class="requested-asin">FBA出品：${offer(item.amazonFulfilled)}。${escape(item.feeBasis)}。調査記録に発送用外装の実測は未登録。${item.sourcingNote ? escape(item.sourcingNote) : '仕入価格は未確認。'}</p>
      ${feedbackPanel(item, saved)}
      <footer><a href="https://www.amazon.co.jp/dp/${item.asin}" target="_blank" rel="noopener noreferrer">Amazon商品ページ ↗</a><a href="https://keepa.com/#!product/5-${item.asin}" target="_blank" rel="noopener noreferrer">Keepa ↗</a>${item.evidenceUrl ? `<a href="${escape(item.evidenceUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.evidenceLabel || '判定根拠')} ↗</a>` : ''}</footer>
    </article>`;
  }

  function render() {
    const data = feedback.read();
    const query = input.value.trim().toLowerCase();
    const found = items.filter(item => !query || `${item.asin} ${item.title}`.toLowerCase().includes(query));
    const stats = feedback.summary(items, data);
    count.textContent = `${found.length} / ${items.length}件 · 小型発送見込み ${items.filter(item => item.status === 'shipping_hold').length}件 · 対象外 ${items.filter(item => item.status === 'excluded').length}件`;
    list.innerHTML = found.length ? found.map(item => card(item, data[item.asin])).join('') : '<p>一致するASINはありません。</p>';
    document.querySelector('#feedbackStats').textContent = stats.total
      ? `評価済み ${stats.total}件 · 合っていた ${stats.correct}件 · 違った ${stats.wrong}件 · 入力上の一致率 ${stats.accuracy}%（うち外装込み実測 ${stats.measured}件）`
      : '評価はまだありません。';
    document.querySelector('#feedbackAdvice').textContent = stats.topReason
      ? `間違いの最多理由：${feedback.reasonLabels[stats.topReason]}。次の見直し：${stats.improvement}`
      : stats.improvement;
    copyButton.disabled = feedback.report(items, data).split('\n').length <= 2;
  }

  list.addEventListener('submit', event => {
    const form = event.target.closest('form.feedback-form');
    if (!form) return;
    event.preventDefault();
    const asin = form.dataset.asin;
    if (!items.some(item => item.asin === asin)) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    for (const key of ['lengthCm', 'widthCm', 'thicknessCm', 'weightG']) {
      form.elements.namedItem(key).setCustomValidity(raw.evidence === 'packed_measurement' && !(Number(raw[key]) > 0)
        ? '発送外装を実測した場合は長辺・短辺・最大厚・重量の4項目を入力してください。' : '');
    }
    if (!form.reportValidity()) return;
    try {
      feedback.save(asin, raw);
      render();
      list.querySelector(`#${asin} .requested-feedback`).open = true;
      message.textContent = `${asin}のフィードバックをこのブラウザに保存しました。`;
    } catch {
      message.textContent = 'ブラウザに保存できませんでした。入力内容を控えてください。';
    }
  });
  list.addEventListener('input', event => {
    if (['lengthCm', 'widthCm', 'thicknessCm', 'weightG'].includes(event.target.name)) event.target.setCustomValidity('');
  });
  copyButton.addEventListener('click', async () => {
    const report = feedback.report(items, feedback.read());
    try {
      await navigator.clipboard.writeText(report);
      copyText.hidden = true;
      message.textContent = '入力内容をコピーしました。このチャットへ貼ると判定基準の見直しに使えます。';
    } catch {
      copyText.value = report;
      copyText.hidden = false;
      copyText.focus();
      copyText.select();
      message.textContent = '自動コピーできなかったため、表示した文章を選択してコピーしてください。';
    }
  });
  const requested = new URLSearchParams(window.location.search).get('asin');
  if (requested) input.value = requested.toUpperCase();
  input.addEventListener('input', render);
  render();
})();
