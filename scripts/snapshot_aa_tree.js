// scripts/snapshot_aa_tree.js
// AA 스페이스의 디렉토리 맵을 로컬에 스냅샷으로 저장하고,
// 이전 스냅샷과 diff를 계산하여 변경 사항을 보여준다.
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'reference', 'aa_tree_snapshot.json');

/**
 * 스냅샷 객체를 빌드. 폴더/페이지에서 필요한 필드만 추출.
 */
function buildSnapshot(folders, pages, capturedAt) {
  return {
    capturedAt,
    folders: folders.map(f => ({ id: f.id, title: f.title, parentId: f.parentId || null })),
    pages: pages.map(p => ({
      id: p.id, title: p.title,
      parentId: p.parentId || null,
      labels: p.labels || [],
    })),
  };
}

/**
 * 두 스냅샷 간의 diff를 계산.
 * @param {Object|null} prev - 이전 스냅샷 (없으면 null)
 * @param {Object} curr - 현재 스냅샷
 * @returns {{pagesAdded, pagesRemoved, pagesMoved, foldersAdded, foldersRemoved}}
 */
function computeSnapshotDiff(prev, curr) {
  if (!prev) {
    return {
      pagesAdded: [...curr.pages],
      pagesRemoved: [],
      pagesMoved: [],
      foldersAdded: [...curr.folders],
      foldersRemoved: [],
    };
  }

  const prevPageMap = new Map(prev.pages.map(p => [p.id, p]));
  const currPageMap = new Map(curr.pages.map(p => [p.id, p]));
  const prevFolderMap = new Map(prev.folders.map(f => [f.id, f]));
  const currFolderMap = new Map(curr.folders.map(f => [f.id, f]));

  // 폴더 이름 조회용 (이동된 페이지의 from/to 표시)
  const folderTitle = (id, folderMap) => folderMap.get(id)?.title || id || '(최상위)';

  const pagesAdded = [];
  const pagesMoved = [];
  for (const [id, p] of currPageMap) {
    if (!prevPageMap.has(id)) {
      pagesAdded.push(p);
    } else {
      const old = prevPageMap.get(id);
      if (old.parentId !== p.parentId) {
        pagesMoved.push({
          id: p.id, title: p.title,
          from: old.parentId, to: p.parentId,
          fromTitle: folderTitle(old.parentId, prevFolderMap),
          toTitle: folderTitle(p.parentId, currFolderMap),
        });
      }
    }
  }

  const pagesRemoved = [];
  for (const [id, p] of prevPageMap) {
    if (!currPageMap.has(id)) pagesRemoved.push(p);
  }

  const foldersAdded = [];
  for (const [id, f] of currFolderMap) {
    if (!prevFolderMap.has(id)) foldersAdded.push(f);
  }

  const foldersRemoved = [];
  for (const [id, f] of prevFolderMap) {
    if (!currFolderMap.has(id)) foldersRemoved.push(f);
  }

  return { pagesAdded, pagesRemoved, pagesMoved, foldersAdded, foldersRemoved };
}

/**
 * diff를 사람이 읽기 좋은 텍스트로 포맷.
 */
function formatDiff(diff) {
  const lines = [];
  const { pagesAdded, pagesRemoved, pagesMoved, foldersAdded, foldersRemoved } = diff;

  if (foldersAdded.length === 0 && foldersRemoved.length === 0 &&
      pagesAdded.length === 0 && pagesRemoved.length === 0 && pagesMoved.length === 0) {
    return '✅ 변경 사항 없음';
  }

  if (foldersAdded.length > 0) {
    lines.push(`📁 신규 폴더 (+${foldersAdded.length}):`);
    for (const f of foldersAdded) lines.push(`  + ${f.title}`);
  }
  if (foldersRemoved.length > 0) {
    lines.push(`🗑️ 삭제된 폴더 (-${foldersRemoved.length}):`);
    for (const f of foldersRemoved) lines.push(`  - ${f.title}`);
  }
  if (pagesAdded.length > 0) {
    lines.push(`📄 신규 페이지 (+${pagesAdded.length}):`);
    for (const p of pagesAdded.slice(0, 20)) lines.push(`  + ${p.title}`);
    if (pagesAdded.length > 20) lines.push(`  ... 외 ${pagesAdded.length - 20}건`);
  }
  if (pagesRemoved.length > 0) {
    lines.push(`🗑️ 삭제된 페이지 (-${pagesRemoved.length}):`);
    for (const p of pagesRemoved.slice(0, 20)) lines.push(`  - ${p.title}`);
    if (pagesRemoved.length > 20) lines.push(`  ... 외 ${pagesRemoved.length - 20}건`);
  }
  if (pagesMoved.length > 0) {
    lines.push(`↔️ 이동된 페이지 (${pagesMoved.length}):`);
    for (const m of pagesMoved.slice(0, 20)) lines.push(`  ${m.title}: ${m.fromTitle} → ${m.toTitle}`);
    if (pagesMoved.length > 20) lines.push(`  ... 외 ${pagesMoved.length - 20}건`);
  }

  return lines.join('\n');
}

function loadPreviousSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch { return null; }
}

function kstNow() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  return kst.toISOString().replace('Z', '+09:00');
}

async function main() {
  const { fetchAATree } = require('./utils/aa_space_tree');
  const { listAAPages } = require('./utils/aa_pages');

  console.log('📸 AA 스페이스 스냅샷 생성 중...');
  const aaTree = await fetchAATree();
  const pages = await listAAPages();

  const snapshot = buildSnapshot(aaTree.flat, pages, kstNow());

  // 이전 스냅샷과 diff
  const prev = loadPreviousSnapshot();
  if (prev) {
    console.log(`\n이전 스냅샷: ${prev.capturedAt}`);
    const diff = computeSnapshotDiff(prev, snapshot);
    console.log('\n' + formatDiff(diff) + '\n');
  } else {
    console.log('\n이전 스냅샷 없음 (첫 저장)');
  }

  // 저장
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`✅ 스냅샷 저장: ${SNAPSHOT_PATH}`);
  console.log(`   폴더: ${snapshot.folders.length}개, 페이지: ${snapshot.pages.length}개`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { buildSnapshot, computeSnapshotDiff, formatDiff };
