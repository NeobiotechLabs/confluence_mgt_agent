// scripts/report/report_lib.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APPENDIX_MARKER = '<!-- aa-report-appendix:v1 -->';
const TITLE_RE = /^auto_report_(\d{6})_(\d{4})(?:_(\d+))?$/;
const CONFIG_FILES = ['classification_decisions.json', 'analysis_rules.json'];

// ── KST 시각 (UTC+9 명시 계산 — self-hosted 러너 TZ에 의존하지 않음) ──────────
function kstNow(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000);
}
/** KST wall-clock "2026-07-30 09:00" (shifted Date를 UTC로 취급해 slice) */
function kstStamp(d) {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}
/** "260730" */
function kstYYMMDD(d) {
  return d.toISOString().slice(2, 10).replace(/-/g, '');
}
/** "0900" */
function kstHHMM(d) {
  return d.toISOString().slice(11, 16).replace(':', '');
}

// ── 제목 ────────────────────────────────────────────────────────────────────
function generateTitle(yymmdd, hhmm, suffix) {
  return suffix ? `auto_report_${yymmdd}_${hhmm}_${suffix}` : `auto_report_${yymmdd}_${hhmm}`;
}

/**
 * 리포트 제목을 파싱. 매칭 안 되거나 날짜가 부정확(2월 31일 등)하면
 * date=null → prune 후보에서 영구 제외(오폭 방지).
 * @returns {{yymmdd:string, hhmm:string, suffix:number|null, date:Date|null}|null}
 */
function parseReportTitle(title) {
  const m = TITLE_RE.exec(title || '');
  if (!m) return null;
  const [, yymmdd, hhmm, suf] = m;
  const yy = +yymmdd.slice(0, 2), mm = +yymmdd.slice(2, 4), dd = +yymmdd.slice(4, 6);
  const date = new Date(Date.UTC(2000 + yy, mm - 1, dd));
  const valid = date.getUTCFullYear() === 2000 + yy
    && date.getUTCMonth() === mm - 1
    && date.getUTCDate() === dd;
  return { yymmdd, hhmm, suffix: suf ? +suf : null, date: valid ? date : null };
}

// ── 해시 ────────────────────────────────────────────────────────────────────
/** 항목 식별자: sha1(kind|pageId|folderId) 앞 12자. 결정적. */
function fingerprint(kind, pageId, folderId) {
  return crypto.createHash('sha1')
    .update(`${kind}|${pageId}|${folderId ?? ''}`)
    .digest('hex').slice(0, 12);
}

/** 정책 소스(config JSON)의 sha256 앞 8자. 파일 부재는 구분자로 기록(결정적). */
function policyHash(configDir) {
  const dir = configDir || path.join(__dirname, '..', '..', 'config');
  const h = crypto.createHash('sha256');
  for (const f of CONFIG_FILES) {
    try {
      h.update(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      h.update(`__missing__:${f}`);
    }
  }
  return h.digest('hex').slice(0, 8);
}

// ── 부록(appendix) ──────────────────────────────────────────────────────────
/**
 * 직전 리포트의 storage HTML에서 기계 부록 JSON을 파싱.
 * 1차: 마커 주석 이후의 첫 CDATA. 2차: 마커가 없어도(Confluence가 저장 시
 * HTML 주석을 제거하는 경우 대비) 스키마 형태(v===1 && runId)로 CDATA 탐색.
 * 전부 실패(사람이 편집 등) → null (크래시 없이 우아 퇴화).
 */
function parseAppendix(html) {
  if (typeof html !== 'string') return null;
  const at = html.indexOf(APPENDIX_MARKER);
  const searchFrom = at >= 0 ? html.slice(at) : html;
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(searchFrom)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === 'object' && obj.v === 1 && obj.runId !== undefined) return obj;
    } catch { /* 다음 CDATA 계속 탐색 */ }
  }
  return null;
}

// ── diff ────────────────────────────────────────────────────────────────────
/**
 * 항목 diff: fingerprint 매칭 시 seenCount+1 · firstSeen 승계, 신규는 seenCount=1.
 * 입력은 변형하지 않는다.
 * @param {Array<{fingerprint:string}>} curItems
 * @param {Array<{fingerprint:string, seenCount?:number, firstSeen?:string}>|null} prevItems
 * @param {string} todayStr "YYYY-MM-DD" (KST 실행일)
 */
function computeDiff(curItems, prevItems, todayStr) {
  const prevByFp = new Map((prevItems || [])
    .filter(it => it && it.fingerprint)
    .map(it => [it.fingerprint, it]));
  return (curItems || []).map(it => {
    const prev = prevByFp.get(it.fingerprint);
    if (!prev) return { ...it, seenCount: 1, firstSeen: it.firstSeen || todayStr };
    return {
      ...it,
      seenCount: (typeof prev.seenCount === 'number' ? prev.seenCount : 1) + 1,
      firstSeen: prev.firstSeen || todayStr,
    };
  });
}

/**
 * 메트릭 delta: prev 없으면 전부 null(렌더 시 "—").
 * @returns {Object<string, number|null>}
 */
function diffMetrics(cur, prev) {
  if (!prev || typeof prev !== 'object') {
    return Object.fromEntries(Object.keys(cur).map(k => [k, null]));
  }
  const out = {};
  for (const k of Object.keys(cur)) {
    out[k] = (typeof prev[k] === 'number' && typeof cur[k] === 'number') ? cur[k] - prev[k] : null;
  }
  return out;
}

// ── prune ───────────────────────────────────────────────────────────────────
/**
 * 삭제 후보 선정(순수 로직). 안전장치:
 * - 제목 패턴 비매칭/부정확한 날짜 → 절대 삭제 안 함
 * - 제목 내림차순(=시간순) 최근 keepMin개는 무조건 보존
 * - 경과일 > maxAgeDays만 삭제
 * @param {Array<{id:string, title:string}>} reports - label=auto-report로 조회된 것(호출자 책임)
 * @param {Date} now
 * @returns {{prune: Array, keep: Array}}
 */
function selectPruneCandidates(reports, now, { maxAgeDays = 31, keepMin = 7 } = {}) {
  const parsed = [];
  for (const r of reports || []) {
    const meta = parseReportTitle(r.title);
    if (!meta || !meta.date) continue;
    parsed.push({ ...r, meta });
  }
  parsed.sort((a, b) => (a.title < b.title ? 1 : a.title > b.title ? -1 : 0));

  const keepRecent = new Set(parsed.slice(0, Math.max(0, keepMin)).map(r => r.id));
  const prune = [];
  const keep = [];
  for (const r of parsed) {
    const ageDays = (now.getTime() - r.meta.date.getTime()) / 86400000;
    if (!keepRecent.has(r.id) && ageDays > maxAgeDays) prune.push(r);
    else keep.push(r);
  }
  return { prune, keep };
}

// ── 실행 메타 ───────────────────────────────────────────────────────────────
function buildRunId(env = process.env) {
  return env.GITHUB_RUN_ID ? `${env.GITHUB_RUN_ID}#${env.GITHUB_RUN_ATTEMPT || '1'}` : '0#0';
}
function runMode(env = process.env) {
  return env.GITHUB_ACTIONS ? 'ci' : 'local';
}

module.exports = {
  APPENDIX_MARKER,
  kstNow, kstStamp, kstYYMMDD, kstHHMM,
  generateTitle, parseReportTitle,
  fingerprint, policyHash,
  parseAppendix, computeDiff, diffMetrics,
  selectPruneCandidates,
  buildRunId, runMode,
};
