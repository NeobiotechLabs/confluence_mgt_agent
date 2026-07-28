'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { confluenceRequest } = require('./confluence_api');

const AA_HOME_TITLE = 'AA Home';   // AA 스페이스 홈페이지 제목
const UNSORTED_TITLES = ['미분류', '분류 보류', 'Unsorted'];

async function fetchAATree() {
  // 1) AA 스페이스의 모든 페이지 (IS-FOLDER 라벨 가진 페이지만)
  const folders = await fetchAllFolders();
  const unsortedFolderId = findUnsorted(folders) || folders[0]?.id || null;

  // 2) 트리 구조 조립
  const tree = buildTree(folders);

  return {
    flat: folders,
    tree,
    unsortedFolderId,
    toText() { return formatTreeAsText(tree); },
    hasFolder(id) { return folders.some(f => f.id === id); },
  };
}

async function fetchAllFolders() {
  let cursor = null;
  const all = [];
  do {
    const params = new URLSearchParams({ 'labels': 'is-folder', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages?${params}`);
    for (const p of (res.results || [])) {
      all.push({
        id: p.id,
        title: p.title,
        parentId: p.parentId,
        labels: [], // v2 labels는 별도 호출 필요. 향후 확장
        ancestors: await fetchAncestorTitles(p),
      });
    }
    cursor = res._links?.next;
  } while (cursor);
  return all;
}

async function fetchAncestorTitles(page) {
  const ancestors = [];
  let current = page.parentId;
  let depth = 0;
  while (current && depth < 10) {
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages/${current}`);
    ancestors.unshift(res.title || '');
    current = res.parentId;
    depth++;
  }
  return ancestors;
}

function findUnsorted(folders) {
  for (const t of UNSORTED_TITLES) {
    const found = folders.find(f => f.title === t);
    if (found) return found.id;
  }
  return null;
}

function buildTree(folders) {
  const byId = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
  const roots = [];
  for (const f of byId.values()) {
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId).children.push(f);
    } else {
      roots.push(f);
    }
  }
  return roots;
}

function formatTreeAsText(roots, indent = 0) {
  const lines = [];
  for (const node of roots) {
    lines.push(`${' '.repeat(indent)}- ${node.title} (id: ${node.id})`);
    if (node.children?.length) {
      lines.push(formatTreeAsText(node.children, indent + 2));
    }
  }
  return lines.join('\n');
}

module.exports = { fetchAATree, AA_HOME_TITLE, UNSORTED_TITLES };