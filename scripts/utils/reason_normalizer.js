'use strict';
// LLM 응답의 `reason` 필드 정규화 (작업 15 사이드 이펙 fix).
// 문제: mimo-v2.5 등 일부 모델이 tool_use 응답의 reason 필드에
//   "no-llm-deps", "llm-miss", "inline-llm" 같은 시스템 내부 코드명이나
//   일반적이지 않은 텍스트를 그대로 반환함.
// 해결: 두 단계 방어
//   1) 시스템 내부 코드명 화이트리스트 (정확히 일치 시) → 일반화 텍스트로 치환
//   2) 길이/문자/한국어 비율 휴리스틱 — LLM이 보낸 짧은 노이즈 reason을 감지하고 fallback
//
// 적용: scripts/utils/llm_api.js의 callLLMForClassification / callLLMForMigrationValue
//       둘 다 reason 필드를 이 모듈을 통과시킨다.

const INTERNAL_CODES = new Set([
  'inline-llm', 'inline-llm-value', 'llm-miss', 'no-client', 'no-tool-use',
  'no-folder-id', 'low-confidence', 'no-llm-deps', 'llm-skipped-no-key',
  'llm-unknown-folder', 'miss', 'no-classifier-matched', 'api-error',
]);

/**
 * 모델이 보낸 reason이 시스템 내부 코드명이면 → 사람이 읽을 수 있는 한국어 일반화로 치환.
 * 그렇지 않으면 입력 그대로 반환.
 * @param {string} reason
 * @returns {string}
 */
function normalizeReason(reason) {
  if (typeof reason !== 'string') return reason;
  const trimmed = reason.trim();
  if (!trimmed) return trimmed;
  if (INTERNAL_CODES.has(trimmed)) {
    return '분류 근거는 폴더 적합성만으로 충분';
  }
  return trimmed;
}

/**
 * reason의 품질을 검사해 의심스러우면 null 반환 (호출자가 기본값으로 대체).
 * 기준:
 *   - 길이 1~4자: 너무 짧음 (예: "ok", "ㅇㅇ")
 *   - 모두 구두점/공백/숫자만
 *   - 80자 이상: 모델이 설명을 너무 길게 늘림 (의심)
 *   - 한국어/영문/일본어/중국어 비율 0 (CJK 0%, 라틴 0%): 의미 없는 노이즈
 * @param {string} reason
 * @returns {string|null}  정상이면 reason, 의심스러우면 null
 */
function isReasonHealthy(reason) {
  if (typeof reason !== 'string') return false;
  const t = reason.trim();
  if (t.length < 5) return false; // 5자 미만은 너무 짧음
  if (t.length > 200) return false; // 200자 초과는 비정상
  // 의미 있는 문자(CJK, 라틴, 숫자)가 하나 이상 있어야 함
  const meaningful = t.match(/[가-힯぀-ヿ一-鿿A-Za-z0-9]/g);
  if (!meaningful || meaningful.length < 3) return false;
  return true;
}

/**
 * 최종 정규화: 내부 코드명 치환 + 품질 검사 + 양호하지 않으면 일반화된 기본 reason 반환.
 * @param {string} reason
 * @param {string} fallback  품질 검사 실패 시 사용할 기본 reason (폴더 분류 vs 가치 평가 컨텍스트별)
 * @returns {string}
 */
function sanitizeReason(reason, fallback) {
  const normalized = normalizeReason(reason);
  if (isReasonHealthy(normalized)) return normalized;
  return fallback || '분류 근거는 폴더 적합성만으로 충분';
}

module.exports = { normalizeReason, isReasonHealthy, sanitizeReason, INTERNAL_CODES };
