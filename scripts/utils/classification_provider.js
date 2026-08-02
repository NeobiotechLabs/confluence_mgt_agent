'use strict';
// 분류 체인 오케스트레이터: human → structural → inline-llm(본문) → fallback(미분류+의견).
// rule 단계 제거(2026-07-31 재설계) — 제목 regex 대신 자연어 지침 + 본문 기반 LLM 판단.
// deps.humanClassifier / deps.llm.callLLM 주입으로 테스트 격리.
// ANTHROPIC_API_KEY 없으면 llm 단계 skip (비용/안전 가드).

// 시스템 내부 코드 → 사람이 읽을 수 있는 한국어 설명 (리포트 노출용)
const CODE_TO_KOREAN = {
  'inline-llm': 'LLM 기반 분류 수행',
  'llm-unknown-folder': 'LLM이 알 수 없는 폴더 지정',
  'no-llm-deps': 'LLM 의존성 없음',
  'llm-skipped-no-key': 'API 키 없음으로 LLM 건너뜀',
  'no-client': 'LLM 클라이언트 없음',
  'no-tool-use': 'LLM 도구 호출 실패',
  'no-folder-id': '폴더 ID 미지정',
  'low-confidence': 'LLM 신뢰도 부족',
  'miss': '분류 실패',
  'api-error': 'API 호출 오류',
};

function humanizeReason(reason) {
  if (typeof reason !== 'string') return reason || '분류 실패';
  return CODE_TO_KOREAN[reason.trim()] || reason;
}

function fallback(aaTree, info = {}) {
  return {
    ok: true,
    source: 'fallback',
    folderId: aaTree.unsortedFolderId,
    folderTitle: '미분류',
    labels: ['needs-review'],
    reason: humanizeReason(info.reason) || '분류 실패',
    llmOpinion: info.opinion || null,
    suggestedFolderId: info.suggestedFolderId || null,
  };
}

/**
 * 구조적 검증: 이미 유효 폴더에 있으면 LLM 호출 없이 현 위치 유지.
 * 미분류 폴더에 있거나, 트리 미지 폴더거나, hasFolder가 없는 스텁 트리면 null(체인 계속).
 */
function structuralCheck(ctx, aaTree) {
  const cur = ctx && ctx.currentFolderId;
  if (!cur) return null;
  if (cur === aaTree.unsortedFolderId) return null;
  if (typeof aaTree.hasFolder !== 'function' || !aaTree.hasFolder(cur)) return null;
  const folderTitle = Array.isArray(aaTree.flat)
    ? aaTree.flat.find(f => f.id === cur)?.title
    : undefined;
  return {
    ok: true,
    source: 'structural',
    folderId: cur,
    folderTitle,
    labels: [],
    reason: 'already-in-folder',
  };
}

async function classifyPage(ctx, aaTree, deps) {
  const { humanClassifier, llm } = deps || {};
  const systemHasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  // 0) human decision (classification_decisions.json, prior human UI moves)
  if (humanClassifier && typeof humanClassifier.classify === 'function') {
    let humanResult = null;
    try {
      humanResult = await humanClassifier.classify(ctx, aaTree);
    } catch (_) {
      humanResult = null;
    }
    if (humanResult && humanResult.ok && humanResult.folderId) return humanResult;
  }

  // 1) structural check (이미 폴더에 있으면 LLM 호출 절감)
  const structural = structuralCheck(ctx, aaTree);
  if (structural) return structural;

  // 2) inline-llm — 본문 기반 1차 판단자 (키 없으면 skip)
  if (systemHasKey && llm && typeof llm.callLLM === 'function') {
    let llmResult = null;
    try {
      llmResult = await llm.callLLM({ ctx, aaTree });
    } catch (_) {
      llmResult = null;
    }
    if (llmResult && llmResult.ok && llmResult.folderId) {
      const folderId = String(llmResult.folderId);
      if (typeof aaTree.hasFolder === 'function' && !aaTree.hasFolder(folderId)) {
        return fallback(aaTree, { reason: 'llm-unknown-folder', opinion: llmResult.reason || null });
      }
      const folderTitle = Array.isArray(aaTree.flat)
        ? aaTree.flat.find(f => f.id === folderId)?.title
        : undefined;
      return {
        ok: true,
        source: 'inline-llm',
        folderId,
        folderTitle,
        labels: Array.isArray(llmResult.labels) ? llmResult.labels.filter(Boolean) : [],
        reason: llmResult.reason || humanizeReason('inline-llm'),
        confidence: 'high',
      };
    }
    // low-confidence / miss — 의견은 fallback에 실어 코멘트 첨부 등에 쓴다.
    return fallback(aaTree, {
      reason: (llmResult && llmResult.opinion) || '분류 실패',
      opinion: (llmResult && llmResult.opinion) || null,
      suggestedFolderId: (llmResult && llmResult.suggestedFolderId) || null,
    });
  }

  // 3) fallback (키 부재 또는 llm deps 없음)
  return fallback(aaTree, { reason: systemHasKey ? 'no-llm-deps' : 'llm-skipped-no-key' });
}

module.exports = { classifyPage, fallback, structuralCheck };
