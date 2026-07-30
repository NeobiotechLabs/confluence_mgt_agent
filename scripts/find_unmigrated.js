// scripts/find_unmigrated.js
// 소스 스페이스에서 이관되지 않은 페이지를 찾는다.
// 사용법: node scripts/find_unmigrated.js --space=SD --from=2025-01-01 [--to=2025-12-31] [--dry-run]
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { confluenceRequest, nextPagePath } = require('./utils/confluence_api');
const { listAAPages } = require('./utils/aa_pages');

const SUPPORTED_SPACES = ['SD', 'WND', 'Device', 'SmileArch'];

/**
 * 페이지 목록을 생성일 범위로 필터.
 * @param {Array} pages - [{id, title, createdDate}]
 * @param {string} from - 'YYYY-MM-DD' (이상)
 * @param {string|null} to - 'YYYY-MM-DD' (이하, null이면 무제한)
 */
function filterByDateRange(pages, from, to) {
  const fromDate = from || '0000-01-01';
  const toDate = to || '9999-12-31';
  return pages.filter(p => {
    if (!p.createdDate) return false;
    const date = p.createdDate.split('T')[0]; // 'YYYY-MM-DD'
    return date >= fromDate && date <= toDate;
  });
}

/**
 * 소스 페이지 중 AA에 같은 제목이 없는 페이지를 추출.
 * @param {Array} sourcePages - [{id, title, createdDate}]
 * @param {Set<string>} aaTitles - AA 스페이스의 모든 페이지 제목 집합
 * @returns {Array} 누락 페이지
 */
function findUnmigratedPages(sourcePages, aaTitles) {
  return sourcePages.filter(p => !aaTitles.has(p.title));
}

/**
 * 소스 스페이스의 전체 페이지를 조회 (v2, createdDate 포함).
 */
async function listSpacePages(spaceKey) {
  const sp = await confluenceRequest('GET', `/wiki/api/v2/spaces?keys=${spaceKey}`);
  const spaceId = sp?.results?.[0]?.id;
  if (!spaceId) {
    console.warn(`⚠️ Space "${spaceKey}" not found.`);
    return [];
  }
  const all = [];
  let next = `/wiki/api/v2/pages?space-id=${spaceId}&limit=100`;
  while (next) {
    const res = await confluenceRequest('GET', next);
    for (const p of (res.results || [])) {
      all.push({
        id: p.id,
        title: p.title,
        createdDate: p.createdAt || p.history?.createdDate || null,
        parentId: p.parentId,
      });
    }
    next = nextPagePath(res);
  }
  return all;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let space = null;
  let from = null;
  let to = null;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--space=')) space = arg.split('=')[1];
    else if (arg.startsWith('--from=')) from = arg.split('=')[1];
    else if (arg.startsWith('--to=')) to = arg.split('=')[1];
    else if (arg === '--dry-run') dryRun = true;
  }

  if (!space) {
    console.error('사용법: node scripts/find_unmigrated.js --space=SD --from=YYYY-MM-DD [--to=YYYY-MM-DD] [--dry-run]');
    console.error(`  지원 스페이스: ${SUPPORTED_SPACES.join(', ')}`);
    process.exit(1);
  }

  return { space, from, to, dryRun };
}

async function main() {
  const { space, from, to, dryRun } = parseArgs();
  console.log(`=== 이관 누락 페이지 탐색 (${dryRun ? 'DRY-RUN' : 'EXEC'}) ===`);
  console.log(`소스: ${space}, 기간: ${from || '전체'} ~ ${to || '전체'}\n`);

  // 1) 소스 스페이스 페이지 조회
  console.log(`🔍 ${space} 스페이스 페이지 조회 중...`);
  const sourcePages = await listSpacePages(space);
  console.log(`   전체: ${sourcePages.length}개`);

  // 2) 날짜 필터
  const filtered = filterByDateRange(sourcePages, from, to);
  console.log(`   기간 필터 후: ${filtered.length}개\n`);

  if (filtered.length === 0) {
    console.log('✅ 해당 기간에 페이지 없음.');
    return;
  }

  // 3) AA 페이지 제목 집합
  console.log('🔍 AA 스페이스 페이지 조회 중...');
  const aaPages = await listAAPages();
  const aaTitles = new Set(aaPages.map(p => p.title));
  console.log(`   AA 페이지: ${aaPages.length}개\n`);

  // 4) 누락 페이지 탐색
  const unmigrated = findUnmigratedPages(filtered, aaTitles);
  console.log(`🎯 이관 누락: ${unmigrated.length}개\n`);

  if (unmigrated.length === 0) {
    console.log('✅ 모든 페이지가 이관됨.');
    return;
  }

  console.log('누락 목록:');
  for (const p of unmigrated) {
    const date = p.createdDate ? p.createdDate.split('T')[0] : '(알 수 없음)';
    console.log(`  📄 ${p.title} (${date}, id: ${p.id})`);
  }

  console.log(`\n총 ${unmigrated.length}개 누락.`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { filterByDateRange, findUnmigratedPages };
