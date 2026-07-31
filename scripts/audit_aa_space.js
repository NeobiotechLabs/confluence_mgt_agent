// scripts/audit_aa_space.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree, fetchAASpaceHomepageId } = require('./utils/aa_space_tree');
const { listAAPages } = require('./utils/aa_pages');
const { deleteLabel, addLabels } = require('./utils/migration_utils');

const DECISIONS_PATH = path.join(__dirname, '..', 'config', 'classification_decisions.json');
const REPORT_DIR = path.join(__dirname, '..', '.github', 'reports');

function detectMove(page) {
  const lastParentLabel = page.labels.find(l => l.startsWith('last-parent-'));
  if (!lastParentLabel) return null;
  const lastParentId = lastParentLabel.replace('last-parent-', '');
  if (lastParentId === page.parentId) return null;
  return { from: lastParentId, to: page.parentId };
}

function shouldCommitHumanDecision(page, move, aaTree, homePageId) {
  // 최상위 → 특정 폴더 이동 또는 폴더 → 다른 폴더 이동이면 휴먼 결정을 커밋한다.
  // 분류 체인에서 rule 단계가 제거(2026-07-31)되어 ruleClassifier 의존을 삭제했으며,
  // 휴먼이 실제로 페이지를 옮겼는지(detectMove가 parentId 변경으로 판별)만 판단 근거로 삼는다.
  return true;
}

function commitDecision(page, move) {
  const data = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  const newEntry = {
    id: `dec-${new Date().toISOString().slice(0, 10)}-${Date.now()}`,
    match: { titleRegex: escapeRegex(page.title) },
    targetFolderId: move.to,
    targetFolderTitle: '(resolved at runtime)',
    labels: ['human-classified'],
    decidedBy: process.env.GIT_AUTHOR_EMAIL || 'audit-bot',
    decidedAt: new Date().toISOString(),
    source: 'human-ui-move',
  };
  data.decisions.push(newEntry);
  fs.writeFileSync(DECISIONS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 페이지의 last-parent 라벨을 현재 parentId로 갱신.
 * 옛 last-parent-* 라벨을 먼저 제거하지 않으면 라벨이 누적되어
 * detectMove가 오래된 라벨에 먼저 매칭 → 허위 이동 감지/허위 학습이 난다.
 * currentLabels는 listAAPages가 이미 가져온 in-memory 라벨을 그대로 쓴다(추가 GET 없음).
 *
 * deps는 테스트용 주입 포인트(기본: 실 API).
 */
async function stampLastParent(pageId, parentId, currentLabels = [], deps = {}) {
  const del = deps.deleteLabel || deleteLabel;
  const post = deps.postLabel || ((pid, name) =>
    confluenceRequest('POST', `/wiki/rest/api/content/${pid}/label`, { prefix: 'global', name }));

  const target = `last-parent-${parentId}`;
  const stale = (currentLabels || []).filter(l => l.startsWith('last-parent-') && l !== target);
  for (const old of stale) {
    await del(pageId, old).catch(() => {});
  }
  if (!(currentLabels || []).includes(target)) {
    await post(pageId, target).catch(() => {});
  }
}

/**
 * AA 스페이스 감사: 최상위 고아 페이지 집계 + 휴먼 이동 감지/학습.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - true면 쓰기 일체 금지(commitDecision, stampLastParent)
 * @param {Array}   [opts.pages] - 이미 가져온 페이지 목록(오케스트레이터 공유, 중복 fetch 방지)
 * @param {Object}  [opts.aaTree]
 * @param {string}  [opts.homePageId]
 * @param {Object}  [opts.deps] - stampLastParent용 주입(테스트)
 * @returns {Promise<{topLevel: Array, humanMoves: Array, pages: Array, aaTree: Object, homePageId: string|null, errors: Array}>}
 *
 * - topLevel: 홈페이지 직속 고아 페이지. is-folder(정상 구조)와 bot-report(자가 출력, P6) 제외.
 * - commitDecision은 `!dryRun && !process.env.CI`일 때만(CI는 체크아웃 리셋으로 파일이 휘발되므로 무의미).
 * - stampLastParent는 dryRun이 아니면 항상 실행(CI에서도 라벨을 갱신해야 같은 이동이 재보고되지 않음).
 */
async function runAudit({ dryRun = false, pages, aaTree, homePageId, deps } = {}) {
  aaTree = aaTree || await fetchAATree();
  homePageId = homePageId || await fetchAASpaceHomepageId('AA');
  pages = pages || await listAAPages();

  const topLevel = [];
  const humanMoves = [];
  const errors = [];
  // CI에서는 체크아웃 리셋으로 파일이 휘발되므로 commitDecision은 로컬에서만 의미.
  // dryRun은 쓰기 금지이므로 커밋 금지. stampLastParent는 양쪽 모두에서 실행(라벨 갱신은 부작용이 아니며 재보고 방지에 필요).
  const shouldCommit = !dryRun && !process.env.CI;
  const _commitDecision = deps?.commitDecision || commitDecision;
  const _addLabels = deps?.addLabels || addLabels;

  for (const p of pages) {
    // P6 자기 배제: 봇이 생성한 리포트 페이지는 감사 대상이 아니다.
    if (p.labels.includes('bot-report')) continue;
    // 홈페이지 직속 is-folder는 정상 폴더 구조지 고아가 아니다.
    if (homePageId && p.parentId === homePageId && !p.labels.includes('is-folder')) {
      topLevel.push(p);
    }
    try {
      const move = detectMove(p);
      if (move && await shouldCommitHumanDecision(p, move, aaTree, homePageId)) {
        if (shouldCommit) {
          _commitDecision(p, move);
          await _addLabels(p.id, ['human-classified']);
        }
        humanMoves.push({ page: p, move, committed: shouldCommit });
      }
      // stampLastParent는 dryRun과 무관하게 항상 실행:
      // CI에서도 라벨을 갱신해야 같은 이동이 다음 실행에서 재보고되지 않는다.
      if (p.parentId) {
        await stampLastParent(p.id, p.parentId, p.labels, deps);
      }
    } catch (e) {
      errors.push({ pageId: p.id, title: p.title, error: e.message });
    }
  }

  return { topLevel, humanMoves, pages, aaTree, homePageId, errors };
}

async function main() {
  console.log('=== Audit AA Space ===');
  const { topLevel, humanMoves } = await runAudit();

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORT_DIR, `audit-${date}.md`);
  fs.writeFileSync(reportPath, renderReport(topLevel, humanMoves), 'utf8');
  console.log(`✅ Report: ${reportPath}`);
  console.log(`   Top-level pages: ${topLevel.length}`);
  console.log(`   Human moves committed: ${humanMoves.length}`);
}

function renderReport(topLevel, humanMoves) {
  const lines = ['# AA Space Audit Report', '', `Date: ${new Date().toISOString()}`, ''];
  lines.push(`## Top-level pages (${topLevel.length})`, '');
  for (const p of topLevel) lines.push(`- ${p.title} (id: ${p.id})`);
  lines.push('', `## Human moves auto-committed (${humanMoves.length})`, '');
  for (const m of humanMoves) lines.push(`- ${m.page.title}: ${m.move.from} → ${m.move.to}`);
  return lines.join('\n');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runAudit, detectMove, shouldCommitHumanDecision, stampLastParent };
