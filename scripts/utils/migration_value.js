'use strict';
// 단일 책임: classifyWithChain 다음의 가치 평가 단계.
// 분류(어디에 넣을지)와 가치(들일지 말지)는 다른 평가 기준이므로 LLM 호출을 분리한다.
// 7일 후 재평가 시에도 본 모듈만 재호출 — 분류 캐시(작업 16)와 자연 연결.

const ALLOWED = new Set(['create', 'unclassified', 'dropped']);

/**
 * 이관 가치 평가.
 * @param {Object} ctx - {pageId, title, body, classifyHint?: {folderId, labels}}
 * @param {Object} aaTree - {toText(): string, unsortedFolderId}
 * @param {Object} deps - {llm?: {callLLMForMigrationValue: Function}}
 * @returns {Promise<{ok: boolean, verdict: 'create'|'unclassified'|'dropped', reason: string, suggestedFolderId?: string|null, source: string, valueSource?: string}>}
 */
async function assessMigrationValue(ctx, aaTree, deps) {
  const llm = deps && deps.llm;
  // 1. llm deps 없음 → 보수적 'create' (운영 설정 이슈이지 페이지 가치 판단이 아님)
  if (!llm || typeof llm.callLLMForMigrationValue !== 'function') {
    return { ok: false, verdict: 'create', reason: 'no-llm-deps', source: 'miss' };
  }

  // 2. LLM 호출 (throw 흡수)
  let raw;
  try {
    raw = await llm.callLLMForMigrationValue({
      title: ctx.title,
      body: ctx.body,
      treeText: aaTree && typeof aaTree.toText === 'function' ? aaTree.toText() : '',
      classifyHint: ctx.classifyHint || null,
    });
  } catch (e) {
    return { ok: false, verdict: 'create', reason: `llm-error:${e.message}`, source: 'miss' };
  }

  // 3. 응답 정규화
  if (!raw || !raw.ok) {
    return { ok: false, verdict: 'create', reason: (raw && raw.reason) || 'miss', source: 'miss' };
  }

  // 4. verdict 검증
  const verdict = ALLOWED.has(raw.verdict) ? raw.verdict : 'create';
  const reason = verdict === raw.verdict
    ? (raw.reason || 'inline-llm-value')
    : `normalize:unknown-verdict:${raw.verdict || 'missing'}`;

  return {
    ok: true,
    verdict,
    reason,
    suggestedFolderId: raw.suggestedFolderId || null,
    source: 'inline-llm-value',
  };
}

module.exports = { assessMigrationValue };
