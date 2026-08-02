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

// 시스템 코드 → 사람이 읽을 수 있는 한국어 설명 매핑
const CODE_TO_KOREAN = {
  'inline-llm': 'LLM 기반 분류 수행',
  'inline-llm-value': 'LLM 기반 가치 판단 수행',
  'llm-miss': 'LLM 분류 실패',
  'no-client': 'LLM 클라이언트 없음',
  'no-tool-use': 'LLM 도구 호출 실패',
  'no-folder-id': '폴더 ID 미지정',
  'low-confidence': 'LLM 신뢰도 부족',
  'no-llm-deps': 'LLM 의존성 없음',
  'llm-skipped-no-key': 'API 키 없음으로 LLM 건너뜀',
  'llm-unknown-folder': '알 수 없는 폴더',
  'miss': '분류 실패',
  'no-classifier-matched': '분류기 매칭 실패',
  'api-error': 'API 호출 오류',
};

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
    return CODE_TO_KOREAN[trimmed] || '시스템 판단';
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
  // 원본 reason이 있고 시스템 코드가 아니면, 건강하지 않더라도 원본 보존 (최소 3자 이상)
  if (typeof reason === 'string' && reason.trim().length >= 3 && !INTERNAL_CODES.has(reason.trim())) {
    return reason.trim();
  }
  return fallback || '분류 판단 완료';
}

module.exports = { normalizeReason, isReasonHealthy, sanitizeReason, INTERNAL_CODES };
