// scripts/report_aa_daily.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execSync } = require('child_process');
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree, fetchAASpaceHomepageId } = require('./utils/aa_space_tree');
const { listAAPages } = require('./utils/aa_pages');
const { createPage, addLabels } = require('./utils/migration_utils');
const { runAudit } = require('./audit_aa_space');
const { runReorganize } = require('./reorganize_aa_space');
const { renderReportStorage } = require('./report/render');
const {
  kstNow, kstStamp, kstYYMMDD, kstHHMM,
  generateTitle, fingerprint, policyHash, parseAppendix, detectRuleChange,
  computeDiff, diffMetrics, selectPruneCandidates, buildRunId, runMode,
  matchAgainstKnowledgeBase, findUnmatchedPages,
} = require('./report/report_lib');
const { loadUnmatchedState, saveUnmatchedState } = require('./report/unmatched_state_io');

const REPORT_FOLDER_TITLE = '자동화 리포트';
const PRUNE_INTERVAL_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── runUnmatchedMerge (작업 8 I/O 와이어업) ──────────────────────────────────
// 오케스트레이터용 통합 헬퍼.
//   1. KB 파일 로드 — 부재/깨짐 모두 graceful (kbError=null, 빈 rules 취급)
//   2. loadUnmatchedState(statePath) — 없으면 []
//   3. computeUnmatchedItems(pages, kb, todayStr, {unsortedFolderId, prevState})
//   4. 실실행이면 saveUnmatchedState(statePath, items) — 실패해도 throw 안 함
//   5. 부록 items[]에 그대로 들어갈 수 있는 {items, saveError, kbError} 반환
//
// pages = listAAPages 결과.
// dry-run에서는 saveUnmatchedState 호출 안 함 (= statePath가 가리키는 경로에
// 부모 디렉터리가 없어도 안전).
/**
 * @param {{kbPath:string, statePath:string, pages:Array, todayStr:string,
 *           unsortedFolderId:string, dryRun?:boolean}} opts
 * @returns {{items:Array, saveError:(string|null), kbError:(string|null)}}
 */
function runUnmatchedMerge(opts) {
  const o = opts || {};
  const { kbPath, statePath, pages, todayStr, unsortedFolderId, dryRun } = o;

  // 1) KB 로드 (graceful)
  let kb = { rules: [] };
  const kbError = null; // 정책: 어떤 실패도 kbError=null — 빈 rules로 처리
  try {
    const txt = require('fs').readFileSync(kbPath, 'utf8');
    const parsed = JSON.parse(txt);
    if (parsed && Array.isArray(parsed.rules)) kb = parsed;
  } catch { /* 파일 부재/깨짐 → empty KB */ }

  // 2) prev 로드
  const prevState = loadUnmatchedState(statePath);

  // 3) compute
  const items = computeUnmatchedItems(pages, kb, todayStr,
    { unsortedFolderId, prevState });

  // 4) dry-run이 아니면 save — 실패해도 절대 throw 하지 않는다 (심박 P1)
  let saveError = null;
  if (!dryRun && items.length > 0) {
    try {
      saveUnmatchedState(statePath, items);
    } catch (e) {
      saveError = `unmatched_pages.json 저장 실패: ${e.message}`;
      console.warn(`⚠️ ${saveError}`);
    }
  }

  return { items, saveError, kbError };
}
/**
 * unsortedFolderId에 부모가 있는 페이지를 KB(SSOT 룰)와 대조.
 * - 매칭 실패 = KB가 모르는 페이지 = 미매칭 → items[] kind:'unmatched'로 부록 진입.
 * - catch_all_known이 흡수하면 "매칭 성공"으로 본다(보고 누락 아님).
 * - 입력 pages/prevState는 변형하지 않는다.
 * @param {Array<{id:string,title:string,parentId:string,ancestors?:string[]}>} pages
 * @param {{rules: Array}} kb
 * @param {string} todayStr "YYYY-MM-DD" (KST 실행일)
 * @param {{unsortedFolderId:string, prevState: Array|null}} opts
 * @returns {Array<{kind:'unmatched', fingerprint:string, titleSnapshot:string, sourceSpace:string, seenCount:number, firstSeen:string, lastSeen:string}>}
 */
function computeUnmatchedItems(pages, kb, todayStr, opts) {
  const { unsortedFolderId, prevState } = opts || {};
  if (!Array.isArray(pages) || pages.length === 0) return [];
  if (!kb || !Array.isArray(kb.rules) || kb.rules.length === 0) return [];
  if (typeof unsortedFolderId !== 'string' || !unsortedFolderId) return [];

  const candidates = pages.filter(p => p && p.parentId === unsortedFolderId);
  if (candidates.length === 0) return [];

  const cur = [];
  for (const page of candidates) {
    const ancestors = Array.isArray(page.ancestors) ? page.ancestors : [];
    const hit = matchAgainstKnowledgeBase(
      { title: page.title || '', ancestors }, kb);
    // 매칭 결과 의미:
    //   - hit === null          → KB에 catch_all도 없음 = 진짜 미매칭
    //   - hit.categoryId === 'catch_all_known' → 명시 카테고리 매칭 실패 + catch_all 흡수
    //                                  = "룰 추가 후보" (누락 가시화의 대상)
    //   - 그 외                  → 명시 카테고리 매칭 성공 = 정상 (unmatched 아님)
    if (hit === null) {
      const fp = fingerprint('unmatched', page.id, unsortedFolderId);
      cur.push({
        kind: 'unmatched',
        fingerprint: fp,
        titleSnapshot: page.title || '',
        sourceSpace: 'unknown',
      });
    } else if (hit.categoryId === 'catch_all_known') {
      const fp = fingerprint('unmatched', page.id, unsortedFolderId);
      cur.push({
        kind: 'unmatched',
        fingerprint: fp,
        titleSnapshot: page.title || '',
        sourceSpace: hit.sourceSpace || '*',
      });
    }
    // 명시 카테고리 매칭 → 건너뜀
  }
  if (cur.length === 0) return [];
  return findUnmatchedPages(cur, prevState, todayStr);
}

// ── read-only 헬퍼 ──────────────────────────────────────────────────────────
async function cqlSearch(cql, limit = 100) {
  const res = await confluenceRequest(
    'GET', `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}`);
  return res.results || [];
}

async function fetchSpaceId() {
  const sp = await confluenceRequest('GET', '/wiki/api/v2/spaces?keys=AA');
  return sp?.results?.[0]?.id || null;
}

/** 직전 리포트(제목 내림차순 1건)의 부록을 파싱. 없음→null(정상), 파싱실패→null+advisory */
async function fetchPreviousReport(advisories) {
  try {
    const hits = await cqlSearch(
      'space="AA" and label="auto-report" and type=page order by title desc', 1);
    if (hits.length === 0) return null; // 최초 실행 — 경고 아님
    const page = await confluenceRequest(
      'GET', `/wiki/api/v2/pages/${hits[0].id}?body-format=storage`);
    const html = page.body?.storage?.value || '';
    const prev = parseAppendix(html);
    if (!prev) advisories.push(`직전 리포트("${hits[0].title}") 부록 파싱 실패 — 전일 대비를 "—"로 표시합니다.`);
    return prev;
  } catch (e) {
    advisories.push(`직전 리포트 조회 실패: ${e.message}`);
    return null;
  }
}

// ── 보관(prune): auto-report 라벨 + 제목 정규식 이중 확인, 최근 7개 보존 ─────
async function pruneOldReports(dryRun) {
  try {
    const hits = await cqlSearch(
      'space="AA" and label="auto-report" and type=page', 200);
    const { prune } = selectPruneCandidates(
      hits.map(h => ({ id: h.id, title: h.title })), new Date());
    for (const r of prune) {
      if (dryRun) {
        console.log(`[DRY] would prune: ${r.title}`);
        continue;
      }
      try {
        await confluenceRequest('DELETE', `/wiki/rest/api/content/${r.id}`);
        console.log(`🗑 pruned: ${r.title}`);
      } catch (e) {
        console.warn(`⚠️ prune failed for ${r.title}: ${e.message}`);
      }
      await sleep(PRUNE_INTERVAL_MS);
    }
    if (prune.length) console.log(`Prune: ${prune.length} old report(s) ${dryRun ? '(dry-run)' : 'deleted'}.`);
  } catch (e) {
    console.warn(`⚠️ pruneOldReports skipped: ${e.message}`);
  }
}

// ── 폴더 보장: is-folder CQL → 메모리/조회 정확 매칭 → 없으면 생성 ──────────
async function ensureReportFolder(spaceId, homePageId, pages, dryRun) {
  const inMem = pages.find(p =>
    p.labels.includes('is-folder') && p.title === REPORT_FOLDER_TITLE);
  if (inMem) return inMem.id;

  const hits = await cqlSearch('space="AA" and label="is-folder" and type=page', 200);
  const hit = hits.find(h => h.title === REPORT_FOLDER_TITLE);
  if (hit) return hit.id;

  if (dryRun) {
    console.log(`[DRY] would create report folder "${REPORT_FOLDER_TITLE}"`);
    return null;
  }
  const created = await createPage(spaceId, homePageId, REPORT_FOLDER_TITLE,
    '<p>자동화 봇이 생성한 폴더입니다. 일일 리포트를 보관합니다.</p>');
  await addLabels(created.id, ['is-folder', 'bot-report']).catch(() => {});
  console.log(`📁 Created report folder: ${REPORT_FOLDER_TITLE} (${created.id})`);
  return created.id;
}

// ── 제목 멱등성: 동일 시각 제목 충돌 시 _2, _3 ... ──────────────────────────
async function pickUniqueTitle(yymmdd, hhmm) {
  const candidates = [generateTitle(yymmdd, hhmm)];
  for (let s = 2; s <= 10; s++) candidates.push(generateTitle(yymmdd, hhmm, s));
  for (const t of candidates) {
    const hits = await cqlSearch(`space="AA" and title="${t}" and type=page`, 1);
    if (hits.length === 0) return t;
  }
  return `${generateTitle(yymmdd, hhmm)}_${process.pid}`;
}

function localGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return 'unknown'; }
}

// ── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== AA Daily Report (${dryRun ? 'DRY-RUN' : 'EXEC'}) ===`);

  // 1) 실행 메타
  const kst = kstNow();
  const runAt = kstStamp(kst);
  const todayStr = runAt.slice(0, 10);
  const runId = buildRunId();
  const mode = runMode();
  const hash = policyHash();
  const gitSha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : localGitSha();
  const model = process.env.ANTHROPIC_MODEL
    || (process.env.ANTHROPIC_API_KEY ? 'claude(env default)' : 'off(rule-only)');

  const advisories = [];

  // 2) 보관 (dry-run: 로그만)
  await pruneOldReports(dryRun);

  // 3) 공유 데이터 1회 fetch
  const [aaTree, homePageId, spaceId, pages] = await Promise.all([
    fetchAATree(),
    fetchAASpaceHomepageId('AA'),
    fetchSpaceId(),
    listAAPages(),
  ]);

  // 4) audit — 실패해도 리포트는 계속 (심박 P1)
  let audit = { topLevel: [], humanMoves: [], errors: [] };
  try {
    audit = await runAudit({ dryRun, pages, aaTree, homePageId });
    if (audit.errors?.length) advisories.push(`감사 페이지별 오류 ${audit.errors.length}건`);
  } catch (e) {
    advisories.push(`감사(audit) 실행 실패: ${e.message}`);
    console.error('audit failed:', e.message);
  }

  // 5) reorganize — 실패해도 리포트는 계속
  let reorg = { moved: [], failed: [] };
  try {
    reorg = await runReorganize({ dryRun, pages, aaTree, homePageId });
    if (reorg.degraded) advisories.push('재정렬 이동 스킵: 스페이스 홈페이지 ID 미해결 (degraded 모드).');
  } catch (e) {
    advisories.push(`재정렬(reorganize) 실행 실패: ${e.message}`);
    console.error('reorganize failed:', e.message);
  }

  // 6) metrics (이동분 보정: 미분류→폴더 이동은 실행 후 기준으로 집계)
  const movedFromUnsorted = reorg.moved.filter(m => m.from === aaTree.unsortedFolderId).length;
  const movedToUnsorted = reorg.moved.filter(m => m.to === aaTree.unsortedFolderId).length;
  const unclassifiedCount = pages.filter(p => p.parentId === aaTree.unsortedFolderId).length
    - movedFromUnsorted + movedToUnsorted;
  const failedMoves = reorg.failed.map(f => ({ title: f.page.title, error: f.error }));
  const topLevelOrphans = audit.topLevel.length;
  const metrics = {
    aaPageCount: pages.length,
    topLevelOrphans,
    unclassifiedCount,
    movesB: reorg.moved.length,
    advisories: advisories.length,
    actionRequiredCount: (topLevelOrphans > 0 ? 1 : 0) + failedMoves.length + advisories.length,
  };

  // 7) 직전 리포트 → delta
  const prev = await fetchPreviousReport(advisories);
  const deltas = diffMetrics(metrics, prev ? prev.metrics : null);

  // 7-1) 룰 해시 변동 감지 (작업 5): 직전 부록의 policyHash와 오늘 hash가 다르면 §5 알림 1줄.
  // — 비교 가능: prev 있고 prev.policyHash가 8자 문자열. 변경 없음: same hash. 첫 리포트: prev null.
  const ruleAdvisory = detectRuleChange(prev?.policyHash, hash, runAt.slice(0, 10));
  if (ruleAdvisory) advisories.push(ruleAdvisory);

  // 8) items + fingerprint + diff(seenCount) → 렌더
  const rawItems = reorg.moved.map(m => ({
    kind: 'move-b',
    pageId: m.page.id,
    title: m.page.title,
    fromFolderId: m.from,
    toFolderId: m.to,
    source: m.source,
    reason: m.reason,
    actionRequired: false,
    fingerprint: fingerprint('move-b', m.page.id, m.to),
  }));
  const movedItems = computeDiff(rawItems, prev ? prev.items : null, todayStr);

  // 8-1) 미매칭 추적 (작업 8): KB 룰 vs unsorted 부모 페이지 비교 → 부록 items 머지
  // — reference/unmatched_pages.json SSOT. dry-run이면 디스크 미쓰기.
  const KB_PATH = require('path').join(__dirname, '..', 'config', 'analysis_rules.json');
  const UNMATCHED_STATE_PATH = require('path').join(__dirname, '..', 'reference', 'unmatched_pages.json');
  const merge = runUnmatchedMerge({
    kbPath: KB_PATH, statePath: UNMATCHED_STATE_PATH, pages,
    todayStr, unsortedFolderId: aaTree.unsortedFolderId, dryRun,
  });
  if (merge.saveError) advisories.push(merge.saveError);

  // moved(이동 로그)와 unmatched(룰 추가 후보)를 부록 items에 머지
  const items = movedItems.concat(merge.items);

  const appendix = {
    v: 1, runAt, runId, mode, policyHash: hash, model, gitSha,
    metrics, items, advisories,
  };
  const html = renderReportStorage({ appendix, deltas, failedMoves, advisories });

  if (dryRun) {
    console.log('\n────── rendered storage format ──────\n');
    console.log(html);
    console.log('\n────── metrics ──────');
    console.log(JSON.stringify({ metrics, deltas, items: items.length, advisories, unmatchedItems: merge.items.length }, null, 2));
    console.log('\n[DRY] no Confluence writes performed.');
    process.exitCode = 0;
    return;
  }

  // 9) 폴더 보장 → 제목 충돌 회피 → POST (1회 재시도)
  const folderId = await ensureReportFolder(spaceId, homePageId, pages, dryRun);
  if (!spaceId || !folderId) {
    console.error('❌ Cannot post report: spaceId or report folder unavailable.');
    process.exitCode = 1;
    return;
  }
  const title = await pickUniqueTitle(kstYYMMDD(kst), kstHHMM(kst));

  let posted = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      posted = await createPage(spaceId, folderId, title, html);
      break;
    } catch (e) {
      console.error(`Report POST attempt ${attempt} failed: ${e.message}`);
      if (attempt < 2) await sleep(1000);
    }
  }

  if (posted) {
    await addLabels(posted.id, ['bot-report', 'auto-report'])
      .catch(e => console.warn(`⚠️ label attach failed: ${e.message || e}`));
    console.log(`✅ Report posted: ${title} → ${posted.webUrl}`);
  }

  // 10) 종료 코드 = 리포트 POST 성패 (audit/reorganize 부분 실패는 exit 0 유지)
  process.exitCode = posted ? 0 : 1;
}

if (require.main === module) {
  main().catch(e => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  });
}

module.exports = {
  main, cqlSearch, fetchPreviousReport, pruneOldReports,
  ensureReportFolder, pickUniqueTitle,
  computeUnmatchedItems,
  runUnmatchedMerge,
};
