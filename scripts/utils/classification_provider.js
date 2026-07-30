'use strict';
// 분류 체인 오케스트레이터: rule → inline-llm → fallback(unsortedFolderId, needs-review).
// deps.ruleClassifier / deps.llm.callLLM / deps.aaTree 주입으로 테스트 격리.
// ANTHROPIC_API_KEY 없으면 llm 단계 skip (비용/안전 가드).

function fallback(aaTree) {
  return {
    ok: true,
    source: 'fallback',
    folderId: aaTree.unsortedFolderId,
    folderTitle: '미분류',
    labels: ['needs-review'],
    reason: 'no-classifier-matched',
  };
}

async function classifyPage(ctx, aaTree, deps) {
  const { ruleClassifier, llm } = deps || {};
  const systemHasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  // 1) rule
  let ruleResult = null;
  try {
    if (ruleClassifier && typeof ruleClassifier.classify === 'function') {
      ruleResult = await ruleClassifier.classify(ctx, aaTree);
    }
  } catch (_) {
    ruleResult = null;
  }
  if (ruleResult && ruleResult.ok && ruleResult.folderId) return ruleResult;

  // 2) inline-llm (키 없으면 skip)
  if (systemHasKey && llm && typeof llm.callLLM === 'function') {
    let llmResult = null;
    try {
      llmResult = await llm.callLLM({ ctx, aaTree });
    } catch (_) {
      llmResult = null;
    }
    if (llmResult && llmResult.ok && llmResult.folderId) {
      return {
        ok: true,
        source: 'inline-llm',
        folderId: String(llmResult.folderId),
        folderTitle: llmResult.folderTitle,
        labels: Array.isArray(llmResult.labels) ? llmResult.labels.filter(Boolean) : [],
        reason: llmResult.reason || 'inline-llm',
      };
    }
  }

  // 3) fallback
  return fallback(aaTree);
}

module.exports = { classifyPage, fallback };
