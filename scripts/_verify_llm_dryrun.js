'use strict';
// 사전 검증 스크립트: .env 토큰 + 모델로 단일 페이지 LLM 호출 결과 확인.
// 1) ANTHROPIC_BASE_URL + ANTHROPIC_MODEL + ANTHROPIC_API_KEY가 .env에 있어야 함
// 2) 단일 테스트 페이지(하드코딩)에 대해 classifyWithChain(1차) + assessMigrationValue(2차) 호출
// 3) reason이 시스템 내부 코드(no-llm-deps 등)가 아닌지 확인
// 4) 한국어 자연어 reason이 10~80자로 작성됐는지 확인
// 5) 결과 stdout 출력 (CI 확인용)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Anthropic } = require('@anthropic-ai/sdk');
const { classifyWithChain } = require('./classifiers/engine');
const { assessMigrationValue } = require('./utils/migration_value');
const { fetchAATree } = require('./utils/aa_space_tree');
const { INTERNAL_CODES } = require('./utils/reason_normalizer');

const INTERNAL = Array.from(INTERNAL_CODES);
const INTERNAL_PREFIXES = ['api-error:']; // prefix 매치 (api-error:XXX)

function isInternalReason(reason) {
  if (!reason) return false;
  const t = reason.trim();
  if (INTERNAL.includes(t)) return true;
  if (INTERNAL_PREFIXES.some(p => t.startsWith(p))) return true;
  return false;
}

function isHealthyLength(reason) {
  if (!reason) return false;
  const t = reason.trim();
  return t.length >= 10 && t.length <= 80;
}

async function main() {
  console.log('=== 환경 점검 ===');
  console.log(`  ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || '(unset)'}`);
  console.log(`  ANTHROPIC_MODEL:    ${process.env.ANTHROPIC_MODEL || '(unset)'}`);
  console.log(`  ANTHROPIC_API_KEY:  ${process.env.ANTHROPIC_API_KEY ? '(set)' : '(unset)'}`);
  console.log('');

  console.log('=== 1) AA 트리 로드 ===');
  const aaTree = await fetchAATree();
  const folderCount = Array.isArray(aaTree.flat) ? aaTree.flat.length : 0;
  console.log(`  AA 폴더 수: ${folderCount}`);
  console.log(`  unsortedFolderId: ${aaTree.unsortedFolderId}`);
  console.log('');

  const TEST_PAGE = {
    pageId: 'verify-001',
    title: 'SW - 2026 8월 월간 MPS (검증용)',
    body: '<p>SW R&D 8월 월간 진행 상황 보고. SW-001~005 과제 진행률 및 issue 정리.</p>',
    sourceSpace: 'SD',
    sourceUrl: 'https://verify',
    pageDate: '2026-08-02',
    existingLabels: [],
  };

  console.log('=== 2) classifyWithChain (분류 1차) ===');
  const start1 = Date.now();
  const r1 = await classifyWithChain({
    pageId: TEST_PAGE.pageId,
    title: TEST_PAGE.title,
    body: TEST_PAGE.body,
    ancestors: [],
    sourceSpace: TEST_PAGE.sourceSpace,
    sourceUrl: TEST_PAGE.sourceUrl,
    pageDate: TEST_PAGE.pageDate,
    existingLabels: TEST_PAGE.existingLabels,
  }, aaTree);
  const ms1 = Date.now() - start1;
  console.log(`  소요: ${ms1}ms`);
  console.log(`  ok: ${r1.ok}`);
  console.log(`  source: ${r1.source}`);
  console.log(`  folderId: ${r1.folderId}`);
  console.log(`  folderTitle: ${r1.folderTitle || '(none)'}`);
  console.log(`  labels: ${JSON.stringify(r1.labels)}`);
  console.log(`  reason: "${r1.reason}"`);
  console.log(`  reason length: ${r1.reason ? r1.reason.length : 0}`);
  console.log('');

  console.log('=== 3) reason 품질 검증 (1차) ===');
  const isInternal1 = isInternalReason(r1.reason);
  const isHealthyLen1 = isHealthyLength(r1.reason);
  console.log(`  내부 코드? ${isInternal1 ? '❌ FAIL' : '✅ OK'}`);
  console.log(`  10~80자 한국어? ${isHealthyLen1 ? '✅ OK' : '⚠️ 짧거나 김 (' + (r1.reason || '').length + '자)'}`);
  console.log('');

  // ── 2차 분류: 가치 평가 (assessMigrationValue) ──
  console.log('=== 4) assessMigrationValue (가치 평가 2차) ===');
  const start2 = Date.now();
  const r2 = await assessMigrationValue({
    pageId: TEST_PAGE.pageId,
    title: TEST_PAGE.title,
    body: TEST_PAGE.body,
    classifyHint: { folderId: r1.folderId, labels: r1.labels || [] },
  }, aaTree);
  const ms2 = Date.now() - start2;
  console.log(`  소요: ${ms2}ms`);
  console.log(`  ok: ${r2.ok}`);
  console.log(`  verdict: ${r2.verdict}`);
  console.log(`  reason: "${r2.reason}"`);
  console.log(`  reason length: ${r2.reason ? r2.reason.length : 0}`);
  console.log('');
  const isInternal2 = isInternalReason(r2.reason);
  const isHealthyLen2 = isHealthyLength(r2.reason);
  console.log('=== 5) reason 품질 검증 (2차) ===');
  console.log(`  내부 코드? ${isInternal2 ? '❌ FAIL' : '✅ OK'}`);
  console.log(`  10~80자 한국어? ${isHealthyLen2 ? '✅ OK' : '⚠️ 짧거나 김 (' + (r2.reason || '').length + '자)'}`);
  console.log('');

  // ── 3번째 페이지: 끄적임 테스트 ──
  console.log('=== 6) 3번째 페이지 (끄적임 테스트) ===');
  const TEST_PAGE_2 = {
    pageId: 'verify-002',
    title: '내 개인 메모 - 테스트 결과',
    body: '<p>오늘 점심 뭐 먹지...</p>',
    sourceSpace: 'SD',
    sourceUrl: 'https://verify2',
    pageDate: '2026-08-02',
    existingLabels: [],
  };
  const r3 = await classifyWithChain({
    pageId: TEST_PAGE_2.pageId,
    title: TEST_PAGE_2.title,
    body: TEST_PAGE_2.body,
    ancestors: [],
    sourceSpace: TEST_PAGE_2.sourceSpace,
    sourceUrl: TEST_PAGE_2.sourceUrl,
    pageDate: TEST_PAGE_2.pageDate,
    existingLabels: TEST_PAGE_2.existingLabels,
  }, aaTree);
  console.log(`  1차 reason: "${r3.reason}"`);
  const isInternal3 = isInternalReason(r3.reason);
  const isHealthyLen3 = isHealthyLength(r3.reason);
  console.log(`  내부 코드? ${isInternal3 ? '❌ FAIL' : '✅ OK'}`);
  console.log(`  10~80자 한국어? ${isHealthyLen3 ? '✅ OK' : '⚠️ 짧거나 김'}`);
  console.log('');

  console.log('=== 종합 ===');
  const allOk = !isInternal1 && !isInternal2 && !isInternal3;
  console.log(allOk ? '✅ reason 정규화 정상 동작' : '❌ reason에 시스템 코드 잔존');
  process.exit(allOk ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });

