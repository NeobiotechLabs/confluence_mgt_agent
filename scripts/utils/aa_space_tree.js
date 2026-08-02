'use strict';
require('../utils/load_env');
const { confluenceRequest } = require('./confluence_api');

const UNSORTED_TITLES = ['미분류', '분류 보류', 'Unsorted'];

/**
 * AA 스페이스의 홈페이지 page ID를 명시적으로 조회.
 * v2 pagination 순서가 정의되지 않은 문제를 회피하기 위해
 * `aaTree.flat[0]?.parentId` 같은 우회 대신 공식 v2 엔드포인트를 사용한다.
 */
async function fetchAASpaceHomepageId(spaceKey = 'AA') {
  // v2는 `/spaces/{id}/homepage` 엔드포인트를 제공하지 않으며(실측 404),
  // space 목록 객체의 `homepageId` 필드를 직접 읽는 것이 정확하다.
  const res = await confluenceRequest('GET', `/wiki/api/v2/spaces?keys=${spaceKey}`);
  return res?.results?.[0]?.homepageId || null;
}

/**
 * space+label로 정확한 폴더 목록(id, title)을 v1 CQL로 조회.
 * v2 GET /pages는 `labels` 파라미터를 지원하지 않으므로(공식 스펙),
 * 라벨+스페이스 복합 필터는 v1 CQL search만 보장한다.
 * 주의: CLAUDE.md 정책상 v1의 ancestors는 폴더를 누락하므로 여기서 쓰지 않고
 *       id/title만 가져온 뒤 parentId는 v2로 별도 보강한다.
 */
async function searchFolderIds(spaceKey = 'AA') {
  const out = [];
  let start = 0;
  const limit = 100;
  while (true) {
    const cql = encodeURIComponent(`space="${spaceKey}" and label="is-folder" and type=page`);
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/search?cql=${cql}&limit=${limit}&start=${start}`);
    const results = res.results || [];
    for (const r of results) out.push({ id: r.id, title: r.title });
    if (results.length < limit) break;
    start += limit;
    if (start > 10000) break; // 안전장치
  }
  return out;
}

async function fetchAATree(spaceKey = 'AA') {
  // 1) AA 스페이스의 폴더 페이지 (IS-FOLDER 라벨 + space 한정)
  const folders = await fetchAllFolders(spaceKey);
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

async function fetchAllFolders(spaceKey = 'AA') {
  // id/title은 v1 CQL(space+label 정확)로, parentId/조상은 v2로 보강.
  // 타 스페이스 유입을 원천 차단하고, v2로 정확한 부모 관계를 확보한다.
  const ids = await searchFolderIds(spaceKey);
  const all = [];
  for (const { id, title } of ids) {
    let page;
    try {
      page = await confluenceRequest('GET', `/wiki/api/v2/pages/${id}`);
    } catch (e) {
      // 삭제/미존재 폴더면 조용히 건너뜀 (크래시 방지)
      console.warn(`⚠️ folder page ${id} unavailable (${String(e.message).split('\n')[0]}); skipping.`);
      continue;
    }
    all.push({
      id,
      title: page?.title || title,
      parentId: page?.parentId || null,
      labels: [], // v2 labels는 별도 호출 필요. 향후 확장
      ancestors: await fetchAncestorTitles(page || { parentId: null }),
    });
  }
  return all;
}

async function fetchAncestorTitles(page) {
  const ancestors = [];
  let current = page.parentId;
  let depth = 0;
  while (current && depth < 10) {
    let res;
    try {
      res = await confluenceRequest('GET', `/wiki/api/v2/pages/${current}`);
    } catch (e) {
      // 삭제/미존재 조상에서 404가 나도 크래시하지 않고 중단
      console.warn(`⚠️ ancestor page ${current} unavailable (${String(e.message).split('\n')[0]}); stopping ancestor walk.`);
      break;
    }
    ancestors.unshift(res?.title || '');
    current = res?.parentId;
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

module.exports = { fetchAATree, fetchAASpaceHomepageId, UNSORTED_TITLES };