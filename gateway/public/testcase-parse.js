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

  function wakeWordWanted(step, precondition) {
    if (step > 1) return false;
    const m = /Wake-word:\s*([^\n]*)/i.exec(str(precondition));
    if (!m) return true;
    const v = m[1].trim();
    return !(/^Không/i.test(v) || /Nút thoại/i.test(v));
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

  return {
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
