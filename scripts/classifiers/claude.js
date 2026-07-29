'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', '..', 'dify', 'system_prompt.md');
const KNOWLEDGE_PATH = path.join(__dirname, '..', '..', 'dify', 'space_rules_knowledge.md');

// 모델은 env 로 오버라이드 가능 (기본: Claude Haiku).
// 사내 LLM 게이트웨이(예: Alibaba MaaS) 사용 시 해당 게이트웨이가 제공하는
// 모델명(예: qwen3.8-max-preview)을 ANTHROPIC_MODEL 로 지정해야 한다.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

async function classify(ctx, aaTree) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, source: 'miss' };

  const { Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8')
    + '\n\n<knowledge>\n' + fs.readFileSync(KNOWLEDGE_PATH, 'utf8') + '\n</knowledge>';

  const tools = [
    {
      name: 'select_folder',
      description: 'Pick exactly one folder ID from the AA tree.',
      input_schema: {
        type: 'object',
        required: ['folderId'],
        properties: {
          folderId: { type: 'string', description: 'AA folder ID' },
          labels: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
  ];

  const userPrompt = `# Target Document
- Title: ${ctx.title}
- Source: ${ctx.sourceSpace}
- Date: ${ctx.pageDate}

# AA Tree
<context_tree>
${aaTree.toText()}
</context_tree>

Pick the best folder, or omit folderId if none fit.`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = msg.content.find(block => block.type === 'tool_use' && block.name === 'select_folder');
    if (!toolUse) return { ok: false, source: 'miss' };
    const folderId = toolUse.input.folderId;
    if (!folderId || !aaTree.hasFolder(folderId)) return { ok: false, source: 'miss' };
    const folder = aaTree.flat.find(f => f.id === folderId);
    return {
      ok: true,
      source: 'claude',
      folderId,
      folderTitle: folder?.title,
      labels: toolUse.input.labels || [],
      reason: toolUse.input.reason || 'claude-tooluse',
    };
  } catch (e) {
    console.warn('[claude] API error:', e.message);
    return { ok: false, source: 'miss' };
  }
}

const claudeClassifier = { name: 'claude', classify };

module.exports = { claudeClassifier, classify, MODEL };
