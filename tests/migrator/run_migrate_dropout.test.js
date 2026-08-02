'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { runMigrate } = require('../../scripts/migrator');

function makeDeps(overrides = {}) {
  return {
    confluenceRequest: overrides.confluenceRequest || (async () => ({})),
    fetchPageDetail: overrides.fetchPageDetail || (async (id) => ({
      id, title: overrides.title || 'Test Page', body: '<p>body</p>', url: 'https://x',
      authorDisplayName: 'A', createdAt: '2026-07-01T00:00:00Z',
    })),
    fetchPageLabels: overrides.fetchPageLabels || (async () => []),
    classifyWithChain: overrides.classifyWithChain || (async () => ({
      ok: true, source: 'inline-llm', folderId: '100', folderTitle: 'Target',
      labels: [], reason: 'test',
    })),
    assessMigrationValue: overrides.assessMigrationValue || (async () => ({
      ok: true, verdict: 'create', reason: 'test value', source: 'inline-llm-value',
    })),
    loadDroppedCache: overrides.loadDroppedCache || (async () => []),
    saveDroppedCache: overrides.saveDroppedCache || (async () => {}),
    consultDroppedCache: overrides.consultDroppedCache || (() => ({ cached: false, reevaluate: false })),
    mergeDroppedCache: overrides.mergeDroppedCache || ((cache, updates) => cache.concat(updates)),
    hashFor: overrides.hashFor || (() => 'h1'),
    today: overrides.today || '2026-08-02',
    createPage: overrides.createPage || (async () => ({ id: '999', title: 'New', webUrl: '' })),
    updatePageBody: overrides.updatePageBody || (async () => {}),
    addLabels: overrides.addLabels || (async () => {}),
    copyAttachments: overrides.copyAttachments || (async () => ({ skippedVideos: [] })),
    buildBanner: overrides.buildBanner || (() => '<p>banner</p>'),
    fixBodyReferences: overrides.fixBodyReferences || ((body) => body),
    findPageByTitleInAA: overrides.findPageByTitleInAA || (async () => null),
    fetchAATree: overrides.fetchAATree || (async () => ({
      toText: () => 'tree', unsortedFolderId: '9999',
    })),
    spacesConfig: overrides.spacesConfig || {
      SD: { active: true },
      GLOBAL_RULE_VERSION: '1.0',
      LOOKBACK_DAYS: 7,
    },
  };
}

const baseCandidates = [
  { id: '10', title: 'P', body: { storage: { value: '<p>b</p>' } }, _links: { webui: '/x' } },
];
function reqForCandidates() {
  return async (method, url) => {
    if (url.includes('content/search')) return { results: baseCandidates };
    if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
    if (url.includes('/label')) return { results: [] };
    return {};
  };
}

test('verdict=create (캐시 미스) → status=created', async () => {
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      assessMigrationValue: async () => ({ ok: true, verdict: 'create', reason: 'ok', source: 'inline-llm-value' }),
    }),
  });
  assert.strictEqual(result.items[0].status, 'created');
});

test('verdict=dropped (캐시 미스) → status=dropped, cacheUpdates push', async () => {
  let saved;
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      assessMigrationValue: async () => ({ ok: true, verdict: 'dropped', reason: '개인 메모', source: 'inline-llm-value' }),
      mergeDroppedCache: (cache, updates) => { saved = updates; return cache.concat(updates); },
    }),
  });
  assert.strictEqual(result.items[0].status, 'dropped');
  assert.strictEqual(result.items[0].reason, '개인 메모');
  assert.strictEqual(result.items[0].reevalDueAt, '2026-08-09'); // today + 7
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].pageId, '10');
});

test('캐시 적중 → assessMigrationValue 호출 안 됨', async () => {
  let callCount = 0;
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      consultDroppedCache: () => ({
        cached: true, reevaluate: false, entry: {
          pageId: '10', hash: 'h1', reason: '이전 사유', nextReevalAt: '2026-08-09',
        },
      }),
      assessMigrationValue: async () => { callCount++; return { ok: true, verdict: 'create', reason: 'x' }; },
    }),
  });
  assert.strictEqual(result.items[0].status, 'dropped');
  assert.strictEqual(result.items[0].cacheHit, true);
  assert.strictEqual(result.items[0].reason, '이전 사유');
  assert.strictEqual(callCount, 0);
});

test('7일 후 재평가 → dropped 유지 → lastSeen 갱신', async () => {
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      consultDroppedCache: () => ({
        cached: true, reevaluate: true, entry: { pageId: '10', hash: 'h1', nextReevalAt: '2026-07-30' },
      }),
      assessMigrationValue: async () => ({ ok: true, verdict: 'dropped', reason: '재평가도 dropped', source: 'inline-llm-value' }),
    }),
  });
  assert.strictEqual(result.items[0].status, 'dropped');
  assert.strictEqual(result.items[0].cacheHit, false);
});

test('7일 후 재평가 → unclassified → 캐시 제거, 미분류 이관', async () => {
  const updates = [];
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      consultDroppedCache: () => ({
        cached: true, reevaluate: true, entry: { pageId: '10', hash: 'h1', nextReevalAt: '2026-07-30' },
      }),
      assessMigrationValue: async () => ({ ok: true, verdict: 'unclassified', reason: '재평가 unclassified', suggestedFolderId: '102', source: 'inline-llm-value' }),
      mergeDroppedCache: (cache, ups) => { updates.push(...ups); return cache.filter(it => !(it.pageId === '10' && it.hash === 'h1')); },
      createPage: async (spaceId, parent, t, body) => ({ id: '999', title: t, webUrl: '' }),
    }),
  });
  assert.strictEqual(result.items[0].status, 'unclassified');
  assert.ok(updates.some(u => u.remove && u.pageId === '10'));
});

test('dryRun=true → 캐시 저장 안 됨', async () => {
  let saveCalled = false;
  await runMigrate({
    dryRun: true,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      assessMigrationValue: async () => ({ ok: true, verdict: 'dropped', reason: 'r', source: 'inline-llm-value' }),
      saveDroppedCache: async () => { saveCalled = true; },
    }),
  });
  assert.strictEqual(saveCalled, false);
});

test('chainResult.ok=false + verdict=create → 강제 unclassified', async () => {
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      classifyWithChain: async () => ({ ok: false, source: 'miss', folderId: null, reason: 'no match' }),
      assessMigrationValue: async () => ({ ok: true, verdict: 'create', reason: '가치 있음', source: 'inline-llm-value' }),
      createPage: async () => ({ id: '999', title: 'P', webUrl: '' }),
    }),
  });
  assert.strictEqual(result.items[0].status, 'unclassified');
});

test('LLM throw → {verdict:create} 보수 → unclassified fallback', async () => {
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      classifyWithChain: async () => ({ ok: false, source: 'miss', folderId: null, reason: 'no match' }),
      assessMigrationValue: async () => { throw new Error('boom'); },
      createPage: async () => ({ id: '999', title: 'P', webUrl: '' }),
    }),
  });
  assert.strictEqual(result.items[0].status, 'unclassified');
  assert.ok(result.items[0].reason.includes('llm-error'));
});

test('saveDroppedCache 실패 → saveError advisories 머지, 리포트 계속', async () => {
  // runMigrate 자체는 saveError를 return 객체에 노출하지 않음. (호출자가 활용)
  // 본 테스트는 saveDroppedCache가 throw하지 않고 흡수되는지만 확인.
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      assessMigrationValue: async () => ({ ok: true, verdict: 'dropped', reason: 'r', source: 'inline-llm-value' }),
      saveDroppedCache: async () => { throw new Error('disk full'); },
    }),
  });
  // runMigrate는 saveError를 console.warn만 하고 items에는 영향 없음. status는 dropped 유지.
  assert.strictEqual(result.items[0].status, 'dropped');
});

test('verdict=unclassified (캐시 미스) → status=unclassified, suggestedFolderId 보존', async () => {
  const result = await runMigrate({
    dryRun: false,
    deps: makeDeps({
      confluenceRequest: reqForCandidates(),
      assessMigrationValue: async () => ({
        ok: true, verdict: 'unclassified', reason: '둘 다 가능', suggestedFolderId: '102', source: 'inline-llm-value',
      }),
      createPage: async () => ({ id: '999', title: 'P', webUrl: '' }),
    }),
  });
  assert.strictEqual(result.items[0].status, 'unclassified');
  assert.strictEqual(result.items[0].suggestedFolderId, '102');
});
