(() => {
  'use strict';
  const P = window.TestcaseParse;
  const $ = (id) => document.getElementById(id);
  const els = {
    quickOpen: $('quickOpen'), fileInput: $('fileInput'), sheet: $('sheet'), summary: $('summary'), srcStatus: $('srcStatus'),
    wakeWord: $('wakeWord'), gapAfterWake: $('gapAfterWake'), gapBetween: $('gapBetween'), speed: $('speed'), speedOut: $('speedOut'),
    regionVoices: $('regionVoices'), voiceList: $('voiceList'), voiceStatus: $('voiceStatus'),
    generate: $('generate'), genProgress: $('genProgress'), genBar: $('genBar'), genText: $('genText'),
    playAll: $('playAll'), pause: $('pause'), stop: $('stop'), startFrom: $('startFrom'), nowPlaying: $('nowPlaying'), log: $('log'),
    tbody: $('tbody'), empty: $('empty'), player: $('player'),
  };

  const SETTINGS_KEY = 'vieneu.testcase';
  const REGIONS = [['bac', 'Bắc'], ['trung', 'Trung'], ['nam', 'Nam']];
  const BATCH = 200;
  const STATUS_CHUNK = 500;
  const POLL_MS = 1500;
  const DEFAULTS = { wakeWord: 'Hey Vita', gapAfterWake: 1, gapBetween: 3, speed: 1, format: 'mp3', voiceByRegion: {}, sheet: '', file: '' };

  const state = {
    settings: loadSettings(),
    voices: [],
    voiceByName: new Map(),
    parsed: new Map(), // sheet name -> Row[]
    rows: [],
    overrides: new Map(), // row.index -> { voice?, wakeWord? }
    clips: new Map(), // clip key -> { voice, text, jobId, status, audioUrl, error }
    rowEls: new Map(), // row.index -> { tr, status }
    gen: null, // { keys: string[] } of the running "Sinh giọng"
    playback: null, // current playback controller
  };

  // ---------- utils ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, props = {}, children = []) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const c of [].concat(children)) if (c != null) n.append(c);
    return n;
  };
  const genderLabel = (g) => ({ male: 'nam', female: 'nữ' })[String(g || '').toLowerCase()] || g || '';

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message || res.statusText;
      throw new Error(msg);
    }
    return body;
  }

  function status(node, msg, kind = '') {
    node.textContent = msg || '';
    node.className = 'status ' + kind;
  }

  // ---------- settings ----------
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { ...DEFAULTS, ...s, voiceByRegion: { ...(s.voiceByRegion || {}) } };
    } catch {
      return { ...DEFAULTS, voiceByRegion: {} };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage unavailable */ }
  }
  const num = (v, d, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };

  // ---------- voices ----------
  const voicesOf = (region) => state.voices.filter((v) => v.region === region);
  const regionOfVoice = (name) => state.voiceByName.get(name)?.region;

  function resolveRegionVoices() {
    for (const [region] of REGIONS) {
      const cur = state.settings.voiceByRegion[region];
      if (cur && regionOfVoice(cur) === region) continue;
      const def = P.REGION_DEFAULT_VOICES[region];
      state.settings.voiceByRegion[region] = regionOfVoice(def) === region ? def : voicesOf(region)[0]?.id;
    }
  }

  function voiceOptions(selected) {
    return REGIONS.filter(([r]) => voicesOf(r).length).map(([r, label]) =>
      el('optgroup', { label: `Miền ${label}` }, voicesOf(r).map((v) =>
        el('option', { value: v.id, textContent: v.name, selected: v.id === selected }))));
  }

  function renderRegionVoices() {
    els.regionVoices.replaceChildren(...REGIONS.map(([region, label]) => {
      const sel = el('select', { 'aria-label': `Giọng miền ${label}` },
        voicesOf(region).map((v) => el('option', { value: v.id, textContent: `${v.name} (${genderLabel(v.gender)})` })));
      sel.value = state.settings.voiceByRegion[region] || '';
      sel.addEventListener('change', () => {
        state.settings.voiceByRegion[region] = sel.value;
        saveSettings();
        renderTable();
      });
      const btn = el('button', { type: 'button', className: 'ghost sm', textContent: '▶ Nghe thử' });
      btn.addEventListener('click', () => preview(sel.value));
      return el('div', { className: 'region-voice' }, [el('strong', { textContent: label }), sel, btn]);
    }));
  }

  function renderVoiceList() {
    els.voiceList.replaceChildren(...REGIONS.filter(([r]) => voicesOf(r).length).map(([region, label]) =>
      el('div', { className: 'voice-group' }, [
        el('h3', { textContent: `Miền ${label}` }),
        ...voicesOf(region).map((v) => {
          const btn = el('button', { type: 'button', className: 'ghost sm', textContent: '▶' , title: `Nghe thử ${v.name}` });
          btn.addEventListener('click', () => preview(v.id));
          return el('div', { className: 'voice-item' }, [
            el('span', {}, [el('strong', { textContent: v.name }), ' ',
              el('span', { className: 'meta', textContent: [genderLabel(v.gender), v.style].filter(Boolean).join(' · ') })]),
            btn,
          ]);
        }),
      ])));
  }

  // ---------- workbook ----------
  async function loadQuickList() {
    try {
      const files = await api('/testcases');
      els.quickOpen.append(...files.map((f) => el('option', { value: f.url, textContent: f.name })));
      const last = files.find((f) => f.name === state.settings.file);
      if (last) {
        els.quickOpen.value = last.url;
        await openUrl(last.url, last.name);
      }
    } catch (e) {
      status(els.srcStatus, `Không tải được danh sách file: ${e.message}`, 'err');
    }
  }

  async function openUrl(url, name) {
    status(els.srcStatus, `Đang đọc ${name}...`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadWorkbook(await res.arrayBuffer(), name);
    } catch (e) {
      status(els.srcStatus, `Không đọc được file: ${e.message}`, 'err');
    }
  }

  function loadWorkbook(buf, name) {
    let wb;
    try {
      wb = XLSX.read(buf, { type: 'array' });
    } catch (e) {
      return status(els.srcStatus, `Không đọc được file Excel: ${e.message}`, 'err');
    }
    state.parsed.clear();
    for (const sheet of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
      const parsed = P.parseSheet(rows);
      if (parsed) state.parsed.set(sheet, parsed);
    }
    if (!state.parsed.size) {
      els.sheet.replaceChildren();
      els.sheet.disabled = true;
      selectSheet(null);
      return status(els.srcStatus, 'Không tìm thấy sheet nào có cột "Câu nói" và "Vùng miền"', 'err');
    }
    els.sheet.replaceChildren(...[...state.parsed.keys()].map((s) => el('option', { value: s, textContent: `${s} (${state.parsed.get(s).length})` })));
    els.sheet.disabled = false;
    const keep = state.parsed.has(state.settings.sheet) ? state.settings.sheet : state.parsed.keys().next().value;
    els.sheet.value = keep;
    state.settings.file = name;
    saveSettings();
    status(els.srcStatus, `Đã mở ${name} · ${state.parsed.size} sheet testcase`, 'ok');
    selectSheet(keep);
  }

  function selectSheet(name) {
    stopPlayback();
    state.rows = name ? state.parsed.get(name) || [] : [];
    state.overrides.clear();
    if (name) { state.settings.sheet = name; saveSettings(); }
    const speech = state.rows.filter((r) => r.speech).length;
    const warn = state.rows.filter((r) => r.warnings.length).length;
    els.summary.textContent = state.rows.length ? `${state.rows.length} dòng · ${speech} cần đọc · ${warn} ⚠` : '';
    els.startFrom.value = state.rows[0]?.index ?? '';
    els.log.replaceChildren();
    renderTable();
  }

  // ---------- rows & clips ----------
  const effectiveVoice = (row) => state.overrides.get(row.index)?.voice ?? state.settings.voiceByRegion[row.region];
  const wakeText = () => state.settings.wakeWord.trim();
  const wantsWake = (row) => !!wakeText() && (state.overrides.get(row.index)?.wakeWord ?? row.wakeWord);
  const keyOf = (voice, text) => `${P.clipKey(voice, text)}|${state.settings.speed}|${state.settings.format}`;

  function rowClipSpecs(row) {
    const voice = effectiveVoice(row);
    const specs = [];
    if (wantsWake(row)) specs.push({ voice, text: wakeText() });
    specs.push({ voice, text: row.utterance });
    return specs;
  }
  const clipOf = (spec) => state.clips.get(keyOf(spec.voice, spec.text));

  /** 'skip' | 'need' | 'wait' | 'ok' | 'err' */
  function rowState(row) {
    if (!row.speech) return { s: 'skip' };
    return P.rowStatus(rowClipSpecs(row).map(clipOf));
  }

  function setOverride(row, patch) {
    const o = { ...(state.overrides.get(row.index) || {}), ...patch };
    if (o.voice === state.settings.voiceByRegion[row.region]) delete o.voice;
    if (o.wakeWord === row.wakeWord) delete o.wakeWord;
    if (Object.keys(o).length) state.overrides.set(row.index, o);
    else state.overrides.delete(row.index);
  }

  /** Queue every spec not completed/pending, then wait until all of them settle. */
  async function ensureClips(specs, { retry = false } = {}) {
    const keys = [...new Set(specs.map((s) => keyOf(s.voice, s.text)))];
    const todo = [];
    for (const key of keys) {
      const c = state.clips.get(key);
      if (c && (c.status === 'completed' || c.status === 'waiting' || c.status === 'active' || c.status === 'queued')) continue;
      if (c && c.status === 'failed' && !retry) continue;
      const spec = specs.find((s) => keyOf(s.voice, s.text) === key);
      const text = spec.text.normalize('NFC').trim().replace(/\s+/g, ' ');
      state.clips.set(key, { voice: spec.voice, text, status: 'queued' });
      todo.push(key);
    }
    updateStatuses();
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const items = chunk.map((k) => {
        const c = state.clips.get(k);
        return { text: c.text, voice: c.voice, region: regionOfVoice(c.voice), speed: state.settings.speed, format: state.settings.format };
      });
      try {
        const views = await api('/tts/batch', { method: 'POST', body: JSON.stringify({ items }) });
        views.forEach((v, j) => applyView(chunk[j], v));
      } catch (e) {
        for (const k of chunk) applyView(k, { status: 'failed', error: e.message });
      }
      updateStatuses();
    }
    while (keys.some((k) => isPending(state.clips.get(k)))) {
      await pollTick();
    }
  }

  const isPending = (c) => !!c && (c.status === 'waiting' || c.status === 'active' || c.status === 'queued');

  function applyView(key, v) {
    const c = state.clips.get(key);
    if (!c) return;
    c.jobId = v.jobId || c.jobId;
    c.status = v.status;
    c.audioUrl = v.audioUrl;
    c.error = v.error;
  }

  // One shared poll loop for all waiters.
  let polling = null;
  function pollTick() {
    if (!polling) polling = sleep(POLL_MS).then(pollOnce).finally(() => { polling = null; });
    return polling;
  }
  async function pollOnce() {
    const pending = [...state.clips.entries()].filter(([, c]) => c.jobId && (c.status === 'waiting' || c.status === 'active'));
    for (let i = 0; i < pending.length; i += STATUS_CHUNK) {
      const chunk = pending.slice(i, i + STATUS_CHUNK);
      try {
        const views = await api('/tts/jobs/status', { method: 'POST', body: JSON.stringify({ ids: chunk.map(([, c]) => c.jobId) }) });
        views.forEach((v, j) => applyView(chunk[j][0], v));
      } catch {
        /* transient: next tick retries */
      }
    }
    updateStatuses();
  }

  // ---------- table ----------
  function renderTable() {
    state.rowEls.clear();
    els.empty.hidden = state.rows.length > 0;
    els.tbody.replaceChildren(...state.rows.map((row) => {
      const tr = el('tr', { className: row.speech ? '' : 'row-muted' });
      const regionTd = el('td', { className: 'nowrap', textContent: row.regionRaw || '—' });
      if (row.warnings.length) regionTd.append(' ', el('span', { className: 'warn', textContent: '⚠', title: row.warnings.join('\n') }));
      const uttTd = el('td', { className: 'utt', textContent: row.utterance, title: [row.title, row.expected].filter(Boolean).join('\n\n') });
      const statusTd = el('td', { className: 'nowrap' });
      let voiceTd, wwTd, playTd;
      if (row.speech) {
        const sel = el('select', { 'aria-label': `Giọng dòng ${row.index}` }, voiceOptions(effectiveVoice(row)));
        sel.addEventListener('change', () => { setOverride(row, { voice: sel.value }); updateStatuses(); });
        voiceTd = el('td', {}, sel);
        const cb = el('input', { type: 'checkbox', checked: wantsWake(row), disabled: !wakeText(), title: 'Đọc wake-word trước câu nói' });
        cb.addEventListener('change', () => { setOverride(row, { wakeWord: cb.checked }); updateStatuses(); });
        wwTd = el('td', {}, cb);
        const play = el('button', { type: 'button', className: 'ghost sm', textContent: '▶', title: 'Phát dòng này' });
        play.addEventListener('click', () => playSingle(row));
        playTd = el('td', {}, play);
      } else {
        voiceTd = el('td', { textContent: row.speaker || '—', className: 'muted' });
        wwTd = el('td');
        playTd = el('td');
      }
      tr.append(
        el('td', { textContent: String(row.index) }),
        el('td', { className: 'nowrap', textContent: row.tcId }),
        el('td', { textContent: String(row.step) }),
        regionTd, voiceTd, wwTd, uttTd, statusTd, playTd,
      );
      state.rowEls.set(row.index, { tr, status: statusTd });
      return tr;
    }));
    updateStatuses();
  }

  function updateStatuses() {
    let need = 0;
    for (const row of state.rows) {
      const ref = state.rowEls.get(row.index);
      if (!ref) continue;
      const st = rowState(row);
      if (st.s === 'need' || st.s === 'err') need++;
      const td = ref.status;
      td.replaceChildren();
      if (st.s === 'skip') td.textContent = '—';
      else if (st.s === 'ok') td.append(el('span', { className: 'st-ok', textContent: '✓' }));
      else if (st.s === 'wait') td.append(el('span', { className: 'st-wait', textContent: '⏳' }));
      else if (st.s === 'need') td.append(el('span', { className: 'st-wait', textContent: 'cần sinh' }));
      else {
        const retry = el('button', { type: 'button', className: 'ghost sm', textContent: 'Thử lại' });
        retry.addEventListener('click', () => ensureClips(rowClipSpecs(row), { retry: true }));
        td.append(el('span', { className: 'st-err', textContent: '✗ ', title: st.error || 'Lỗi' }), retry);
      }
    }
    els.generate.textContent = need ? `Sinh giọng (${need})` : 'Sinh giọng';
    els.generate.disabled = !state.voices.length || !need || !!state.gen;
    els.playAll.disabled = !state.rows.some((r) => rowState(r).s === 'ok');
    updateGenProgress();
  }

  function updateGenProgress() {
    if (!state.gen) return;
    const clips = state.gen.keys.map((k) => state.clips.get(k));
    const done = clips.filter((c) => c && (c.status === 'completed' || c.status === 'failed')).length;
    const failed = clips.filter((c) => c?.status === 'failed').length;
    els.genBar.style.width = `${Math.round((done / clips.length) * 100)}%`;
    els.genText.textContent = `${done}/${clips.length}${failed ? ` · ${failed} lỗi` : ''}`;
  }

  async function generateAll() {
    const specs = state.rows.filter((r) => r.speech).flatMap(rowClipSpecs);
    const keys = [...new Set(specs.map((s) => keyOf(s.voice, s.text)))];
    state.gen = { keys };
    els.genProgress.hidden = false;
    updateStatuses();
    try {
      await ensureClips(specs, { retry: true });
    } finally {
      updateGenProgress();
      state.gen = null;
      updateStatuses();
    }
  }

  // ---------- playback ----------
  function newPlayback() {
    stopPlayback();
    const pb = { cancelled: false, paused: false, onCancel: new Set() };
    state.playback = pb;
    return pb;
  }

  function stopPlayback() {
    const pb = state.playback;
    if (!pb) return;
    pb.cancelled = true;
    els.player.pause();
    for (const fn of pb.onCancel) fn();
    state.playback = null;
    highlight(null);
    setPlayButtons(false);
  }

  /** Resolves when the clip ends (or playback is cancelled); rejects if the audio cannot load. */
  function playClip(url, pb) {
    return new Promise((resolve, reject) => {
      if (pb.cancelled) return resolve();
      const p = els.player;
      const done = (fn) => () => { p.onended = p.onerror = null; pb.onCancel.delete(cancel); fn(); };
      const cancel = done(resolve);
      pb.onCancel.add(cancel);
      p.onended = done(resolve);
      p.onerror = done(() => reject(new Error('Không phát được audio (có thể đã hết hạn cache)')));
      p.src = url;
      if (!pb.paused) p.play().catch(() => { /* autoplay errors surface via onerror */ });
    });
  }

  /** Waits ms of un-paused time; returns early when cancelled. */
  async function wait(ms, pb) {
    let left = ms;
    while (left > 0 && !pb.cancelled) {
      await sleep(Math.min(100, left));
      if (!pb.paused) left -= 100;
    }
  }

  /** Forget one clip whose audio failed to load (shared wake clips of other rows stay intact). */
  function dropClip(spec) {
    state.clips.delete(keyOf(spec.voice, spec.text));
    updateStatuses();
  }

  async function playRow(row, pb) {
    const specs = rowClipSpecs(row);
    if (rowState(row).s !== 'ok') await ensureClips(specs);
    if (pb.cancelled) return;
    const st = rowState(row);
    if (st.s !== 'ok') throw new Error(st.error || 'Chưa có audio');
    const clips = specs.map(clipOf);
    for (let i = 0; i < clips.length && !pb.cancelled; i++) {
      if (i > 0) await wait(state.settings.gapAfterWake * 1000, pb);
      try {
        await playClip(clips[i].audioUrl, pb);
      } catch (e) {
        dropClip(specs[i]);
        throw e;
      }
    }
  }

  function highlight(row) {
    for (const { tr } of state.rowEls.values()) tr.classList.remove('row-playing');
    if (!row) return status(els.nowPlaying, '');
    const ref = state.rowEls.get(row.index);
    if (ref) {
      ref.tr.classList.add('row-playing');
      ref.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    status(els.nowPlaying, `Đang phát #${row.index} ${row.tcId} (bước ${row.step}): ${row.utterance}`);
  }

  function setPlayButtons(active) {
    els.pause.disabled = !active;
    els.stop.disabled = !active;
    els.pause.textContent = '⏸ Dừng';
  }

  function logLine(msg) {
    els.log.append(el('li', { textContent: msg }));
  }

  async function playSingle(row) {
    const pb = newPlayback();
    setPlayButtons(true);
    highlight(row);
    try {
      await playRow(row, pb);
    } catch (e) {
      status(els.nowPlaying, `#${row.index} ${row.tcId}: ${e.message}`, 'err');
      return finish(pb, false);
    }
    finish(pb);
  }

  function finish(pb, clear = true) {
    if (state.playback !== pb) return;
    state.playback = null;
    setPlayButtons(false);
    for (const { tr } of state.rowEls.values()) tr.classList.remove('row-playing');
    if (clear) status(els.nowPlaying, '');
  }

  async function playAll() {
    const pb = newPlayback();
    setPlayButtons(true);
    els.log.replaceChildren();
    const start = Number(els.startFrom.value) || 0;
    const queue = state.rows.filter((r) => r.speech && r.index >= start);
    let played = 0;
    for (const row of queue) {
      if (pb.cancelled) break;
      const st = rowState(row);
      if (st.s !== 'ok') {
        logLine(`Bỏ qua #${row.index} ${row.tcId}: ${st.s === 'err' ? st.error || 'lỗi' : 'chưa sinh giọng'}`);
        continue;
      }
      if (played > 0) await wait(state.settings.gapBetween * 1000, pb);
      if (pb.cancelled) break;
      highlight(row);
      try {
        await playRow(row, pb);
        played++;
      } catch (e) {
        logLine(`Bỏ qua #${row.index} ${row.tcId}: ${e.message}`);
      }
    }
    if (!pb.cancelled) logLine(`Xong: đã phát ${played} dòng`);
    finish(pb);
  }

  function togglePause() {
    const pb = state.playback;
    if (!pb) return;
    pb.paused = !pb.paused;
    if (pb.paused) els.player.pause();
    else if (els.player.src && !els.player.ended) els.player.play().catch(() => {});
    els.pause.textContent = pb.paused ? '▶ Tiếp tục' : '⏸ Dừng';
  }

  async function preview(voice) {
    if (!voice) return;
    const v = state.voiceByName.get(voice);
    const ww = wakeText();
    const text = `${ww ? `${ww}, ` : ''}xin chào, đây là giọng ${v?.name || voice}.`;
    const pb = newPlayback();
    setPlayButtons(true);
    status(els.voiceStatus, `Đang chuẩn bị giọng ${v?.name || voice}...`);
    try {
      await ensureClips([{ voice, text }], { retry: true });
      const c = clipOf({ voice, text });
      if (c?.status !== 'completed') throw new Error(c?.error || 'Không tạo được câu mẫu');
      status(els.voiceStatus, `Nghe thử: ${v?.name || voice}`);
      await playClip(c.audioUrl, pb);
      status(els.voiceStatus, '');
    } catch (e) {
      status(els.voiceStatus, e.message, 'err');
    }
    finish(pb);
  }

  // ---------- settings UI ----------
  function bindSettings() {
    const s = state.settings;
    els.wakeWord.value = s.wakeWord;
    els.gapAfterWake.value = s.gapAfterWake;
    els.gapBetween.value = s.gapBetween;
    els.speed.value = s.speed;
    els.speedOut.textContent = Number(s.speed).toFixed(2) + '×';
    const fmt = document.querySelector(`input[name=format][value="${s.format}"]`) || document.querySelector('input[name=format]');
    fmt.checked = true;

    els.wakeWord.addEventListener('change', () => { s.wakeWord = els.wakeWord.value.trim(); saveSettings(); renderTable(); });
    els.gapAfterWake.addEventListener('change', () => { s.gapAfterWake = num(els.gapAfterWake.value, 1, 0, 10); els.gapAfterWake.value = s.gapAfterWake; saveSettings(); });
    els.gapBetween.addEventListener('change', () => { s.gapBetween = num(els.gapBetween.value, 3, 0, 60); els.gapBetween.value = s.gapBetween; saveSettings(); });
    els.speed.addEventListener('input', () => { els.speedOut.textContent = Number(els.speed.value).toFixed(2) + '×'; });
    els.speed.addEventListener('change', () => { s.speed = num(els.speed.value, 1, 0.5, 2); saveSettings(); updateStatuses(); });
    document.querySelectorAll('input[name=format]').forEach((r) => r.addEventListener('change', () => {
      s.format = r.value; saveSettings(); updateStatuses();
    }));
  }

  async function init() {
    bindSettings();
    els.quickOpen.addEventListener('change', () => {
      const opt = els.quickOpen.selectedOptions[0];
      if (opt?.value) openUrl(opt.value, opt.textContent);
    });
    els.fileInput.addEventListener('change', async () => {
      const f = els.fileInput.files?.[0];
      if (!f) return;
      els.quickOpen.value = '';
      status(els.srcStatus, `Đang đọc ${f.name}...`);
      loadWorkbook(await f.arrayBuffer(), f.name);
    });
    els.sheet.addEventListener('change', () => selectSheet(els.sheet.value));
    els.generate.addEventListener('click', generateAll);
    els.playAll.addEventListener('click', playAll);
    els.pause.addEventListener('click', togglePause);
    els.stop.addEventListener('click', stopPlayback);

    try {
      state.voices = await api('/voices');
      state.voiceByName = new Map(state.voices.map((v) => [v.id, v]));
      resolveRegionVoices();
      saveSettings();
      renderRegionVoices();
      renderVoiceList();
    } catch (e) {
      status(els.voiceStatus, `Không tải được danh sách giọng: ${e.message}`, 'err');
    }
    renderTable();
    await loadQuickList();
  }

  init();
})();
