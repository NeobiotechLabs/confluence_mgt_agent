// scripts/delete_aa_before.js
// 원본 작성일 기준으로 AA 스페이스 페이지를 일괄 삭제.
// 사용법: node scripts/delete_aa_before.js --before=2026-01-01 [--dry-run]
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { confluenceRequest } = require('./utils/confluence_api');
const { listAAPages } = require('./utils/aa_pages');

const PROTECTED_LABELS = new Set(['is-folder', 'bot-report', 'auto-report', 'human-classified']);
const DELETE_INTERVAL_MS = 300; // rate limit 보호
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 페이지 본문 HTML에서 배너의 "원본 작성일"을 추출.
 * @param {string} html - Confluence storage format HTML
 * @returns {string|null} 'YYYY-MM-DD' 또는 null
 */
function extractOriginalDate(html) {
  if (!html || typeof html !== 'string') return null;
  // 배너 형식: <tr><td><strong>원본 작성일</strong></td><td>2024-03-15</td></tr>
  const m = html.match(/<strong>원본 작성일<\/strong><\/td><td>(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * 보호 라벨이 없고 원본 작성일이 beforeDate 이전인 페이지를 추출.
 * @param {Array} pages - listAAPages() 결과
 * @param {Map<string, string>} dateMap - pageId → 'YYYY-MM-DD' 원본 작성일
 * @param {string} beforeDate - 'YYYY-MM-DD' 기준일 (이전이면 삭제)
 * @returns {Array} 삭제 후보 페이지
 */
function filterDeleteCandidates(pages, dateMap, beforeDate) {
  return pages.filter(p => {
    // 보호 라벨 체크
    if (p.labels && p.labels.some(l => PROTECTED_LABELS.has(l))) return false;
    // 날짜 추출 실패 → 제외 (보수적)
    const date = dateMap.get(p.id);
    if (!date) return false;
    // 날짜 비교: beforeDate 이전이면 삭제
    return date < beforeDate;
  });
}

/**
 * 페이지 본문을 가져와 원본 작성일을 추출.
 */
async function fetchOriginalDate(pageId) {
  try {
    const page = await confluenceRequest(
      'GET', `/wiki/api/v2/pages/${pageId}?body-format=storage`);
    const html = page.body?.storage?.value || '';
    return extractOriginalDate(html);
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let beforeDate = null;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--before=')) {
      beforeDate = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!beforeDate || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    console.error('사용법: node scripts/delete_aa_before.js --before=YYYY-MM-DD [--dry-run]');
    console.error('  --before=2026-01-01  2026년 1월 1일 이전에 원본 작성된 페이지 삭제');
    console.error('  --dry-run            삭제 없이 후보만 표시');
    process.exit(1);
  }

  return { beforeDate, dryRun };
}

async function main() {
  const { beforeDate, dryRun } = parseArgs();
  console.log(`=== AA 페이지 일괄 삭제 (${dryRun ? 'DRY-RUN' : 'EXEC'}) ===`);
  console.log(`기준일: ${beforeDate} 이전 원본 작성 페이지\n`);

  // 1) 전체 페이지 목록
  const pages = await listAAPages();
  console.log(`📋 전체 페이지: ${pages.length}개`);

  // 보호 라벨 제외
  const unprotected = pages.filter(p =>
    !p.labels || !p.labels.some(l => PROTECTED_LABELS.has(l)));
  console.log(`   보호 라벨 제외: ${unprotected.length}개\n`);

  // 2) 각 페이지의 원본 작성일 추출
  console.log('🔍 원본 작성일 추출 중...');
  const dateMap = new Map();
  let processed = 0;
  for (const p of unprotected) {
    const date = await fetchOriginalDate(p.id);
    if (date) dateMap.set(p.id, date);
    processed++;
    if (processed % 20 === 0) {
      console.log(`   ${processed}/${unprotected.length} 처리 완료...`);
    }
    await sleep(100); // rate limit
  }
  console.log(`   날짜 추출 성공: ${dateMap.size}/${unprotected.length}개\n`);

  // 3) 삭제 후보
  const candidates = filterDeleteCandidates(pages, dateMap, beforeDate);
  console.log(`🎯 삭제 후보: ${candidates.length}개`);

  if (candidates.length === 0) {
    console.log('\n✅ 삭제 대상 없음.');
    return;
  }

  // 후보 상세 출력
  console.log('\n삭제 대상:');
  for (const c of candidates) {
    const date = dateMap.get(c.id);
    console.log(`  🗑️ ${c.title} (원본: ${date}, id: ${c.id})`);
  }

  if (dryRun) {
    console.log(`\n[DRY] ${candidates.length}개 삭제 예정 (실행하지 않음)`);
    return;
  }

  // 4) 실행
  console.log(`\n⚠️  ${candidates.length}개 페이지를 삭제합니다. (3초 대기)`);
  await sleep(3000);

  let deleted = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await confluenceRequest('DELETE', `/wiki/rest/api/content/${c.id}`);
      deleted++;
      console.log(`  ✅ ${c.title}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${c.title}: ${e.message}`);
    }
    await sleep(DELETE_INTERVAL_MS);
  }

  console.log(`\n완료: ${deleted}개 삭제, ${failed}개 실패`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { extractOriginalDate, filterDeleteCandidates, PROTECTED_LABELS };
