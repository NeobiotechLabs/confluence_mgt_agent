'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../../scripts/classifiers/claude');

test('claude returns ok:false when API key missing', async () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const ctx = { title: 'test', body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '', pageDate: '2026-07-28', existingLabels: [] };
    const aaTree = { flat: [], tree: {}, unsortedFolderId: 'u', toText: () => '', hasFolder: () => false };
    const result = await classify(ctx, aaTree);
    assert.strictEqual(result.ok, false);
  } finally {
    if (savedKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedKey;
    }
  }
});
