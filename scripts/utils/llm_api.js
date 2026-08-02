'use strict';
// Anthropic SDK 1회 호출 wrapper. tool_use(select_folder) 결과를 정규화.
// deps.client 주입 가능(테스트에서 네트워크 차단). 실패는 throw하지 않고 {ok:false}로 흡수해
// per-page try/catch와 호환되게 한다.
// callLLMForClassification: 본문 기반 분류 전용 — prompt 조립 + confidence 해석을 추가한다.
const { buildSystemPrompt, buildUserMessage, SELECT_FOLDER_TOOL } = require('./classification_prompt');
const { buildValueSystemPrompt, buildValueUserMessage, SELECT_MIGRATION_VALUE_TOOL } = require('./value_prompt');
const { extractBodyText } = require('./content_extractor');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

async function callLLM({ client, system, user, tools, model, max_tokens = 1024, toolName = 'select_folder', valueMode = false } = {}) {
  const useModel = model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  if (!client) return { ok: false, source: 'miss', reason: 'no-client' };
  try {
    const msg = await client.messages.create({
      model: useModel,
      max_tokens,
      system,
      tools,
      messages: [{ role: 'user', content: user }],
    });
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const expectedName = valueMode ? 'select_migration_value' : (toolName || 'select_folder');
    const toolUse = blocks.find(b => b && b.type === 'tool_use' && b.name === expectedName);
    if (!toolUse) return { ok: false, source: 'miss', reason: 'no-tool-use' };
    if (valueMode) {
      const { verdict, reason, suggestedFolderId } = toolUse.input || {};
      return {
        ok: true,
        source: 'inline-llm-value',
        verdict,
        reason: reason || 'inline-llm-value',
        suggestedFolderId: suggestedFolderId || null,
      };
    }
    const { folderId, labels, reason, confidence } = toolUse.input || {};
    if (!folderId) {
      // 모델이 폴더는 비웠지만 reason을 남겼을 수 있다 — 의견으로 보존.
      return { ok: false, source: 'miss', reason: 'no-folder-id', opinion: reason || null };
    }
    return {
      ok: true,
      source: 'inline-llm',
      folderId: String(folderId),
      labels: Array.isArray(labels) ? labels.filter(Boolean) : [],
      reason: reason || 'inline-llm',
      confidence, // passthrough — 미상이면 undefined
    };
  } catch (e) {
    return { ok: false, source: 'miss', reason: `api-error:${e.message}` };
  }
}

/**
 * 본문 기반 분류 전용 LLM 호출. body(storage HTML 가능)는 extractBodyText로 평문 추출·절단된다.
 * confidence 'high'만 분류 성공으로 인정하고, 'low'/미상은 미분류행 miss로 정규화하되
 * 모델의 의견(reason)과 잠정 후보(suggestedFolderId)는 보존한다.
 */
async function callLLMForClassification({
  client, title, body, treeText, guidelines, model, max_tokens = 1024, callFn = callLLM,
} = {}) {
  const system = buildSystemPrompt({ treeText, guidelines });
  const user = buildUserMessage({ title, bodyText: extractBodyText(body) });
  const r = await callFn({ client, system, user, tools: [SELECT_FOLDER_TOOL], model, max_tokens });
  if (!r || !r.ok) {
    return { ok: false, source: 'miss', reason: r?.reason || 'miss', opinion: r?.opinion || null };
  }
  if (r.confidence !== 'high') {
    return {
      ok: false, source: 'miss', reason: 'low-confidence',
      opinion: r.reason || null, suggestedFolderId: r.folderId || null,
    };
  }
  return {
    ok: true, source: 'inline-llm', folderId: r.folderId,
    labels: r.labels || [], reason: r.reason || 'inline-llm', confidence: 'high',
  };
}

/**
 * 이관 가치 평가 전용 LLM 호출. 2차 분류 단계(작업 15).
 * 본문 + 1차 분류 힌트 → verdict 정규화. 실패는 throw하지 않고 {ok:false}로 흡수.
 */
async function callLLMForMigrationValue({
  client, title, body, treeText, classifyHint, guidelines, model, max_tokens = 512, callFn = callLLM,
} = {}) {
  const system = buildValueSystemPrompt({ treeText, guidelines });
  const user = buildValueUserMessage({ title, bodyText: extractBodyText(body), classifyHint });
  const isDefaultCallFn = callFn === callLLM;
  const r = await callFn({
    client, system, user, tools: [SELECT_MIGRATION_VALUE_TOOL], model, max_tokens,
    ...(isDefaultCallFn ? { valueMode: true } : {}),
  });
  if (!r || !r.ok) {
    return { ok: false, reason: (r && r.reason) || 'miss' };
  }
  const { verdict, reason, suggestedFolderId } = r;
  return {
    ok: true,
    verdict,
    reason: reason || 'inline-llm-value',
    suggestedFolderId: suggestedFolderId || null,
  };
}

module.exports = { callLLM, callLLMForClassification, callLLMForMigrationValue, DEFAULT_MODEL };
