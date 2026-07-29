// scripts/audit_aa_space.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree, fetchAASpaceHomepageId } = require('./utils/aa_space_tree');
const { ruleClassifier } = require('./classifiers/rule');

const DECISIONS_PATH = path.join(__dirname, '..', 'config', 'classification_decisions.json');
const REPORT_DIR = path.join(__dirname, '..', '.github', 'reports');

async function listAAPages() {
  // AA 스페이스로 한정하지 않으면 전 인스턴스 페이지를 순회하며,
  // 타 스페이스 페이지에 last-parent-* 라벨을 찍고 그 이동을 human decision으로
  // commit하는 부작용이 발생한다. v2 GET /pages는 space-id로만 space 필터를 받는다.
  const sp = await confluenceRequest('GET', '/wiki/api/v2/spaces?keys=AA');
  const spaceId = sp?.results?.[0]?.id;
  if (!spaceId) {
    console.warn('⚠️ AA space id not found; listAAPages returns [] to avoid cross-space mutation.');
    return [];
  }
  let cursor = null;
  const all = [];
  do {
    const params = new URLSearchParams({ 'space-id': spaceId, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages?${params}`);
    for (const p of (res.results || [])) {
      const labels = await fetchLabels(p.id);
      all.push({ id: p.id, title: p.title, parentId: p.parentId, labels });
    }
    cursor = res._links?.next;
  } while (cursor);
  return all;
}

async function fetchLabels(pageId) {
  try {
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/label?limit=50`);
    return (res.results || []).map(l => l.name);
  } catch { return []; }
}

async function detectMove(page) {
  const lastParentLabel = page.labels.find(l => l.startsWith('last-parent-'));
  if (!lastParentLabel) return null;
  const lastParentId = lastParentLabel.replace('last-parent-', '');
  if (lastParentId === page.parentId) return null;
  return { from: lastParentId, to: page.parentId };
}

async function shouldCommitHumanDecision(page, move, aaTree, homePageId) {
  // 1) 최상위 → 특정 폴더로 이동 (Rule이 매칭 못 했을 가능성)
  if (move.from === homePageId || !move.from) return true;
  // 2) RuleClassifier가 모르는 카테고리
  const ruleResult = await ruleClassifier.classify({
    pageId: page.id, title: page.title, body: '', ancestors: [],
    sourceSpace: '?', sourceUrl: '', pageDate: '', existingLabels: page.labels,
  }, aaTree);
  if (!ruleResult.ok) return true;
  // 3) Rule이 다른 폴더로 분류했다면 → 휴먼이 다른 데로 옮긴 것 → 등록
  return ruleResult.folderId !== move.to;
}

async function commitDecision(page, move) {
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

async function stampLastParent(pageId, parentId) {
  // 라벨 페이지 부여 (v1 API)
  await confluenceRequest('POST', `/wiki/rest/api/content/${pageId}/label`, {
    prefix: 'global', name: `last-parent-${parentId}`,
  }).catch(() => {});
}

async function main() {
  console.log('=== Audit AA Space ===');
  const aaTree = await fetchAATree();
  const homePageId = await fetchAASpaceHomepageId('AA');
  const pages = await listAAPages();
  const topLevel = [];
  const moves = [];

  for (const p of pages) {
    if (homePageId && p.parentId === homePageId) topLevel.push(p);
    const move = await detectMove(p);
    if (move && await shouldCommitHumanDecision(p, move, aaTree, homePageId)) {
      await commitDecision(p, move);
      moves.push({ page: p.title, move });
    }
    if (p.parentId) await stampLastParent(p.id, p.parentId);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORT_DIR, `audit-${date}.md`);
  fs.writeFileSync(reportPath, renderReport(topLevel, moves), 'utf8');
  console.log(`✅ Report: ${reportPath}`);
  console.log(`   Top-level pages: ${topLevel.length}`);
  console.log(`   Human moves committed: ${moves.length}`);
}

function renderReport(topLevel, moves) {
  const lines = ['# AA Space Audit Report', '', `Date: ${new Date().toISOString()}`, ''];
  lines.push(`## Top-level pages (${topLevel.length})`, '');
  for (const p of topLevel) lines.push(`- ${p.title} (id: ${p.id})`);
  lines.push('', `## Human moves auto-committed (${moves.length})`, '');
  for (const m of moves) lines.push(`- ${m.page}: ${m.move.from} → ${m.move.to}`);
  return lines.join('\n');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
