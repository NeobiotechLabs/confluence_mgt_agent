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

/**
 * 룰 해시 변동 감지. prev(직전 리포트)와 curr(오늘)가 다르면 §5 advisory 1줄.
 * - prev가 없음(첫 리포트): 비교 대상 없음 → null (의심하지 않음).
 * - curr가 없음(방어): null (현실적으로 발생 불가).
 * - prev === curr: 변경 없음 → null.
 * - 그 외: advisory 반환.
 */
function detectRuleChange(prevHash, currHash, todayStr) {
  if (!prevHash || !currHash) return null;
  if (prevHash === currHash) return null;
  return `⚠️ 룰 변경 감지: ${prevHash} → ${currHash} (${todayStr})`;
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

// ── 룰 베이스(KB) 매칭 ──────────────────────────────────────────────────────
/**
 * KB(SSOT 카테고리 매칭) + 공통 룰을 페이지에 적용한다.
 *   - 명시적 카테고리가 매칭되면 is_catch_all은 무시된다.
 *   - exclude(title_patterns)에 걸리면 그 카테고리는 매칭 실패로 처리.
 *   - 모든 명시 카테고리 실패 + catch_all 존재 → catch_all로 흡수.
 *   - 그 외(둘 다 없음) → null.
 * @param {{title:string, ancestors:string[]}|null} page
 * @param {{rules: Array<{id:string, is_catch_all?:boolean, sourceSpace?:string, match?:{title_patterns?:string[], any?:Array<{title_patterns?:string[], ancestor_contains?:string}>}, exclude?:{title_patterns?:string[]}}>}} kb
 * @returns {{categoryId:string, sourceSpace?:string}|null}
 */
function matchAgainstKnowledgeBase(page, kb) {
  if (!page || !kb || !Array.isArray(kb.rules) || kb.rules.length === 0) return null;
  const title = page.title || '';
  const ancestors = Array.isArray(page.ancestors) ? page.ancestors : [];
  const explicit = kb.rules.filter(r => !r.is_catch_all);
  const catchAll = kb.rules.find(r => r.is_catch_all) || null;

  for (const rule of explicit) {
    if (matchesRule(rule, title, ancestors)) {
      return { categoryId: rule.id, sourceSpace: rule.sourceSpace };
    }
  }
  if (catchAll) return { categoryId: catchAll.id, sourceSpace: catchAll.sourceSpace };
  return null;
}

function matchesRule(rule, title, ancestors) {
  if (isExcluded(rule, title)) return false;
  return matchesAny(rule.match, title, ancestors);
}

function isExcluded(rule, title) {
  const excludes = rule.exclude && Array.isArray(rule.exclude.title_patterns)
    ? rule.exclude.title_patterns : null;
  if (!excludes) return false;
  return excludes.some(pat => new RegExp(pat).test(title));
}

function matchesAny(match, title, ancestors) {
  if (!match) return false;
  // any[...]가 있으면 그 중 하나라도 매칭되면 매칭.
  if (Array.isArray(match.any) && match.any.length > 0) {
    return match.any.some(branch => matchesBranch(branch, title, ancestors));
  }
  // 없으면 title_patterns만 검사.
  if (Array.isArray(match.title_patterns) && match.title_patterns.length > 0) {
    return match.title_patterns.some(pat => new RegExp(pat).test(title));
  }
  return false;
}

function matchesBranch(branch, title, ancestors) {
  if (Array.isArray(branch.title_patterns) && branch.title_patterns.length > 0) {
    if (branch.title_patterns.some(pat => new RegExp(pat).test(title))) return true;
  }
  if (typeof branch.ancestor_contains === 'string' && branch.ancestor_contains) {
    if (ancestors.some(a => (a || '').includes(branch.ancestor_contains))) return true;
  }
  return false;
}

// ── 미매칭(누락) 추적 머지 ──────────────────────────────────────────────────
/**
 * 오늘의 미매칭(unmatched) 항목 리스트를 직전 머지 산출물에 append-only로 머지.
 * - fingerprint 매칭: seenCount+1, lastSeen=todayStr, firstSeen 보존.
 * - fingerprint 신규: seenCount=1, firstSeen=lastSeen=todayStr.
 * - prev에만 있는 fingerprint: out에서 빠짐(오늘 누락이 아니므로).
 * - 입력은 변형하지 않는다.
 * @param {Array<{fingerprint:string}>} curItems
 * @param {Array<{fingerprint:string, seenCount?:number, firstSeen?:string}>|null} prevItems
 * @param {string} todayStr "YYYY-MM-DD"
 */
function findUnmatchedPages(curItems, prevItems, todayStr) {
  const prevByFp = new Map((prevItems || [])
    .filter(it => it && it.fingerprint)
    .map(it => [it.fingerprint, it]));
  return (curItems || [])
    .filter(it => it && it.fingerprint)
    .map(it => {
      const prev = prevByFp.get(it.fingerprint);
      if (!prev) {
        return { ...it, seenCount: 1, firstSeen: todayStr, lastSeen: todayStr };
      }
      return {
        ...it,
        seenCount: (typeof prev.seenCount === 'number' ? prev.seenCount : 1) + 1,
        firstSeen: prev.firstSeen || todayStr,
        lastSeen: todayStr,
      };
    });
}

// ── §4 AI 권고판 (작업 9, Phase 2-A) ─────────────────────────────────────────
// 정책 출처: reference/classification_rules.md §8 (사용자 결정 2026-07-30)

/**
 * LLM reason 문자열에서 어휘 가중치로 신뢰도 산출 (결정적·테스트 가능).
 * - base = 0.5 (어떤 키워드도 매칭 안 되면 "중립 의심" → 부록 진입 기준 충족)
 * - 어휘 가중치: 정확히/일치/정확/매칭됨 +0.35, 유사/probably/likely +0.20,
 *   maybe/could be/아마/모호 +0.05, 불확실/unknown/분류 불가 -0.20
 * - 동일 어휘가 여러 번 나와도 한 번만 가산 (덧셈 셋)
 * - 최종 점수 = clamp(0, 1, base + Σ가중치)
 * @param {*} reason
 * @returns {number} 0~1
 */
function computeConfidenceScore(reason) {
  const s = typeof reason === 'string' ? reason : '';
  // 같은 가중치 그룹 내에서는 한 번만 가산 (substring 중복 방지: '정확히' 안의 '정확'은 별도 카운트 X)
  const POS_STRONG = ['정확히', '일치', '매칭됨'];
  const POS_MID = ['유사', 'probably', 'likely'];
  const POS_WEAK = ['maybe', 'could be', '아마', '모호'];
  const NEG = ['불확실', 'unknown', '분류 불가'];
  let score = 0.5;
  for (const w of POS_STRONG) if (s.includes(w)) { score += 0.35; break; }
  for (const w of POS_MID) if (s.includes(w)) { score += 0.20; break; }
  for (const w of POS_WEAK) if (s.includes(w)) { score += 0.05; break; }
  for (const w of NEG) if (s.includes(w)) { score -= 0.20; break; }
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return score;
}

/**
 * items 중 seenCount >= threshold(정수)인 것만 반환. 입력은 변형하지 않음.
 * @param {Array<{seenCount?:number}>} items
 * @param {number} threshold
 * @returns {Array}
 */
function selectRepeatAmbiguous(items, threshold) {
  const t = (typeof threshold === 'number' && threshold > 0) ? threshold : 0;
  return (items || []).filter(it => it && typeof it.seenCount === 'number' && it.seenCount >= t);
}

/**
 * 오배치 의심 항목 구성.
 * 입력:
 *   pages = [{id, title, parentId, ancestors}]
 *   history = 직전 부록 중 kind:'misplacement-suspect' 항목 배열 (있으면 seenCount 승계/firstSeen 보존)
 *   opts = {
 *     todayStr: 'YYYY-MM-DD',
 *     categoryOf: (page) => string | null,         // KB 매칭 카테고리 폴더 ID (없으면 null = 권고 안 함)
 *     suggestedFolderFor: (page) => string | null, // 추천 폴더 ID (categoryOf와 일치 가정)
 *     reasonFor: (page) => string,                // LLM reason 문자열
 *     confidenceThreshold?: number (기본 0.5),
 *   }
 * 출력:
 *   [{kind:'misplacement-suspect', pageId, title, currentFolderId, currentFolderTitle?,
 *     suggestedFolderId, suggestedFolderTitle?, confidence, confidenceReason,
 *     seenCount, firstSeen, lastSeen}, ...]
 *
 * 부록 진입 조건:
 *   - categoryOf(page) !== null (KB가 카테고리를 안다)
 *   - categoryOf(page) !== page.parentId (현재 폴더와 다름)
 *   - computeConfidenceScore(reason) >= confidenceThreshold (잡음 제거)
 */
function recommendMisplacements(pages, history, opts) {
  const o = opts || {};
  if (!Array.isArray(pages) || pages.length === 0) return [];
  const todayStr = o.todayStr || '';
  const categoryOf = typeof o.categoryOf === 'function' ? o.categoryOf : () => null;
  const suggestedFolderFor = typeof o.suggestedFolderFor === 'function'
    ? o.suggestedFolderFor : (p) => categoryOf(p);
  const reasonFor = typeof o.reasonFor === 'function' ? o.reasonFor : () => '';
  const threshold = (typeof o.confidenceThreshold === 'number') ? o.confidenceThreshold : 0.5;

  const prevByFp = new Map((history || [])
    .filter(it => it && it.fingerprint)
    .map(it => [it.fingerprint, it]));

  const out = [];
  for (const page of pages) {
    if (!page || !page.id) continue;
    const category = categoryOf(page);
    if (!category) continue; // 카테고리 모르면 권고 안 함 (Phase 3 자리표시)
    if (category === page.parentId) continue; // 이미 일치
    const reason = reasonFor(page);
    const confidence = computeConfidenceScore(reason);
    if (confidence < threshold) continue;
    const suggestedFolderId = suggestedFolderFor(page) || category;
    const fp = fingerprint('misplacement-suspect', page.id, page.parentId);
    const prev = prevByFp.get(fp);
    const seenCount = prev ? ((typeof prev.seenCount === 'number' ? prev.seenCount : 1) + 1) : 1;
    const firstSeen = prev?.firstSeen || todayStr;
    out.push({
      kind: 'misplacement-suspect',
      fingerprint: fp,
      pageId: page.id,
      title: page.title || '',
      currentFolderId: page.parentId,
      suggestedFolderId,
      confidence,
      confidenceReason: `keywords: ${reason.slice(0, 80)}`,
      seenCount,
      firstSeen,
      lastSeen: todayStr,
    });
  }
  return out;
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
  fingerprint, policyHash, detectRuleChange,
  parseAppendix, computeDiff, diffMetrics,
  selectPruneCandidates,
  matchAgainstKnowledgeBase, findUnmatchedPages,
  computeConfidenceScore, selectRepeatAmbiguous, recommendMisplacements,
  buildRunId, runMode,
};
