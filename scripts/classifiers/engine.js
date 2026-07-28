// scripts/classifiers/engine.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { humanClassifier } = require('./human');
const { ruleClassifier } = require('./rule');

async function classifyWithChain(ctx, aaTree) {
  // 1) Human policy
  const human = await humanClassifier.classify(ctx, aaTree);
  if (human.ok) return human;

  // 2) Rule
  const rule = await ruleClassifier.classify(ctx, aaTree);
  if (rule.ok) return rule;

  // 3) Claude (optional)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { claudeClassifier } = require('./claude');
      const claude = await claudeClassifier.classify(ctx, aaTree);
      if (claude.ok) return claude;
    } catch (e) {
      console.warn('[classifiers] claude fallback failed:', e.message);
    }
  }

  // 4) Fallback
  return {
    ok: true,
    source: 'fallback',
    folderId: aaTree.unsortedFolderId,
    folderTitle: '미분류',
    labels: ['needs-review'],
    reason: 'no-classifier-matched',
  };
}

module.exports = { classifyWithChain };