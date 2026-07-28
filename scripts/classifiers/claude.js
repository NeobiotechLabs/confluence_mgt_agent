'use strict';
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', '..', 'dify', 'system_prompt.md');
const KNOWLEDGE_PATH = path.join(__dirname, '..', '..', 'dify', 'space_rules_knowledge.md');

const MODEL = 'claude-haiku-4-5-20251001';

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

module.exports = { claudeClassifier, classify };
