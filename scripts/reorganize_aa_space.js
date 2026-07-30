// scripts/reorganize_aa_space.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { fetchAATree, fetchAASpaceHomepageId } = require('./utils/aa_space_tree');
const { listAAPages } = require('./utils/aa_pages');
const { classifyWithChain } = require('./classifiers/engine');
const { movePage } = require('./utils/migration_utils');

function fetchAncestors(pageId, byId) {
  const ancestors = [];
  let current = byId.get(pageId)?.parentId;
  let depth = 0;
  while (current && depth < 10) {
    const parent = byId.get(current);
    if (!parent) break;
    ancestors.unshift(parent.title);
    current = parent.parentId;
    depth++;
  }
  return ancestors;
}

function isAtTopLevel(page, homePageId) {
  if (!homePageId) return !page.parentId;
  return page.parentId === homePageId;
}

/**
 * AA 스페이스 재정렬: 휴먼 결정/규칙/AI 분류 체인으로 최상위 고아 페이지를 제 폴더로 이동.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - true면 movePage 호출 금지(판정만)
 * @param {Array}   [opts.pages] - 이미 가져온 페이지 목록(오케스트레이터 공유, 중복 fetch 방지)
 * @param {Object}  [opts.aaTree]
 * @param {string}  [opts.homePageId]
 * @param {Object}  [opts.deps] - { classify, move } 테스트 주입(기본: 실 구현)
 * @returns {Promise<{moved: Array, failed: Array, skippedCount: number, pages: Array, aaTree: Object, homePageId: string|null, degraded?: boolean}>}
 *
 * moved 항목: { page, from, to, source, reason, folderTitle, dryRun }
 * — dry-run/실행 모두 moved에 push하므로 "would move: N" 계수가 정확하다(기존 DRY 카운트 버그 해소).
 * per-page try/catch로 개별 이동 실패는 failed[]에 기록하고 계속 진행한다.
 */
async function runReorganize({ dryRun = false, pages, aaTree, homePageId, deps } = {}) {
  const classify = deps?.classify || classifyWithChain;
  const move = deps?.move || movePage;

  aaTree = aaTree || await fetchAATree();
  if (homePageId === undefined) homePageId = await fetchAASpaceHomepageId('AA');
  pages = pages || await listAAPages();

  // degraded: 홈페이지를 특정할 수 없으면 "최상위"의 기준 자체가 사라진다.
  // 오탐 이동(스페이스 홈페이지 자신을 옮기는 사고 포함)을 막으려고 이동 전체를 스킵한다.
  if (!homePageId) {
    console.warn('⚠️ 스페이스 홈페이지 ID 미해결 — 재정렬 이동 전체를 스킵합니다 (degraded).');
    return { moved: [], failed: [], skippedCount: pages.length, pages, aaTree, homePageId: null, degraded: true };
  }

  const byId = new Map(pages.map(p => [p.id, p]));

  const moved = [];
  const failed = [];
  let skippedCount = 0;

  for (const p of pages) {
    // 폴더 자체는 이동 대상이 아니다
    if (p.labels.includes('is-folder')) { skippedCount++; continue; }
    // P6 자기 배제: 봇이 생성한 리포트 페이지는 이동시키지 않는다
    if (p.labels.includes('bot-report')) { skippedCount++; continue; }
    // Gap 3: 사람이 UI에서 직접 옮긴 페이지 — human-classified 라벨이 있으면 봇이 되돌리지 않음
    if (p.labels.includes('human-classified')) { skippedCount++; continue; }
    // 스페이스 홈페이지는 절대 이동 대상이 아니다 (parentId=null이라 "이미 폴더 안" 휴리스틱으로 걸러지지 않음)
    if (p.id === homePageId) { skippedCount++; continue; }
    // 이미 유효한 폴더 아래 있으면 스킵 (휴리스틱: 최상위가 아님)
    if (p.parentId && !isAtTopLevel(p, homePageId)) { skippedCount++; continue; }

    try {
      const ancestors = fetchAncestors(p.id, byId);
      const ctx = {
        pageId: p.id, title: p.title, body: '',
        ancestors, sourceSpace: 'AA', sourceUrl: '',
        pageDate: '', existingLabels: p.labels,
      };
      const decision = await classify(ctx, aaTree);
      if (!decision.ok || decision.folderId === p.parentId) { skippedCount++; continue; }

      if (!dryRun) await move(p.id, decision.folderId);
      moved.push({
        page: p,
        from: p.parentId,
        to: decision.folderId,
        source: decision.source,
        reason: decision.reason,
        folderTitle: decision.folderTitle,
        dryRun,
      });
    } catch (e) {
      failed.push({ page: p, error: e.message });
    }
  }

  return { moved, failed, skippedCount, pages, aaTree, homePageId };
}

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');
  console.log(`=== Reorganize AA Space (${DRY_RUN ? 'DRY-RUN' : 'EXEC'}) ===`);
  const { moved, failed } = await runReorganize({ dryRun: DRY_RUN });

  for (const m of moved) {
    console.log(`${m.dryRun ? '[DRY]' : '✅'} ${m.page.title}: ${m.from || 'top'} → ${m.to} (source: ${m.source})`);
  }
  for (const f of failed) {
    console.warn(`⚠️ ${f.page.title} move failed: ${f.error}`);
  }
  console.log(`\n${DRY_RUN ? '[DRY] would move' : 'Moved'}: ${moved.length} pages`);
  if (failed.length) console.warn(`Failed: ${failed.length} pages`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runReorganize, fetchAncestors, isAtTopLevel };
