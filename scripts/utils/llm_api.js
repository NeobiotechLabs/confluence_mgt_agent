'use strict';
// Anthropic SDK 1회 호출 wrapper. tool_use(select_folder) 결과를 {ok, folderId, labels, reason}으로 정규화.
// deps.client 주입 가능(테스트에서 네트워크 차단). 실패는 throw하지 않고 {ok:false}로 흡수해
// per-page try/catch와 호환되게 한다.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

async function callLLM({ client, system, user, tools, model, max_tokens = 1024 } = {}) {
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
    const toolUse = blocks.find(b => b && b.type === 'tool_use' && b.name === 'select_folder');
    if (!toolUse) return { ok: false, source: 'miss', reason: 'no-tool-use' };
    const { folderId, labels, reason } = toolUse.input || {};
    if (!folderId) return { ok: false, source: 'miss', reason: 'no-folder-id' };
    return {
      ok: true,
      source: 'inline-llm',
      folderId: String(folderId),
      labels: Array.isArray(labels) ? labels.filter(Boolean) : [],
      reason: reason || 'inline-llm',
    };
  } catch (e) {
    return { ok: false, source: 'miss', reason: `api-error:${e.message}` };
  }
}

module.exports = { callLLM, DEFAULT_MODEL };