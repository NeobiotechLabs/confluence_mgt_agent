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

console.error('❌ analyze_sd_v2.js 는 deprecated. `npm run refresh:snapshots` 를 사용하세요.');

const allResults = [];
const basePath = 'f:/work/private_git/confluence_mgt_agent/reference';
for (let i = 1; i <= 4; i++) {
  const filePath = path.join(basePath, 'sd_p' + i + '.json');
  const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  allResults.push(...d.results);
}

// Build page map using v1 ancestors
const pageMap = {};
allResults.forEach(p => {
  const ancestors = p.ancestors || [];
  pageMap[p.id] = {
    id: p.id,
    title: p.title,
    type: p.type,
    parentId: ancestors.length > 0 ? ancestors[ancestors.length - 1].id : null,
    ancestorIds: ancestors.map(a => a.id),
    depth: ancestors.length,
    labels: (p.labels?.results || []).map(l => l.name),
  };
});

// Known folders from v2 API
const folders = {
  '143130774': 'Tiny Projects',
  '143196288': 'Old',
  '128712837': 'Software Engineering',
  '143196276': 'Report',
  '128745626': 'Vision/3D Graphics',
  '128778350': 'Application Framework',
  '139034663': 'Exhibition',
  '143130749': 'How To Develop👌',
  '128745603': 'Robot',
  '128712861': 'Seminar',
  '71729409': 'History',
  '89653290': 'CT Viewer',
  '97288239': '24-NeoRobot Weekly History',
  '98304123': 'Image Registration',
  '110952613': '25-SmileArch History',
  '128745580': 'AI',
};

// Mark folders in pageMap
Object.keys(folders).forEach(fid => {
  if (!pageMap[fid]) {
    pageMap[fid] = {
      id: fid,
      title: folders[fid],
      type: 'folder',
      parentId: null,
      ancestorIds: [],
      depth: 0,
      labels: [],
    };
  } else {
    pageMap[fid].type = 'folder';
    pageMap[fid].title = folders[fid];
  }
});

// v2 API showed parentType info - pages can have folder parents
// The v1 ancestors chain doesn't include folders
// So pages with folder parents appear as "orphans" in v1 data

// Build complete tree using v1 ancestors + known folder structure
// Root level: pages with no ancestors + folders

console.log('=== SD 스페이스 완전 구조 분석 ===\n');
console.log('총 페이지 수:', allResults.length);
console.log('폴더 수:', Object.keys(folders).length);

// Group pages by their first ancestor (depth-1 items)
const rootPages = allResults.filter(p => !p.ancestors || p.ancestors.length === 0);
console.log('\n루트 페이지 (depth 0):', rootPages.length);
rootPages.forEach(p => {
  console.log('  ' + p.title + ' [' + p.id + ']');
});

// Show folder → page relationships
console.log('\n=== 폴더별 하위 페이지 ===\n');

// From v2 API data, we know which folders have which pages
// parentId maps from v2 API analysis
const folderChildren = {};
allResults.forEach(p => {
  const ancestors = p.ancestors || [];
  // Check if any ancestor is a folder
  ancestors.forEach(a => {
    if (folders[a.id]) {
      if (!folderChildren[a.id]) folderChildren[a.id] = [];
      folderChildren[a.id].push(p);
    }
  });
});

// Also check pages whose parentId (from v1 ancestors) matches a folder
// But v1 doesn't include folders in ancestors, so we need to cross-reference with v2 data

// From v2 API, we know these parentType=folder relationships:
// Let me list the pages that are direct children of folders
const v2FolderChildren = {
  '143130749': ['Flutter Doc', 'Dart Doc', 'VSCode Extensions & Settings', 'Flutter', 'Awesome Flutter site.', 'Essential Packages', 'Dart : Variables', 'Dart : Metadata', 'Dart : Class Modifier', 'State Management Pattern', 'Foreign Function Interface (FFI)', 'With Quasar', 'Anytime Loading', 'Awesome Node (Yarn) Packages', 'Related Libraries', 'Electron Doc', 'quasar vs vuetify'],
  '128745580': ['sLM', 'Deep Learning based Computer Vision', 'Object Segmentation - Smile Arch 사용', 'CEO가 생각하는 Neo AI Platform', 'Image Inpainting', 'AI Inpaint + ControlNet', 'Dental AI 영상 분석 모델 그리고, MONAI', 'Data Collection for Machine Learning', 'Data labelling'],
  '143130774': ['Trend Project (Toy Project)', 'DICOM Viewer', 'Laminate Consulting (with PowerPaint)', 'Neo GPT Robot 앱 개발 결과', 'Neobiotech GPT 로봇 데모 시나리오', 'Face AR/Filter', 'Image Inpainting', 'PowerPaint 분석'],
  '143196288': ['Development Strategy', 'Neo Robot Guided Dental Laminate Veneer', 'CAD / CAM을 알아봅시다'],
  '128712837': ['Branch Strategy', '연구소 S/W Configuration Management', 'CI/CD', 'Git-flow', 'GitHub Flow', 'Trunk based Development'],
  '128745626': ['Segmentation', '3D Files : STL vs OBJ vs IGES vs STEP', 'CUDA', 'STL 3D Viewer', 'three.js Manual', 'Three.js (Three_dart)', 'Unity vs Three_dart', 'Cornerstone', 'DICOM file structure'],
  '128778350': ['1. Web App vs Native App?', '2. Comparison Native App FWs', '3. Our Choice : Electron', '4. Basic Architecture'],
  '143196276': ['Monthly', 'Weekly MPS Evaluation & Planning'],
  '128712861': ['로봇 개발 관련 프레임워크 및 에코시스템', '소프트웨어 개발 프로세스', '의료기기 소프트웨어 허가 심사 가이드 라인'],
  '128745603': ['Neo Robot-Guided Dental Implant Surgery Roadmap', 'Laminate Design', 'Smile line', 'Enamel Segmentation', 'Tooth Segmentation', 'Input Data 정합'],
  '71729409': ['2024-10'],
  '89653290': ['Cornerstone', 'DICOM Viewer', 'DICOM Parse Libraries', 'DICOM Parse Application Retrospect', 'DICOM file structure'],
  '97288239': ['(W43) NeoRobot', '(W05) 25-SmileArch', '(W06) 솔루션개발팀 주간보고', '(W49) 솔루션개발팀 Weekly Report', '(W51) 솔루션개발팀 Weekly Report'],
  '98304123': ['Image Registration 문제 정의 및 전략', 'Image Registration', 'Object Detection From CT'],
  '110952613': ['(W05) 25-SmileArch'],
  '139034663': ['SIDEX 2024'],
};

console.log('폴더명                    하위 수  샘플');
Object.entries(v2FolderChildren).forEach(([fid, children]) => {
  const fname = folders[fid] || fid;
  console.log('\n📁 ' + fname + ' (' + children.length + '개)');
  children.slice(0, 5).forEach(c => console.log('   - ' + c));
  if (children.length > 5) console.log('   ... 외 ' + (children.length - 5) + '개');
});

// Show the Neo Robot subtree
console.log('\n\n=== Neo Robot-Guided Dental Implant Surgery 하위 ===\n');
const neoRoot = allResults.find(p => p.title === 'Neo Robot-Guided Dental Implant Surgery');
if (neoRoot) {
  function printSubtree(parentId, indent) {
    const children = allResults
      .filter(p => {
        const ancestors = p.ancestors || [];
        return ancestors.length > 0 && ancestors[ancestors.length - 1].id === parentId;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    children.forEach(p => {
      console.log(indent + '- ' + p.title);
      printSubtree(p.id, indent + '  ');
    });
  }
  printSubtree(neoRoot.id, '');
}

// Show the Report folder subtree
console.log('\n\n=== Report 폴더 하위 ===\n');
const reportChildren = v2FolderChildren['143196276'] || [];
reportChildren.forEach(c => console.log('- ' + c));

// Show Weekly MPS Evaluation & Planning subtree
console.log('\n\n=== Weekly MPS Evaluation & Planning 하위 ===\n');
const weeklyMps = allResults.find(p => p.title === 'Weekly MPS Evaluation & Planning');
if (weeklyMps) {
  const children = allResults.filter(p => {
    const ancestors = p.ancestors || [];
    return ancestors.length > 0 && ancestors[ancestors.length - 1].id === weeklyMps.id;
  });
  console.log('하위 페이지 수:', children.length);
  children.forEach(c => console.log('- ' + c.title));
}

// Show History (Weekly) subtree
console.log('\n\n=== History (Weekly) 하위 ===\n');
const histWeekly = allResults.find(p => p.title === 'History (Weekly)');
if (histWeekly) {
  const children = allResults.filter(p => {
    const ancestors = p.ancestors || [];
    return ancestors.length > 0 && ancestors[ancestors.length - 1].id === histWeekly.id;
  });
  console.log('하위 페이지 수:', children.length);
  children.forEach(c => console.log('- ' + c.title));
}

// Show Monthly MPS structure
console.log('\n\n=== MPS 구조 분석 ===\n');
const mpsPages = allResults.filter(p => /mps/i.test(p.title));
const mpsByTeam = {};
mpsPages.forEach(p => {
  const match = p.title.match(/^(SW|Device|AI|Solution|R&D)/i);
  const team = match ? match[1] : 'Other';
  if (!mpsByTeam[team]) mpsByTeam[team] = [];
  mpsByTeam[team].push(p.title);
});
Object.entries(mpsByTeam).sort((a,b) => b[1].length - a[1].length).forEach(([team, titles]) => {
  console.log(team + ' (' + titles.length + '개):');
  titles.slice(0, 5).forEach(t => console.log('  - ' + t));
  if (titles.length > 5) console.log('  ... 외 ' + (titles.length - 5) + '개');
});

// Summary
console.log('\n\n=== 문제점 요약 (수정됨) ===\n');
console.log('1. 폴더와 페이지 혼용: 16개 폴더 + 661개 페이지가 혼재');
console.log('2. 레이블 0%: 어떤 페이지도 레이블 없음');
console.log('3. v1 API는 폴더를 ancestors에 포함하지 않아 트리 구조 파악 어려움');
console.log('4. MPS 문서가 Report 폴더 > Monthly > 팀별로 분산');
console.log('5. 12개 Archived 루트 페이지가 루트를 오염');
console.log('6. 실제 루트 구조: Digital R&D Center + 16개 폴더 + 12개 Archived + Neo Robot');
