'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeReason,
  isReasonHealthy,
  sanitizeReason,
  INTERNAL_CODES,
} = require('../../scripts/utils/reason_normalizer');

// ── normalizeReason ────────────────────────────────────────────────────
test('normalizeReason: 시스템 내부 코드명 → 일반화 텍스트로 치환', () => {
  assert.strictEqual(normalizeReason('no-llm-deps'), '분류 근거는 폴더 적합성만으로 충분');
  assert.strictEqual(normalizeReason('inline-llm'), '분류 근거는 폴더 적합성만으로 충분');
  assert.strictEqual(normalizeReason('miss'), '분류 근거는 폴더 적합성만으로 충분');
  assert.strictEqual(normalizeReason('llm-miss'), '분류 근거는 폴더 적합성만으로 충분');
  assert.strictEqual(normalizeReason('low-confidence'), '분류 근거는 폴더 적합성만으로 충분');
});

test('normalizeReason: 정상 한국어 reason은 그대로', () => {
  assert.strictEqual(
    normalizeReason('MPS 월간 보고 양식으로 팀 단위 계획 문서'),
    'MPS 월간 보고 양식으로 팀 단위 계획 문서'
  );
  assert.strictEqual(
    normalizeReason('SW 4월 월간 MPS — R&D 진행 상황 정리'),
    'SW 4월 월간 MPS — R&D 진행 상황 정리'
  );
});

test('normalizeReason: 빈 문자열·공백·null은 그대로 반환', () => {
  assert.strictEqual(normalizeReason(''), '');
  assert.strictEqual(normalizeReason('   '), '');
  assert.strictEqual(normalizeReason(null), null);
  assert.strictEqual(normalizeReason(undefined), undefined);
});

test('normalizeReason: 앞뒤 공백은 trim', () => {
  assert.strictEqual(normalizeReason('  한국어 reason  '), '한국어 reason');
});

test('normalizeReason: 영문 자연어 reason은 그대로', () => {
  assert.strictEqual(
    normalizeReason('MPS monthly report format'),
    'MPS monthly report format'
  );
});

// ── isReasonHealthy ────────────────────────────────────────────────────
test('isReasonHealthy: 짧은 텍스트 (<5자) → false', () => {
  assert.strictEqual(isReasonHealthy('ok'), false);
  assert.strictEqual(isReasonHealthy('ㅇㅇ'), false);
  assert.strictEqual(isReasonHealthy('yes'), false);
  assert.strictEqual(isReasonHealthy('1'), false);
});

test('isReasonHealthy: 긴 텍스트 (>200자) → false', () => {
  const long = '가'.repeat(201);
  assert.strictEqual(isReasonHealthy(long), false);
});

test('isReasonHealthy: 의미 있는 문자 0~2개 → false', () => {
  assert.strictEqual(isReasonHealthy('   '), false); // 의미 문자 0
  assert.strictEqual(isReasonHealthy('!!!'), false); // 의미 문자 0
  assert.strictEqual(isReasonHealthy('a'), false); // 1자
  assert.strictEqual(isReasonHealthy('ab'), false); // 2자
});

test('isReasonHealthy: 정상 한국어 reason → true', () => {
  assert.strictEqual(isReasonHealthy('MPS 월간 보고'), true);
  assert.strictEqual(isReasonHealthy('SW 4월 진행 상황'), true);
  assert.strictEqual(isReasonHealthy('Device HW 조사 결과'), true);
});

test('isReasonHealthy: 혼합 (한글+영문+숫자) → true', () => {
  assert.strictEqual(isReasonHealthy('2026 AI 전략 문서'), true);
});

test('isReasonHealthy: 비문자열 → false', () => {
  assert.strictEqual(isReasonHealthy(null), false);
  assert.strictEqual(isReasonHealthy(undefined), false);
  assert.strictEqual(isReasonHealthy(123), false);
});

// ── sanitizeReason ────────────────────────────────────────────────────
test('sanitizeReason: 정상 reason → 그대로', () => {
  assert.strictEqual(
    sanitizeReason('MPS 월간 보고 양식'),
    'MPS 월간 보고 양식'
  );
});

test('sanitizeReason: 내부 코드 → 일반화', () => {
  assert.strictEqual(
    sanitizeReason('no-llm-deps'),
    '분류 근거는 폴더 적합성만으로 충분'
  );
});

test('sanitizeReason: 짧은 노이즈 → fallback', () => {
  assert.strictEqual(
    sanitizeReason('ok', '폴더 분류 불가, 사람 검토 필요'),
    '폴더 분류 불가, 사람 검토 필요'
  );
  assert.strictEqual(
    sanitizeReason('yes', '폴더 분류 불가, 사람 검토 필요'),
    '폴더 분류 불가, 사람 검토 필요'
  );
});

test('sanitizeReason: 정상 + 기본 fallback 미지정 → 기본 텍스트', () => {
  assert.strictEqual(
    sanitizeReason('ok'),
    '분류 근거는 폴더 적합성만으로 충분'
  );
});

test('sanitizeReason: 빈 reason → fallback', () => {
  assert.strictEqual(
    sanitizeReason('', '가치 판단 보류'),
    '가치 판단 보류'
  );
});

test('sanitizeReason: 200자 정확히 → true (경계값)', () => {
  const t = '가'.repeat(200);
  assert.strictEqual(isReasonHealthy(t), true);
  assert.strictEqual(sanitizeReason(t), t);
});

test('sanitizeReason: 201자 → fallback', () => {
  const t = '가'.repeat(201);
  assert.strictEqual(sanitizeReason(t, 'fallback'), 'fallback');
});

// ── INTERNAL_CODES set ────────────────────────────────────────────────
test('INTERNAL_CODES: 작업 15에서 사용된 모든 시스템 코드 포함', () => {
  const expected = [
    'inline-llm', 'inline-llm-value', 'llm-miss', 'no-client', 'no-tool-use',
    'no-folder-id', 'low-confidence', 'no-llm-deps', 'llm-skipped-no-key',
    'llm-unknown-folder', 'miss', 'no-classifier-matched', 'api-error',
  ];
  for (const code of expected) {
    assert.ok(INTERNAL_CODES.has(code), `${code} should be in INTERNAL_CODES`);
  }
});
