/*
 * Pure parsing helpers for testcase workbooks (no DOM). UMD: window.TestcaseParse in the
 * browser, module.exports for Jest (gateway/src/testcases/testcase-parse.spec.ts).
 * Input rows are 2-D arrays as produced by XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TestcaseParse = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEXT_LEN = 3000; // keep in sync with gateway common/constants.ts
  const HEADER_SCAN_ROWS = 15;
  const REGION_DEFAULT_VOICES = { bac: 'Hải Đăng', trung: 'Ngọc Trân', nam: 'Thái Sơn' };

  // Column key -> substring of the header cell (case-sensitive, NFC). First match wins.
  const COLUMNS = {
    tcId: 'TC_ID',
    title: 'Tiêu đề',
    region: 'Vùng miền',
    step: 'Bước',
    precondition: 'Tiền điều kiện',
    speaker: 'Người nói',
    utterance: 'Câu nói',
    expected: 'Kết quả mong đợi',
  };
  const NON_SPEECH = ['không có lời nói', 'tester', 'giả lập', 'hil', 'loa media'];

  const str = (v) => (v == null ? '' : String(v).normalize('NFC').trim());

  function findHeader(rows) {
    const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
    for (let i = 0; i < limit; i++) {
      const cells = (rows[i] || []).map(str);
      const cols = {};
      for (const [key, needle] of Object.entries(COLUMNS)) {
        cols[key] = cells.findIndex((c) => c.includes(needle));
      }
      if (cols.utterance >= 0 && cols.region >= 0) return { headerIndex: i, cols };
    }
    return null;
  }

  function regionOf(token) {
    const t = token.toUpperCase();
    if (t.startsWith('BAC')) return 'bac';
    if (t.startsWith('TRUNG')) return 'trung';
    if (t.startsWith('NAM')) return 'nam';
    return null;
  }

  function mapRegion(raw) {
    const s = str(raw);
    const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
    const region = parts.length ? regionOf(parts[0]) : null;
    if (!region) return { region: 'bac', warning: `Vùng không nhận ra: ${s || '(trống)'}` };
    if (parts.length > 1) return { region, warning: `Nhiều vùng, dùng ${parts[0]}` };
    return { region };
  }

  /**
   * Step 1 (or blank/0): yes unless the precondition's "Wake-word:" line says "Không…" / "Nút thoại…".
   * Step 2+: only when that line explicitly names a wake word (e.g. "Wake-word: Hey Vita").
   */
  function wakeWordWanted(step, precondition) {
    const m = /Wake-word:\s*([^\n]*)/i.exec(str(precondition));
    const v = m ? m[1].trim() : '';
    const negative = /^Không/i.test(v) || /Nút thoại/i.test(v);
    if (step > 1) return v !== '' && !negative;
    return !negative;
  }

  function isSpeech(speaker) {
    const s = str(speaker).toLowerCase();
    return !NON_SPEECH.some((w) => s.includes(w));
  }

  function parseSheet(rows) {
    const header = findHeader(rows);
    if (!header) return null;
    const { headerIndex, cols } = header;
    const cell = (r, key) => (cols[key] >= 0 ? str(r[cols[key]]) : '');
    const out = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const utterance = cell(r, 'utterance');
      if (!utterance) continue;
      const warnings = [];

      const stepRaw = cell(r, 'step');
      let step = stepRaw === '' ? 1 : Number(stepRaw);
      if (!Number.isFinite(step)) {
        step = 1;
        warnings.push('Bước không hợp lệ');
      }

      const regionRaw = cell(r, 'region');
      const reg = mapRegion(regionRaw);
      if (reg.warning) warnings.push(reg.warning);

      const speaker = cell(r, 'speaker');
      let speech = isSpeech(speaker);
      if (utterance.length > MAX_TEXT_LEN) {
        speech = false;
        warnings.push(`Câu nói quá ${MAX_TEXT_LEN} ký tự`);
      }

      out.push({
        index: i + 1,
        tcId: cell(r, 'tcId'),
        step,
        title: cell(r, 'title'),
        regionRaw,
        region: reg.region,
        speaker,
        utterance,
        expected: cell(r, 'expected'),
        wakeWord: wakeWordWanted(step, cell(r, 'precondition')),
        speech,
        warnings,
      });
    }
    return out;
  }

  function clipKey(voice, text) {
    return `${String(voice).normalize('NFC')}|${String(text).normalize('NFC').trim().replace(/\s+/g, ' ')}`;
  }

  const PENDING = new Set(['queued', 'waiting', 'active']);

  /** Row state from its clips (missing = undefined): 'err' > 'ok' (all done) > 'wait' (any pending) > 'need'. */
  function rowStatus(clips) {
    const err = clips.find((c) => c && c.status === 'failed');
    if (err) return { s: 'err', error: err.error };
    if (clips.every((c) => c && c.status === 'completed')) return { s: 'ok' };
    if (clips.some((c) => c && PENDING.has(c.status))) return { s: 'wait' };
    return { s: 'need' };
  }

  /**
   * Splits queued clips ({key, voice, text, speed, format}) into batch items and keys that cannot be sent
   * (unknown voice/region) — those would make the whole request fail DTO validation.
   */
  function prepareBatch(clips, regionOf) {
    const items = [];
    const invalid = [];
    for (const c of clips) {
      const region = c.voice ? regionOf(c.voice) : undefined;
      if (!region) invalid.push(c.key);
      else items.push({ key: c.key, item: { text: c.text, voice: c.voice, region, speed: c.speed, format: c.format } });
    }
    return { items, invalid };
  }

  const DEFAULT_SETTINGS = {
    wakeWord: 'Hey Vita', gapAfterWake: 1, gapBetween: 3, speed: 1, format: 'mp3', voiceByRegion: {}, sheet: '', file: '',
  };
  const FORMATS = ['mp3', 'wav'];
  const MAX_WAKE_LEN = 100;

  function numIn(v, def, min, max) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  const strOr = (v, def) => (typeof v === 'string' ? v : def);

  /** Validates settings read back from localStorage; unknown keys dropped, bad values -> defaults/clamped. */
  function sanitizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    const voiceByRegion = {};
    if (s.voiceByRegion && typeof s.voiceByRegion === 'object') {
      for (const r of ['bac', 'trung', 'nam']) {
        if (typeof s.voiceByRegion[r] === 'string') voiceByRegion[r] = s.voiceByRegion[r];
      }
    }
    return {
      wakeWord: strOr(s.wakeWord, d.wakeWord).slice(0, MAX_WAKE_LEN),
      gapAfterWake: numIn(s.gapAfterWake, d.gapAfterWake, 0, 10),
      gapBetween: numIn(s.gapBetween, d.gapBetween, 0, 60),
      speed: numIn(s.speed, d.speed, 0.5, 2),
      format: FORMATS.includes(s.format) ? s.format : d.format,
      voiceByRegion,
      sheet: strOr(s.sheet, d.sheet),
      file: strOr(s.file, d.file),
    };
  }

  return {
    prepareBatch,
    sanitizeSettings,
    DEFAULT_SETTINGS,
    rowStatus,
    findHeader,
    mapRegion,
    wakeWordWanted,
    isSpeech,
    parseSheet,
    clipKey,
    REGION_DEFAULT_VOICES,
    MAX_TEXT_LEN,
  };
});
