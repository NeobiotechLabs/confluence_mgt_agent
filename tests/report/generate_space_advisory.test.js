// tests/report/generate_space_advisory.test.js
// §4 AI 권고판을 정량 카운트("KB 미분류 N건")에서 LLM 생성 의미 있는 분석으로 전환.
// LLM이 폴더 구조 + 운영 데이터를 종합해 구체적 권고 3~5개를 반환.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateSpaceAdvisory } = require('../../scripts/report/report_lib');

// ── 정상 동작 ─────────────────────────────────────────────────────────────
test('LLM 응답을 줄 단위로 파싱해 advisory 배열 반환', async () => {
  // deps.client가 messages.create로 텍스트 블록을 반환하는 형태를 모킹
  const deps = {
    client: {
      messages: {
        async create({ messages }) {
          return {
            content: [{
              type: 'text',
              text: [
                'DN 폴더에 DN_로 시작하는 페이지가 13건 몰려 있습니다. 별도 서브폴더 추가를 권장합니다.',
                '미분류 14건 중 캘리브레이션 회의록 류가 7건 — guidelines §2 기준으로 명확히 부합합니다.',
                'KB 카테고리 매칭률이 낮습니다. 본문 예시 키워드를 추가하면 정확도가 개선됩니다.',
              ].join('\n'),
            }],
          };
        },
      },
    },
  };
  const ctx = {
    treeText: '- DN — Dynamic Navigation (id: f1)',
    folderPageCounts: { f1: 25 },
    unclassifiedPages: [{ id: 'p1', title: '캘리브레이션 회의록' }],
    kbUnknownSample: [{ id: 'p2', title: 'DN_화면설계' }],
    moves: [],
  };
  const result = await generateSpaceAdvisory(ctx, { model: 'mimo-v2.5-pro', max_tokens: 1024 }, deps);
  assert.ok(Array.isArray(result));
  assert.strictEqual(result.length, 3);
  assert.ok(result[0].includes('DN 폴더'));
  assert.ok(result[1].includes('캘리브레이션'));
  assert.ok(result[2].includes('KB 카테고리'));
});

test('LLM 응답에서 번호 매기기 ("1.", "2.", "-") 자동 제거', async () => {
  const deps = {
    client: {
      messages: {
        async create() {
          return {
            content: [{
              type: 'text',
              text: '1. 첫 번째 권고입니다.\n2) 두 번째 권고입니다.\n- 세 번째 권고입니다.',
            }],
          };
        },
      },
    },
  };
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm', max_tokens: 100 }, deps);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0], '첫 번째 권고입니다.');
  assert.strictEqual(result[1], '두 번째 권고입니다.');
  assert.strictEqual(result[2], '세 번째 권고입니다.');
});

test('빈 응답이면 빈 배열 반환', async () => {
  const deps = {
    client: {
      messages: {
        async create() {
          return { content: [{ type: 'text', text: '' }] };
        },
      },
    },
  };
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm', max_tokens: 100 }, deps);
  assert.deepStrictEqual(result, []);
});

test('빈 줄·공백만 있는 줄은 무시', async () => {
  const deps = {
    client: {
      messages: {
        async create() {
          return {
            content: [{
              type: 'text',
              text: '\n   \n\n실제 권고\n\n   \n두 번째 권고\n\n',
            }],
          };
        },
      },
    },
  };
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm', max_tokens: 100 }, deps);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0], '실제 권고');
  assert.strictEqual(result[1], '두 번째 권고');
});

test('최대 5개로 제한 (너무 많으면 잘라냄)', async () => {
  const deps = {
    client: {
      messages: {
        async create() {
          return {
            content: [{
              type: 'text',
              text: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].join('\n'),
            }],
          };
        },
      },
    },
  };
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm', max_tokens: 100 }, deps);
  assert.strictEqual(result.length, 5);
});

// ── 실패 시 graceful 퇴화 ────────────────────────────────────────────────
test('client 없으면 빈 배열 반환 + throw 안 함', async () => {
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm' }, { client: null });
  assert.deepStrictEqual(result, []);
});

test('client.messages.create throw해도 빈 배열 반환', async () => {
  const deps = {
    client: {
      messages: {
        async create() { throw new Error('network'); },
      },
    },
  };
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm', max_tokens: 100 }, deps);
  assert.deepStrictEqual(result, []);
});

test('응답이 text 블록이 아니면 (e.g. tool_use만) 빈 배열 반환', async () => {
  const deps = {
    client: {
      messages: {
        async create() {
          return { content: [{ type: 'tool_use', name: 'x', input: {} }] };
        },
      },
    },
  };
  const result = await generateSpaceAdvisory({ treeText: '', folderPageCounts: {} }, { model: 'm', max_tokens: 100 }, deps);
  assert.deepStrictEqual(result, []);
});

// ── 프롬프트 조립 ─────────────────────────────────────────────────────────
test('트리 + 미분류 + KB 미매칭 샘플이 user 메시지에 포함됨', async () => {
  let captured = null;
  const deps = {
    client: {
      messages: {
        async create({ messages }) {
          captured = messages;
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
    },
  };
  await generateSpaceAdvisory({
    treeText: '- DN (id: f1)',
    folderPageCounts: { f1: 25 },
    unclassifiedPages: [{ id: 'p1', title: '캘리브레이션 회의록' }],
    kbUnknownSample: [{ id: 'p2', title: 'DN_화면설계' }],
    moves: [],
  }, { model: 'm', max_tokens: 100 }, deps);
  const userMsg = captured[0].content;
  assert.ok(userMsg.includes('DN (id: f1)'), 'treeText 미포함');
  assert.ok(userMsg.includes('f1'), 'folderPageCounts 미포함');
  assert.ok(userMsg.includes('캘리브레이션 회의록'), 'unclassified 미포함');
  assert.ok(userMsg.includes('DN_화면설계'), 'kbUnknown 미포함');
});