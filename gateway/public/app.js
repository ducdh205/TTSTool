(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('form'), region: $('region'), voice: $('voice'), speed: $('speed'), speedOut: $('speedOut'),
    speedReset: $('speedReset'), text: $('text'), count: $('count'), submit: $('submit'),
    result: $('result'), status: $('status'), cachedBadge: $('cachedBadge'), progress: $('progress'),
    player: $('player'), download: $('download'), history: $('history'), historyCard: $('historyCard'),
  };
  const HISTORY_KEY = 'vieneu.history';
  let voices = [];

  const api = async (path, opts = {}) => {
    const res = await fetch('/api' + path, {
      ...opts,
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message || res.statusText;
      throw new Error(msg);
    }
    return body;
  };

  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const genderLabel = (g) => ({ male: 'nam', female: 'nữ' })[String(g || '').toLowerCase()] || g;

  function renderVoices() {
    const list = voices.filter((v) => v.region === els.region.value);
    els.voice.replaceChildren(
      ...list.map((v) => option(v.id, v.name + (v.gender ? ` (${genderLabel(v.gender)})` : '') + (v.isDefault ? ' ★' : ''))),
    );
    const def = list.find((v) => v.isDefault);
    if (def) els.voice.value = def.id;
  }

  async function init() {
    try {
      const [regions, all] = await Promise.all([api('/regions'), api('/voices')]);
      voices = all;
      const used = new Set(voices.map((v) => v.region));
      els.region.replaceChildren(...regions.filter((r) => used.has(r.id)).map((r) => option(r.id, r.label)));
      const def = voices.find((v) => v.isDefault);
      if (def) els.region.value = def.region;
      renderVoices();
    } catch (e) {
      showStatus(`Không tải được danh sách giọng: ${e.message}`, 'err');
    }
    renderHistory();
  }

  function showStatus(msg, kind = '') {
    els.result.hidden = false;
    els.status.textContent = msg;
    els.status.className = 'status ' + kind;
  }

  function resetResult() {
    els.cachedBadge.hidden = true;
    els.player.hidden = true;
    els.download.hidden = true;
    els.player.removeAttribute('src');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForJob(view) {
    let delay = 1000;
    while (view.status === 'waiting' || view.status === 'active') {
      els.progress.hidden = false;
      showStatus(view.status === 'waiting'
        ? `Đang xếp hàng${view.position ? ` (còn ${view.position} việc phía trước)` : ''}...`
        : 'Đang tạo giọng nói...');
      await sleep(delay);
      delay = Math.min(delay * 1.3, 3000);
      view = await api(`/tts/jobs/${view.jobId}`);
    }
    els.progress.hidden = true;
    return view;
  }

  function showAudio(view, format) {
    showStatus(`Hoàn tất${view.duration ? ` · ${view.duration.toFixed(1)} giây` : ''}`, 'ok');
    els.cachedBadge.hidden = !view.cached;
    els.player.src = view.audioUrl;
    els.player.hidden = false;
    els.download.href = view.audioUrl;
    els.download.download = `vieneu-${view.jobId.slice(0, 8)}.${format}`;
    els.download.hidden = false;
    els.player.play().catch(() => {});
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const text = els.text.value.trim();
    if (!text) return showStatus('Vui lòng nhập văn bản', 'err');
    const payload = {
      text,
      region: els.region.value,
      voice: els.voice.value,
      speed: Number(els.speed.value),
      format: els.form.querySelector('input[name=format]:checked').value,
    };
    els.submit.disabled = true;
    resetResult();
    try {
      let view = await api('/tts', { method: 'POST', body: JSON.stringify(payload) });
      view = await waitForJob(view);
      if (view.status === 'failed') throw new Error(view.error || 'Tạo giọng nói thất bại');
      showAudio(view, payload.format);
      pushHistory({ ...payload, audioUrl: view.audioUrl, jobId: view.jobId, at: Date.now() });
    } catch (e) {
      els.progress.hidden = true;
      showStatus(e.message, 'err');
    } finally {
      els.submit.disabled = false;
    }
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function pushHistory(item) {
    const list = [item, ...loadHistory().filter((h) => h.jobId !== item.jobId)].slice(0, 10);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
    renderHistory();
  }
  function renderHistory() {
    const list = loadHistory();
    els.historyCard.hidden = list.length === 0;
    els.history.replaceChildren(...list.map((h) => {
      const li = document.createElement('li');
      const txt = Object.assign(document.createElement('span'), { className: 'txt', textContent: h.text, title: h.text });
      const meta = Object.assign(document.createElement('span'), { className: 'meta', textContent: `${h.voice} · ${Number(h.speed).toFixed(2)}×` });
      const play = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Phát' });
      play.addEventListener('click', () => {
        resetResult();
        showAudio({ audioUrl: h.audioUrl, jobId: h.jobId, cached: false }, h.format);
      });
      li.append(txt, meta, play);
      return li;
    }));
  }

  els.region.addEventListener('change', renderVoices);
  els.speed.addEventListener('input', () => (els.speedOut.textContent = Number(els.speed.value).toFixed(2) + '×'));
  els.speedReset.addEventListener('click', () => { els.speed.value = '1'; els.speed.dispatchEvent(new Event('input')); });
  els.text.addEventListener('input', () => (els.count.textContent = els.text.value.length));
  els.player.addEventListener('error', () => { if (els.player.src) showStatus('File audio đã hết hạn trong cache, hãy tạo lại', 'err'); });
  els.form.addEventListener('submit', onSubmit);
  init();
})();
