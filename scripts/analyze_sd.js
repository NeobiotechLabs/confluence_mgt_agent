// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  DEPRECATED — 2026-07-28
// 이 스크립트는 `f:/work/private_git/...` 라는 잘못된 절대경로를 하드코딩하고 있어
// 새 환경에서 동작하지 않습니다. 다음 스크립트로 대체되었습니다:
//   · 스냅샷 수집: node scripts/refresh_result_json.js
//   · 후속 분석:   node scripts/analyze_migration_candidates.js
// TODO: 다음 마이너 버전(v0.2.0)에서 삭제 예정.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

console.error('❌ analyze_sd.js 는 deprecated. `npm run refresh:snapshots` 를 사용하세요.');

// Merge all pages
const allResults = [];
const basePath = 'f:/work/private_git/confluence_mgt_agent/reference';
for (let i = 1; i <= 4; i++) {
  const filePath = path.join(basePath, 'sd_p' + i + '.json');
  const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  allResults.push(...d.results);
}

console.log('=== 전체 페이지 수:', allResults.length, '===');
console.log();

// Build page map
const pageMap = {};
allResults.forEach(p => {
  pageMap[p.id] = {
    id: p.id,
    title: p.title,
    type: p.type,
    parentId: p.ancestors && p.ancestors.length > 0 ? p.ancestors[p.ancestors.length - 1].id : null,
    depth: p.ancestors ? p.ancestors.length : 0,
    labels: (p.labels?.results || []).map(l => l.name),
    version: p.version?.when || null
  };
});

// 1. Depth distribution
const depthDist = {};
Object.values(pageMap).forEach(p => {
  depthDist[p.depth] = (depthDist[p.depth] || 0) + 1;
});
console.log('=== 계층 깊이 분포 ===');
Object.keys(depthDist).sort((a,b) => a-b).forEach(d => {
  console.log('  Depth ' + d + ': ' + depthDist[d] + ' pages');
});

// 2. Label usage
const labelCounts = {};
Object.values(pageMap).forEach(p => {
  p.labels.forEach(l => {
    labelCounts[l] = (labelCounts[l] || 0) + 1;
  });
});
const totalLabeled = Object.values(pageMap).filter(p => p.labels.length > 0).length;
console.log();
console.log('=== 레이블 사용 현황 ===');
console.log('  레이블이 있는 페이지: ' + totalLabeled + ' / ' + allResults.length + ' (' + (totalLabeled/allResults.length*100).toFixed(1) + '%)');
console.log('  레이블이 없는 페이지: ' + (allResults.length - totalLabeled));
const sortedLabels = Object.entries(labelCounts).sort((a,b) => b[1] - a[1]);
console.log('  사용된 레이블 종류 수: ' + sortedLabels.length);
sortedLabels.slice(0, 30).forEach(([l, c]) => {
  console.log('    ' + l + ': ' + c);
});

// 3. Pages with no children (leaf nodes)
const childCount = {};
Object.values(pageMap).forEach(p => {
  if (p.parentId) {
    childCount[p.parentId] = (childCount[p.parentId] || 0) + 1;
  }
});
const leafNodes = Object.values(pageMap).filter(p => !childCount[p.id]);
const rootPages = Object.values(pageMap).filter(p => !p.parentId);
console.log();
console.log('=== 구조 통계 ===');
console.log('  루트 페이지 (depth 0): ' + rootPages.length);
console.log('  리프 페이지 (자녀 없음): ' + leafNodes.length);
console.log('  분기 노드 (자녀 있음): ' + (allResults.length - leafNodes.length));

// 4. Max depth
const maxDepth = Math.max(...Object.values(pageMap).map(p => p.depth));
console.log('  최대 깊이: ' + maxDepth);

// 5. Top-level structure (depth 1 under root)
const rootId = rootPages.length === 1 ? rootPages[0].id : null;
const topLevel = Object.values(pageMap).filter(p => p.parentId === rootId && p.depth === 1);
console.log();
console.log('=== 루트 하위 1단계 구조 ===');
topLevel.forEach(p => {
  const children = Object.values(pageMap).filter(x => x.parentId === p.id);
  const labelStr = p.labels.length > 0 ? ' [' + p.labels.join(', ') + ']' : '';
  console.log('  ' + p.title + ' (' + children.length + '개 하위)' + labelStr);
});

// 6. Archived pages
const archived = Object.values(pageMap).filter(p => p.title.startsWith('Archived'));
console.log();
console.log('=== Archived 페이지 ===');
console.log('  수: ' + archived.length);
archived.forEach(p => {
  const children = Object.values(pageMap).filter(x => x.parentId === p.id);
  console.log('  ' + p.title + ' (' + children.length + '개 하위)');
});

// 7. Pages by week/date pattern
const weeklyPages = Object.values(pageMap).filter(p => /\d{4}-\d{2}-\d{2}/.test(p.title));
const monthlyPages = Object.values(pageMap).filter(p => /^\d{2}-\d{2}$/.test(p.title));
console.log();
console.log('=== 날짜 기반 페이지 ===');
console.log('  날짜 패턴 (YYYY-MM-DD) 페이지: ' + weeklyPages.length);
console.log('  월간 패턴 (YY-MM) 페이지: ' + monthlyPages.length);

// 8. Tree structure - show full tree with depth limit
console.log();
console.log('=== 전체 트리 구조 (최대 3단계) ===');
function printTree(parentId, indent, maxIndent) {
  if (indent/2 > maxIndent) return;
  const children = Object.values(pageMap)
    .filter(p => p.parentId === parentId)
    .sort((a,b) => a.title.localeCompare(b.title));
  children.forEach(p => {
    const childTotal = Object.values(pageMap).filter(x => x.parentId === p.id).length;
    const labelStr = p.labels.length > 0 ? ' [' + p.labels.slice(0,3).join(', ') + (p.labels.length > 3 ? '...' : '') + ']' : '';
    const prefix = childTotal > 0 ? '├─ ' : '└─ ';
    console.log(indent + prefix + p.title + ' (' + childTotal + ')' + labelStr);
    if (childTotal > 0) {
      printTree(p.id, indent + '│  ', maxIndent);
    }
  });
}

rootPages.forEach(p => {
  console.log('📁 ' + p.title);
  printTree(p.id, '', 3);
});

// 9. Problem analysis
console.log();
console.log('=== 문제점 분석 ===');

// 9a. Too many items under single parent
const oversized = Object.entries(childCount)
  .filter(([id, count]) => count > 10 && pageMap[id])
  .sort((a,b) => b[1] - a[1]);
console.log('과도한 하위 페이지를 가진 상위 페이지 (>10개):');
oversized.forEach(([id, count]) => {
  const p = pageMap[id];
  if (p) console.log('  ' + p.title + ': ' + count + '개 하위');
  else console.log('  [id:' + id + ']: ' + count + '개 하위 (pageMap에 없음)');
});

// 9b. Depth > 4
const deepPages = Object.values(pageMap).filter(p => p.depth > 4);
const orphans = Object.values(pageMap).filter(p => p.parentId && !pageMap[p.parentId]);
console.log();
console.log('너무 깊은 페이지 (depth > 4): ' + deepPages.length + '개');
console.log('고아 페이지 (부모가 다른 스페이스): ' + orphans.length + '개');
if (orphans.length > 0) {
  orphans.slice(0, 10).forEach(p => {
    console.log('  ' + p.title + ' (depth:' + p.depth + ', parentId:' + p.parentId + ')');
  });
  if (orphans.length > 10) console.log('  ... 외 ' + (orphans.length - 10) + '개');
}

// 9c. Mixed content under same parent
console.log();
console.log('=== 특정 주요 하위 항목 분석 ===');

// Analyze Weekly MPS Evaluation & Planning
const weeklyMpsId = Object.values(pageMap).find(p => p.title === 'Weekly MPS Evaluation & Planning')?.id;
if (weeklyMpsId) {
  const children = Object.values(pageMap).filter(p => p.parentId === weeklyMpsId);
  console.log('Weekly MPS Evaluation & Planning 하위 (' + children.length + '개):');
  children.slice(0, 15).forEach(p => {
    console.log('  - ' + p.title);
  });
  if (children.length > 15) console.log('  ... 외 ' + (children.length - 15) + '개');
}

// Analyze Roadmap
const roadmapId = Object.values(pageMap).find(p => p.title === 'Roadmap')?.id;
if (roadmapId) {
  const children = Object.values(pageMap).filter(p => p.parentId === roadmapId);
  console.log();
  console.log('Roadmap 하위 (' + children.length + '개):');
  children.slice(0, 15).forEach(p => {
    console.log('  - ' + p.title);
  });
  if (children.length > 15) console.log('  ... 외 ' + (children.length - 15) + '개');
}
