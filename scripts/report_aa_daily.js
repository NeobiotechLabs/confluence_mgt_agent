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
  generateTitle, fingerprint, policyHash, parseAppendix,
  computeDiff, diffMetrics, selectPruneCandidates, buildRunId, runMode,
} = require('./report/report_lib');

const REPORT_FOLDER_TITLE = '자동화 리포트';
const PRUNE_INTERVAL_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const items = computeDiff(rawItems, prev ? prev.items : null, todayStr);

  const appendix = {
    v: 1, runAt, runId, mode, policyHash: hash, model, gitSha,
    metrics, items, advisories,
  };
  const html = renderReportStorage({ appendix, deltas, failedMoves, advisories });

  if (dryRun) {
    console.log('\n────── rendered storage format ──────\n');
    console.log(html);
    console.log('\n────── metrics ──────');
    console.log(JSON.stringify({ metrics, deltas, items: items.length, advisories }, null, 2));
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
};
