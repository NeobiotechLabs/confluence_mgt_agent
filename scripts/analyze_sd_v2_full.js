// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  DEPRECATED — 2026-07-28
// 이 스크립트는 `f:/work/private_git/...` 라는 잘못된 절대경로를 하드코딩하고 있어
// 새 환경에서 동작하지 않습니다. 다음 스크립트로 대체되었습니다:
//   · 스냅샷 수집: node scripts/refresh_result_json.js
//   · 후속 분석:   node scripts/analyze_migration_candidates.js
// TODO: 다음 마이너 버전(v0.2.0)에서 삭제 예정.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

console.error('❌ analyze_sd_v2_full.js 는 deprecated. `npm run refresh:snapshots` 를 사용하세요.');

// Merge all v2 pages
const allPages = [];
const basePath = 'f:/work/private_git/confluence_mgt_agent/reference';
for (let i = 1; i <= 3; i++) {
  const filePath = path.join(basePath, 'sd_v2_p' + i + '.json');
  const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  allPages.push(...(d.results || []));
}

console.log('=== 전체 v2 페이지 수:', allPages.length, '===\n');

// Build page map
const pageMap = {};
allPages.forEach(p => {
  pageMap[p.id] = {
    id: p.id,
    title: p.title,
    parentType: p.parentType || null,
    parentId: p.parentId || null,
    status: p.status,
  };
});

// 1. Find all unique parentType=folder entries and their parentIds
const folderIds = new Set();
const folderChildren = {};
allPages.forEach(p => {
  if (p.parentType === 'folder') {
    folderIds.add(p.parentId);
    if (!folderChildren[p.parentId]) folderChildren[p.parentId] = [];
    folderChildren[p.parentId].push(p.title);
  }
});

console.log('=== 폴더 ID 목록 ===');
console.log('고유 폴더 수:', folderIds.size);

// Fetch folder names one by one
const folderNames = {};

const AUTH = process.env.CONFLUENCE_AUTH || "email:api_token"; // CONFLUENCE_AUTH 환경변수 사용

// We'll use synchronous fetch via child_process for folder names
const { execSync } = require('child_process');

for (const fid of folderIds) {
  try {
    const result = execSync(
      `curl -s -u "${AUTH}" "https://neobiotech.atlassian.net/wiki/api/v2/folders/${fid}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const data = JSON.parse(result);
    folderNames[fid] = data.title || data.id || 'UNKNOWN';
  } catch (e) {
    folderNames[fid] = 'ERROR:' + fid;
  }
}

console.log('\n폴더 이름 매핑:');
Object.entries(folderNames).sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => {
  const childCount = folderChildren[id]?.length || 0;
  console.log(`  ${name} (id:${id}) → ${childCount}개 하위`);
});

// 2. Build complete tree
// Root items: pages with parentType=null
const rootPages = allPages.filter(p => !p.parentType);
console.log('\n=== 루트 항목 (parentType=null) ===');
console.log('수:', rootPages.length);
rootPages.forEach(p => {
  console.log(`  ${p.title} (id:${p.id})`);
});

// 3. Build tree structure
console.log('\n\n=== 전체 트리 구조 ===\n');

function findChildren(parentId, parentType) {
  return allPages.filter(p => {
    if (parentType === 'page') return p.parentType === 'page' && p.parentId === parentId;
    if (parentType === 'folder') return p.parentType === 'folder' && p.parentId === parentId;
    return false;
  }).sort((a, b) => a.title.localeCompare(b.title));
}

function printTree(parentId, parentType, indent, maxDepth) {
  if (indent.length / 3 > maxDepth) return;
  const children = findChildren(parentId, parentType);
  children.forEach((p, idx) => {
    const isLast = idx === children.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    const subChildren = allPages.filter(x => x.parentId === p.id);
    const suffix = subChildren.length > 0 ? ` (${subChildren.length})` : '';
    console.log(indent + connector + p.title + suffix);
    printTree(p.id, 'page', indent + (isLast ? '   ' : '│  '), maxDepth);
  });
}

// Print root pages with their trees
rootPages.forEach(p => {
  const children = findChildren(p.id, 'page');
  const folderChildrenCount = findChildren(p.id, 'folder').length;
  console.log(`📄 ${p.title} [${p.id}]`);
  if (children.length > 0 || folderChildrenCount > 0) {
    printTree(p.id, 'page', '', 10);
  }
  console.log();
});

// 4. Print folder trees
console.log('\n=== 폴더별 하위 구조 ===\n');

// Find which folders are children of other folders (nested folders)
const nestedFolders = {};
allPages.filter(p => p.parentType === 'folder').forEach(p => {
  // Check if parent is also a folder
  // Actually, pages with parentType=folder have a folder as parent
  // But folders can also be children of other folders
  // We need to check if any folder's parentId points to another folder
});

// First, find top-level folders (not children of other folders)
// We can infer this by checking if a folder's ID appears as parentId of any page
// and if that folder's ID is NOT a parentId of any other folder

// Actually, let's just print the folder → page relationships
console.log('폴더 → 페이지 관계:');
Object.entries(folderNames).sort((a, b) => a[1].localeCompare(b[1])).forEach(([fid, fname]) => {
  const children = folderChildren[fid] || [];
  console.log(`\n📁 ${fname} (${children.length}개 하위):`);
  children.sort().forEach(c => console.log(`   - ${c}`));
});

// 5. Specifically check Survey folder
console.log('\n\n=== Survey 폴더 분석 ===\n');
const surveyId = Object.entries(folderNames).find(([id, name]) => name === 'Survey')?.[0];
if (surveyId) {
  console.log('Survey 폴더 ID:', surveyId);
  const surveyChildren = folderChildren[surveyId] || [];
  console.log('Survey 하위 수:', surveyChildren.length);
  surveyChildren.sort().forEach(c => console.log('  -', c));

  // Check if any of Survey's children are also folders
  // We need to find pages whose parentId is Survey's ID AND parentType is folder
  // But actually, in v2 API, if a page has parentType=folder and parentId=surveyId,
  // it means the page is directly under the Survey folder
  // But what about nested folders? Let me check if Survey has sub-folders
  const surveySubFolders = allPages.filter(p => p.parentType === 'folder' && p.parentId === surveyId);
  console.log('\nSurvey 하위 폴더 (페이지가 아닌 것):', surveySubFolders.length);

  // Actually, the Survey folder might contain other folders
  // Let me check by looking at which folder IDs are referenced by pages under Survey
}

// 6. Full hierarchical analysis - find all folders and their nesting
console.log('\n\n=== 폴더 계층 구조 ===\n');

// For each folder, check if it's referenced as a parentId
// If a folder ID appears as parentId of a page with parentType=folder,
// then that page is a sub-folder
const folderAsParent = {};
allPages.forEach(p => {
  if (p.parentType === 'folder' && folderIds.has(p.id)) {
    // This page IS a folder (its ID is in folderIds)
    // and it has a folder parent
    if (!folderAsParent[p.parentId]) folderAsParent[p.parentId] = [];
    folderAsParent[p.parentId].push(p.id);
  }
});

console.log('하위 폴더를 가진 폴더:');
Object.entries(folderAsParent).forEach(([parentId, childFolderIds]) => {
  const parentName = folderNames[parentId] || parentId;
  console.log(`  ${parentName}:`);
  childFolderIds.forEach(childId => {
    const childName = folderNames[childId] || childId;
    console.log(`    └─ ${childName}`);
  });
});

// 7. Find ALL unique parentType=folder parentIds to discover hidden folders
console.log('\n\n=== 전체 폴더 ID → 이름 매핑 ===');
Object.entries(folderNames).sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => {
  const isNested = folderAsParent[id];
  const nestedStr = isNested ? ' (하위 폴더 있음)' : '';
  console.log(`  ${name} [${id}]${nestedStr}`);
});
