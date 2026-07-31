// scripts/tree_aa.js
// AA 스페이스의 디렉토리 구조를 ASCII 트리로 출력.
// 각 폴더 옆에 직속 페이지 수를 표시한다.
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SKIP_LABELS = new Set(['is-folder', 'bot-report', 'auto-report']);

/**
 * 폴더별 직속 페이지 수를 집계한다.
 * is-folder / bot-report / auto-report 라벨이 붙은 페이지는 제외.
 * @param {Array<{id,title,parentId,labels}>} pages
 * @returns {Map<string|null, number>} parentId → page count
 */
function buildFolderPageCounts(pages) {
  const counts = new Map();
  for (const p of pages) {
    if (p.labels && p.labels.some(l => SKIP_LABELS.has(l))) continue;
    const key = p.parentId || null;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * 트리 노드를 재귀적으로 포맷팅.
 * @param {Array} roots - buildTree() 결과
 * @param {Map} counts - buildFolderPageCounts() 결과
 * @param {number} indent
 * @returns {string}
 */
function formatNode(roots, counts, indent = 0) {
  const lines = [];
  const prefix = '  '.repeat(indent);
  for (const node of roots) {
    const pageCount = counts.get(node.id) || 0;
    lines.push(`${prefix}📁 ${node.title} (${pageCount})`);
    if (node.children?.length) {
      lines.push(formatNode(node.children, counts, indent + 1));
    }
  }
  return lines.join('\n');
}

/**
 * AA 스페이스의 전체 트리를 ASCII로 포맷.
 * @param {Array} tree - buildTree(folders) 결과 (중첩 children 포함)
 * @param {Array} pages - listAAPages() 결과
 * @returns {string}
 */
function formatTreeWithCounts(tree, pages) {
  if (!tree || tree.length === 0) return '';
  const counts = buildFolderPageCounts(pages);
  const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);

  const parts = [];
  parts.push(`AA 스페이스 디렉토리 구조 (총 페이지: ${total})`);
  parts.push('─'.repeat(50));
  parts.push(formatNode(tree, counts));

  // 최상위 고아 페이지 (parentId=null, 폴더 아닌 페이지)
  const orphans = counts.get(null) || 0;
  if (orphans > 0) {
    parts.push('');
    parts.push(`⚠️ 고아 페이지 (${orphans}) — 홈페이지 직속, 폴더 미배정`);
  }

  return parts.join('\n');
}

async function main() {
  const { fetchAATree } = require('./utils/aa_space_tree');
  const { listAAPages } = require('./utils/aa_pages');

  console.log('🔍 AA 스페이스 폴더 구조 조회 중...');
  const aaTree = await fetchAATree();
  const pages = await listAAPages();

  const output = formatTreeWithCounts(aaTree.tree, pages);
  console.log(output);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { formatTreeWithCounts, buildFolderPageCounts };
