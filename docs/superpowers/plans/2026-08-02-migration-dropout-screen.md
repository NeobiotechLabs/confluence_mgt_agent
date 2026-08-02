# 작업 15 — 이관 탈락 후보 판정 (Migration Dropout Screening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM 본문 기반 분류 체인(작업 11) 위에 **가치 평가 단계를 추가**해 이관 후보를 3상태(`created/synced` / `unclassified` / `dropped`)로 분기하고, dropped 페이지는 SSOT 캐시 + 7일 자동 재평가로 LLM 호출을 절감한다.

**Architecture:** `classifyWithChain`(어디에 넣을지) 다음에 `assessMigrationValue`(들일지 말지)를 **별도 LLM 호출**로 분리. `reference/dropped_pages.json` SSOT로 (pageId, hash) 키 캐시. 7일 후 자동 재평가. `runMigrate`에 deps 주입 6개 + 5-status 분기.

**Tech Stack:** Node 18+, `node:test` + `node:assert`, Anthropic SDK (Haiku 4.5), Confluence v2 REST, fs atomic write.

**Reference Spec:** `docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md`

---

## Global Constraints

- 모든 외부 의존은 `deps` 객체로 주입. `runMigrate`의 기본값은 실 모듈, 테스트는 mock.
- LLM 키 부재 시 `assessMigrationValue`는 보수적 `'create'` 반환 (분류 가치 판단 실패 = 일단 이관).
- `chainResult.ok=false && verdict='create'` → verdict 강제 `'unclassified'` (분류 실패 상태에서 정상 폴더 생성 방지).
- throw 흡수: `assessMigrationValue` / `loadDroppedCache` / `saveDroppedCache` 모두 throw하지 않음.
- 7일 재평가: `firstSeen + 7일 <= today` 가 되어야 LLM 재호출.
- 1 PR = 1 머지 (브랜치는 `feature/migration-dropout`). PR 4개 분할.
- 모든 신규/수정 후 `npm test` 287/287 PASS, `npm run report:aa:dryrun` 정상.
- 모듈 위치: `scripts/utils/...` / `scripts/migrator/...` / `tests/...` (기존 규약).
- `reference/dropped_pages.json` 빈 배열 `[]`로 시작.

---

## File Structure (계획 종료 시점)

| 파일 | 종류 | 책임 |
|---|---|---|
| `scripts/utils/value_prompt.js` | 신규 | value용 tool 스키마 + system/user 빌더 |
| `scripts/utils/migration_value.js` | 신규 | `assessMigrationValue` 단일 책임 |
| `scripts/utils/llm_api.js` | 수정 | `callLLMForMigrationValue` 추가 |
| `scripts/migrator/dropped_cache.js` | 신규 | SSOT I/O + consult/merge + hashFor |
| `scripts/migrator.js` | 수정 | deps 6개 + 5-status 분기 + 캐시 upsert/remove |
| `scripts/report/render.js` | 수정 | `migrateSection` 5그룹, dropped/unclassified 컬럼 |
| `tests/utils/value_prompt.test.js` | 신규 | prompt 빌더 단위 |
| `tests/utils/migration_value.test.js` | 신규 | assessMigrationValue 단위 (8건) |
| `tests/migrator/dropped_cache.test.js` | 신규 | 캐시 I/O (10건) |
| `tests/migrator/run_migrate_dropout.test.js` | 신규 | runMigrate 통합 (10건) |
| `tests/report/render_migrate_dropout.test.js` | 신규 | render 그룹 5종 (6건) |
| `reference/dropped_pages.json` | 신규 | 빈 배열 `[]` (런타임) |
| `reference/classification_rules.md` | 수정 | §5 신설 |
| `reference/ToDo.md` | 수정 | 작업 15 완료 표시 |
| `package.json` | 수정 | `migration:dropped:list` 스크립트 |

---

## Task Map

| # | 산출물 | 의존 |
|---|---|---|
| 1 | value_prompt.js + value_prompt.test.js | (없음) |
| 2 | migration_value.js + migration_value.test.js | Task 1 |
| 3 | llm_api.js 확장 + 마이그레이션 테스트 1건 | Task 2 |
| 4 | dropped_cache.js + dropped_cache.test.js | (없음, PR 2 단독) |
| 5 | run_migrate_dropout.test.js (RED) — 실패 확인 | Task 3, 4 |
| 6 | runMigrate 통합 (GREEN) | Task 5 |
| 7 | render.js + render_migrate_dropout.test.js | Task 6 |
| 8 | 운영 스크립트 + 문서 | Task 7 |
| 9 | 회귀 가드 + 최종 검증 | Task 8 |

PR 4개 분할:
- **PR 1**: Task 1, 2, 3
- **PR 2**: Task 4
- **PR 3**: Task 5, 6, 7
- **PR 4**: Task 8, 9

---

### Task 1: `value_prompt.js` + value_prompt 테스트

**Files:**
- Create: `scripts/utils/value_prompt.js`
- Create: `tests/utils/value_prompt.test.js`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `SELECT_MIGRATION_VALUE_TOOL`, `buildValueSystemPrompt({treeText, guidelines}) → string`, `buildValueUserMessage({title, bodyText, classifyHint}) → string`

- [ ] **Step 1: 테스트 파일 작성**

`tests/utils/value_prompt.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  SELECT_MIGRATION_VALUE_TOOL,
  buildValueSystemPrompt,
  buildValueUserMessage,
} = require('../../scripts/utils/value_prompt');

test('SELECT_MIGRATION_VALUE_TOOL: name=select_migration_value', () => {
  assert.strictEqual(SELECT_MIGRATION_VALUE_TOOL.name, 'select_migration_value');
});

test('SELECT_MIGRATION_VALUE_TOOL: verdict enum = [create, unclassified, dropped]', () => {
  const props = SELECT_MIGRATION_VALUE_TOOL.input_schema.properties;
  assert.deepStrictEqual(props.verdict.enum, ['create', 'unclassified', 'dropped']);
});

test('SELECT_MIGRATION_VALUE_TOOL: verdict + reason 필수, suggestedFolderId 옵션', () => {
  const schema = SELECT_MIGRATION_VALUE_TOOL.input_schema;
  assert.ok(schema.required.includes('verdict'));
  assert.ok(schema.required.includes('reason'));
  assert.ok(!schema.required.includes('suggestedFolderId'));
});

test('buildValueSystemPrompt: treeText + guidelines 포함', () => {
  const out = buildValueSystemPrompt({ treeText: 'TREE', guidelines: 'GL' });
  assert.ok(out.includes('TREE'));
  assert.ok(out.includes('GL'));
  assert.ok(out.includes('select_migration_value'));
});

test('buildValueSystemPrompt: treeText/guidelines 비어도 안전', () => {
  const out = buildValueSystemPrompt({});
  assert.ok(typeof out === 'string');
  assert.ok(out.length > 0);
});

test('buildValueUserMessage: title + bodyText + classifyHint 포함', () => {
  const out = buildValueUserMessage({
    title: 'A',
    bodyText: 'B',
    classifyHint: { folderId: '100', labels: ['doctype-report'] },
  });
  assert.ok(out.includes('A'));
  assert.ok(out.includes('B'));
  assert.ok(out.includes('100'));
  assert.ok(out.includes('doctype-report'));
});

test('buildValueUserMessage: classifyHint 없으면 "(분류 없음)" placeholder', () => {
  const out = buildValueUserMessage({ title: 'A', bodyText: 'B' });
  assert.ok(out.includes('(분류 없음)'));
});
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `npm test -- tests/utils/value_prompt.test.js`
Expected: FAIL (`Cannot find module '../../scripts/utils/value_prompt'`)

- [ ] **Step 3: `scripts/utils/value_prompt.js` 구현**

```js
'use strict';
// LLM 가치 평가(v2) 프롬프트 조립. 도구 스키마 + system/user 빌더.
// 분류(작업 11)와 동일 패턴 — 책임 분리.

const SELECT_MIGRATION_VALUE_TOOL = {
  name: 'select_migration_value',
  description: '조직·과제 입장에서 이관 가치를 평가한다. 3종 verdict 중 하나만 응답한다.',
  input_schema: {
    type: 'object',
    required: ['verdict', 'reason'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['create', 'unclassified', 'dropped'],
        description: 'create: 이관 가치 있음. unclassified: 가치는 있으나 분류 애매. dropped: 가치 없음(끄적임/임시 스크랩).',
      },
      reason: {
        type: 'string',
        description: '판단 근거 1~2문장.',
      },
      suggestedFolderId: {
        type: 'string',
        description: 'verdict=unclassified일 때 추천 폴더 ID. 그 외는 생략 가능.',
      },
    },
  },
};

function buildValueSystemPrompt({ treeText, guidelines } = {}) {
  return [
    '당사는 사내 Confluence AA 스페이스(덴탈AI연구소 Archive)로 외부 스페이스 문서를 자동 이관하는 시스템이다.',
    '분류 체인(classifyWithChain)이 폴더 위치를 선정한 뒤, 당신은 두 번째 단계로 **이관 가치**를 평가한다.',
    '조직·과제 입장에서 AA에 보관할 가치가 있는지가 핵심 — 본문 의미 해석이 아니라 업무적 가치 판단이다.',
    '',
    '반드시 select_migration_value 도구를 정확히 한 번 호출해서 응답한다. 텍스트로만 답하지 않는다.',
    '',
    '## verdict 기준',
    '- create: 조직·과제 입장에서 업무 가치가 있어 AA에 보관할 만함.',
    '- unclassified: 가치는 있지만 현재 폴더 구조 어디에도 명확히 부합하지 않음. suggestedFolderId로 추천 폴더를 명시.',
    '- dropped: 개인 메모, 임시 캡처, 학습 노트, 외부 스페이스의 임시 스냅샷 등. AA 보관 가치 없음.',
    '',
    '## 참고 — 1차 분류 결과',
    '<classify_hint>',
    '(system 프롬프트에는 placeholder; buildValueUserMessage에서 채워짐)',
    '</classify_hint>',
    '',
    '## 현재 AA 폴더 트리 (참고)',
    '<folder_tree>',
    treeText || '(트리 없음)',
    '</folder_tree>',
    '',
    '## 분류 지침 (참고)',
    '<guidelines>',
    guidelines || '(지침 없음)',
    '</guidelines>',
    '',
    '## 주의',
    '- 본문 앞머리의 "자동 이관 문서" 배너는 메타데이터다. 분류/가치 판단 근거로 쓰지 않는다.',
    '- 빈 본문·짧은 본문이라도 verdict를 보류하지 말고 본문/제목으로 판단한다.',
  ].join('\n');
}

function buildValueUserMessage({ title, bodyText, classifyHint } = {}) {
  const hint = classifyHint
    ? `후보 폴더: ${classifyHint.folderId || '(없음)'}\n라벨: ${(classifyHint.labels || []).join(', ') || '(없음)'}`
    : '(분류 없음)';
  return [
    '# 대상 문서',
    `- 제목: ${title || '(없음)'}`,
    '',
    '# 1차 분류 결과 (참고)',
    hint,
    '',
    '# 본문 발췌 (앞부분)',
    bodyText || '(비어 있음)',
  ].join('\n');
}

module.exports = {
  SELECT_MIGRATION_VALUE_TOOL,
  buildValueSystemPrompt,
  buildValueUserMessage,
};
```

- [ ] **Step 4: 테스트 실행 → PASS 확인**

Run: `npm test -- tests/utils/value_prompt.test.js`
Expected: 7/7 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/utils/value_prompt.js tests/utils/value_prompt.test.js
git commit -m "feat(value_prompt): 이관 가치 평가 도구 스키마 + 빌더 (작업 15)"
```

---

### Task 2: `migration_value.js` + assessMigrationValue 테스트

**Files:**
- Create: `scripts/utils/migration_value.js`
- Create: `tests/utils/migration_value.test.js`

**Interfaces:**
- Consumes: `callLLMForMigrationValue` (Task 3에서 추가). 테스트에서는 mock.
- Produces: `assessMigrationValue(ctx, aaTree, deps) → {ok:true, verdict, reason, suggestedFolderId?, source, valueSource?}` 또는 `{ok:false, verdict:'create', reason:'llm-error:…'}`

- [ ] **Step 1: 테스트 파일 작성**

`tests/utils/migration_value.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { assessMigrationValue } = require('../../scripts/utils/migration_value');

function makeDeps(llmResult) {
  return {
    llm: { callLLMForMigrationValue: async () => llmResult },
  };
}

test('assessMigrationValue: verdict=create → 그대로 반환', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree', unsortedFolderId: '999' },
    makeDeps({ ok: true, verdict: 'create', reason: '보통 회의록' })
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'create');
  assert.strictEqual(r.reason, '보통 회의록');
  assert.strictEqual(r.source, 'inline-llm-value');
});

test('assessMigrationValue: verdict=unclassified + suggestedFolderId 보존', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree', unsortedFolderId: '999' },
    makeDeps({ ok: true, verdict: 'unclassified', reason: '둘 다 가능', suggestedFolderId: '102' })
  );
  assert.strictEqual(r.verdict, 'unclassified');
  assert.strictEqual(r.suggestedFolderId, '102');
});

test('assessMigrationValue: verdict=dropped + reason 보존', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree', unsortedFolderId: '999' },
    makeDeps({ ok: true, verdict: 'dropped', reason: '개인 메모' })
  );
  assert.strictEqual(r.verdict, 'dropped');
  assert.strictEqual(r.reason, '개인 메모');
});

test('assessMigrationValue: LLM throw → {ok:false, verdict:create}', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    { llm: { callLLMForMigrationValue: async () => { throw new Error('boom'); } } }
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'create');
  assert.ok(r.reason.includes('boom'));
});

test('assessMigrationValue: llm deps 없음 → verdict=create 보수 fallback', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    {} // no llm
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'create');
  assert.ok(r.reason.includes('no-llm-deps'));
});

test('assessMigrationValue: 모르는 verdict enum → create로 정규화', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    makeDeps({ ok: true, verdict: 'unknown', reason: 'x' })
  );
  assert.strictEqual(r.verdict, 'create');
  assert.ok(r.reason.includes('normalize'));
});

test('assessMigrationValue: verdict 누락 → create로 정규화', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    makeDeps({ ok: true, reason: 'x' })
  );
  assert.strictEqual(r.verdict, 'create');
});

test('assessMigrationValue: llm 응답 ok=false → create 보수 fallback', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    makeDeps({ ok: false, reason: 'no-folder-id' })
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'create');
  assert.strictEqual(r.reason, 'no-folder-id');
});
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `npm test -- tests/utils/migration_value.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: `scripts/utils/migration_value.js` 구현**

```js
'use strict';
// 단일 책임: classifyWithChain 다음의 가치 평가 단계.
// 분류(어디에 넣을지)와 가치(들일지 말지)는 다른 평가 기준이므로 LLM 호출을 분리한다.
// 7일 후 재평가 시에도 본 모듈만 재호출 — 분류 캐시(작업 16)와 자연 연결.

const ALLOWED = new Set(['create', 'unclassified', 'dropped']);

/**
 * 이관 가치 평가.
 * @param {Object} ctx - {pageId, title, body, classifyHint?: {folderId, labels}}
 * @param {Object} aaTree - {toText(): string, unsortedFolderId}
 * @param {Object} deps - {llm?: {callLLMForMigrationValue: Function}}
 * @returns {Promise<{ok: boolean, verdict: 'create'|'unclassified'|'dropped', reason: string, suggestedFolderId?: string|null, source: string, valueSource?: string}>}
 */
async function assessMigrationValue(ctx, aaTree, deps) {
  const llm = deps && deps.llm;
  // 1. llm deps 없음 → 보수적 'create' (운영 설정 이슈이지 페이지 가치 판단이 아님)
  if (!llm || typeof llm.callLLMForMigrationValue !== 'function') {
    return { ok: false, verdict: 'create', reason: 'no-llm-deps', source: 'miss' };
  }

  // 2. LLM 호출 (throw 흡수)
  let raw;
  try {
    raw = await llm.callLLMForMigrationValue({
      title: ctx.title,
      body: ctx.body,
      treeText: aaTree && typeof aaTree.toText === 'function' ? aaTree.toText() : '',
      classifyHint: ctx.classifyHint || null,
    });
  } catch (e) {
    return { ok: false, verdict: 'create', reason: `llm-error:${e.message}`, source: 'miss' };
  }

  // 3. 응답 정규화
  if (!raw || !raw.ok) {
    return { ok: false, verdict: 'create', reason: (raw && raw.reason) || 'miss', source: 'miss' };
  }

  // 4. verdict 검증
  const verdict = ALLOWED.has(raw.verdict) ? raw.verdict : 'create';
  const reason = verdict === raw.verdict
    ? (raw.reason || 'inline-llm-value')
    : `normalize:unknown-verdict:${raw.verdict || 'missing'}`;

  return {
    ok: true,
    verdict,
    reason,
    suggestedFolderId: raw.suggestedFolderId || null,
    source: 'inline-llm-value',
  };
}

module.exports = { assessMigrationValue };
```

- [ ] **Step 4: 테스트 실행 → PASS 확인**

Run: `npm test -- tests/utils/migration_value.test.js`
Expected: 8/8 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/utils/migration_value.js tests/utils/migration_value.test.js
git commit -m "feat(migration_value): LLM 가치 평가 단계 추가 (작업 15)"
```

---

### Task 3: `llm_api.js` 확장 + callLLMForMigrationValue

**Files:**
- Modify: `scripts/utils/llm_api.js:1-69` (import + 추가 export)
- Create: `tests/utils/llm_api_value.test.js`

**Interfaces:**
- Consumes: `value_prompt` (Task 1에서 작성), `extractBodyText` (기존)
- Produces: `callLLMForMigrationValue({client, title, body, treeText, classifyHint, guidelines, model, max_tokens, callFn}) → {ok, verdict, reason, suggestedFolderId?}` (ok=false면 reason 포함)

- [ ] **Step 1: 테스트 파일 작성**

`tests/utils/llm_api_value.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { callLLMForMigrationValue } = require('../../scripts/utils/llm_api');

function fakeClient(toolInput) {
  return {
    messages: {
      create: async () => ({
        content: toolInput === null
          ? [{ type: 'text', text: 'no tool use' }]
          : [{ type: 'tool_use', name: 'select_migration_value', input: toolInput }],
      }),
    },
  };
}

test('callLLMForMigrationValue: 정상 — verdict=dropped', async () => {
  const r = await callLLMForMigrationValue({
    client: fakeClient({ verdict: 'dropped', reason: '개인 메모' }),
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'dropped');
  assert.strictEqual(r.reason, '개인 메모');
});

test('callLLMForMigrationValue: 정상 — unclassified + suggestedFolderId', async () => {
  const r = await callLLMForMigrationValue({
    client: fakeClient({ verdict: 'unclassified', reason: '둘 다', suggestedFolderId: '102' }),
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'unclassified');
  assert.strictEqual(r.suggestedFolderId, '102');
});

test('callLLMForMigrationValue: tool_use 없음 → ok=false', async () => {
  const r = await callLLMForMigrationValue({
    client: fakeClient(null),
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-tool-use');
});

test('callLLMForMigrationValue: client 없음 → ok=false, reason=no-client', async () => {
  const r = await callLLMForMigrationValue({
    client: null, title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-client');
});

test('callLLMForMigrationValue: client throw → ok=false, reason=api-error:…', async () => {
  const r = await callLLMForMigrationValue({
    client: { messages: { create: async () => { throw new Error('boom'); } } },
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.startsWith('api-error:'));
});
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `npm test -- tests/utils/llm_api_value.test.js`
Expected: FAIL (`callLLMForMigrationValue is not a function`)

- [ ] **Step 3: `llm_api.js` 확장**

기존 import 라인 (`require('./classification_prompt')`) 옆에 value_prompt도 import:

```js
const { buildSystemPrompt, buildUserMessage, SELECT_FOLDER_TOOL } = require('./classification_prompt');
const { buildValueSystemPrompt, buildValueUserMessage, SELECT_MIGRATION_VALUE_TOOL } = require('./value_prompt');
const { extractBodyText } = require('./content_extractor');
```

기존 `module.exports`에 `callLLMForMigrationValue` 추가. 함수는 파일 끝(`module.exports` 직전)에 삽입:

```js
/**
 * 이관 가치 평가 전용 LLM 호출. 2차 분류 단계(작업 15).
 * 본문 + 1차 분류 힌트 → verdict 정규화. 실패는 throw하지 않고 {ok:false}로 흡수.
 */
async function callLLMForMigrationValue({
  client, title, body, treeText, classifyHint, guidelines, model, max_tokens = 512, callFn = callLLM,
} = {}) {
  const system = buildValueSystemPrompt({ treeText, guidelines });
  const user = buildValueUserMessage({ title, bodyText: extractBodyText(body), classifyHint });
  const r = await callFn({ client, system, user, tools: [SELECT_MIGRATION_VALUE_TOOL], model, max_tokens });
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
```

`module.exports` 수정:

```js
module.exports = { callLLM, callLLMForClassification, callLLMForMigrationValue, DEFAULT_MODEL };
```

- [ ] **Step 4: 테스트 실행 → PASS 확인**

Run: `npm test -- tests/utils/llm_api_value.test.js`
Expected: 5/5 PASS

기존 llm_api 테스트 회귀 확인:

Run: `npm test -- tests/utils/llm_api.test.js`
Expected: 기존 4/4 PASS 유지

- [ ] **Step 5: Commit**

```bash
git add scripts/utils/llm_api.js tests/utils/llm_api_value.test.js
git commit -m "feat(llm_api): callLLMForMigrationValue 추가 (작업 15)"
```

---

### Task 4: `dropped_cache.js` + 10건 테스트

**Files:**
- Create: `scripts/migrator/dropped_cache.js`
- Create: `tests/migrator/dropped_cache.test.js`
- Create: `reference/dropped_pages.json` (빈 배열)

**Interfaces:**
- Consumes: `fs` (atomic write, graceful load)
- Produces:
  - `loadDroppedCache(file) → Array<{pageId, sourceSpace, title, hash, reason, firstSeen, lastSeen, nextReevalAt}>`
  - `saveDroppedCache(file, items)` — 원자적 쓰기
  - `consultDroppedCache(pageId, hash, today, cache) → {cached: bool, reevaluate: bool, entry?: Object}`
  - `mergeDroppedCache(cache, updates) → Array` — upsert/remove
  - `shouldReevaluate(entry, today) → bool`
  - `hashFor(page) → string` (pageId + length + 200자 sha1 → 16자 hex)

- [ ] **Step 1: 빈 SSOT 파일 생성**

`reference/dropped_pages.json`:
```json
[]
```

- [ ] **Step 2: 테스트 파일 작성**

`tests/migrator/dropped_cache.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadDroppedCache,
  saveDroppedCache,
  consultDroppedCache,
  mergeDroppedCache,
  shouldReevaluate,
  hashFor,
} = require('../../scripts/migrator/dropped_cache');

// ── loadDroppedCache ─────────────────────────────────────────────────────
test('loadDroppedCache: 파일 부재 → []', () => {
  const file = path.join(os.tmpdir(), `dropped-missing-${Date.now()}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  assert.deepStrictEqual(loadDroppedCache(file), []);
});

test('loadDroppedCache: 깨진 JSON → []', () => {
  const file = path.join(os.tmpdir(), `dropped-bad-${Date.now()}.json`);
  fs.writeFileSync(file, '{not json', 'utf8');
  assert.deepStrictEqual(loadDroppedCache(file), []);
});

test('loadDroppedCache: 객체이지만 배열 아님 → []', () => {
  const file = path.join(os.tmpdir(), `dropped-obj-${Date.now()}.json`);
  fs.writeFileSync(file, '{"foo": 1}', 'utf8');
  assert.deepStrictEqual(loadDroppedCache(file), []);
});

test('loadDroppedCache: pageId 없는 항목은 skip', () => {
  const file = path.join(os.tmpdir(), `dropped-schema-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify([{ pageId: '1' }, { foo: 1 }, null]), 'utf8');
  const out = loadDroppedCache(file);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].pageId, '1');
});

// ── saveDroppedCache ─────────────────────────────────────────────────────
test('saveDroppedCache: 원자적 쓰기 + 부모 디렉터리 자동 생성', () => {
  const dir = path.join(os.tmpdir(), `dropped-dir-${Date.now()}`);
  const file = path.join(dir, 'sub', 'dropped.json');
  saveDroppedCache(file, [{ pageId: '1', hash: 'h', reason: 'r', firstSeen: '2026-08-01', lastSeen: '2026-08-01', nextReevalAt: '2026-08-08' }]);
  assert.ok(fs.existsSync(file));
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].pageId, '1');
  // .tmp 잔존 없음
  assert.ok(!fs.existsSync(file + '.tmp'));
});

// ── shouldReevaluate ────────────────────────────────────────────────────
test('shouldReevaluate: nextReevalAt <= today → true', () => {
  assert.strictEqual(shouldReevaluate({ nextReevalAt: '2026-08-02' }, '2026-08-02'), true);
  assert.strictEqual(shouldReevaluate({ nextReevalAt: '2026-08-01' }, '2026-08-02'), true);
});

test('shouldReevaluate: nextReevalAt > today → false', () => {
  assert.strictEqual(shouldReevaluate({ nextReevalAt: '2026-08-09' }, '2026-08-02'), false);
});

// ── consultDroppedCache ─────────────────────────────────────────────────
test('consultDroppedCache: 캐시 미스 → {cached:false, reevaluate:false}', () => {
  const r = consultDroppedCache('p1', 'h1', '2026-08-02', []);
  assert.deepStrictEqual(r, { cached: false, reevaluate: false });
});

test('consultDroppedCache: 캐시 적중 + 재평가 미도래 → cached, !reevaluate', () => {
  const cache = [{ pageId: 'p1', hash: 'h1', nextReevalAt: '2026-08-09' }];
  const r = consultDroppedCache('p1', 'h1', '2026-08-02', cache);
  assert.strictEqual(r.cached, true);
  assert.strictEqual(r.reevaluate, false);
  assert.strictEqual(r.entry.pageId, 'p1');
});

test('consultDroppedCache: 캐시 적중 + 재평가 도래 → cached, reevaluate', () => {
  const cache = [{ pageId: 'p1', hash: 'h1', nextReevalAt: '2026-08-01' }];
  const r = consultDroppedCache('p1', 'h1', '2026-08-02', cache);
  assert.strictEqual(r.cached, true);
  assert.strictEqual(r.reevaluate, true);
});

// ── mergeDroppedCache ───────────────────────────────────────────────────
test('mergeDroppedCache: 새 항목 upsert', () => {
  const out = mergeDroppedCache([], [{ pageId: 'p1', hash: 'h1', reason: 'r', firstSeen: '2026-08-02', lastSeen: '2026-08-02', nextReevalAt: '2026-08-09' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].pageId, 'p1');
});

test('mergeDroppedCache: 기존 항목 lastSeen + nextReevalAt 갱신, firstSeen 유지', () => {
  const cache = [{ pageId: 'p1', hash: 'h1', reason: 'r', firstSeen: '2026-07-20', lastSeen: '2026-07-20', nextReevalAt: '2026-07-27' }];
  const out = mergeDroppedCache(cache, [{ pageId: 'p1', hash: 'h1', reason: 'r2', firstSeen: '2026-07-20', lastSeen: '2026-08-02', nextReevalAt: '2026-08-09' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].firstSeen, '2026-07-20');
  assert.strictEqual(out[0].lastSeen, '2026-08-02');
  assert.strictEqual(out[0].reason, 'r2');
});

test('mergeDroppedCache: {remove:true} → 제거', () => {
  const cache = [{ pageId: 'p1', hash: 'h1' }, { pageId: 'p2', hash: 'h2' }];
  const out = mergeDroppedCache(cache, [{ remove: true, pageId: 'p1', hash: 'h1' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].pageId, 'p2');
});

// ── hashFor ─────────────────────────────────────────────────────────────
test('hashFor: 동일 입력 → 동일 hash', () => {
  const a = hashFor({ id: '1', title: 'T', body: 'B' });
  const b = hashFor({ id: '1', title: 'T', body: 'B' });
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 16);
});

test('hashFor: 다른 body → 다른 hash', () => {
  const a = hashFor({ id: '1', title: 'T', body: 'B1' });
  const b = hashFor({ id: '1', title: 'T', body: 'B2' });
  assert.notStrictEqual(a, b);
});
```

- [ ] **Step 3: 테스트 실행 → FAIL 확인**

Run: `npm test -- tests/migrator/dropped_cache.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 4: `scripts/migrator/dropped_cache.js` 구현**

```js
// scripts/migrator/dropped_cache.js
'use strict';
// reference/dropped_pages.json SSOT — 이관 탈락(dropped) 페이지 캐시.
// unmatched_state_io와 같은 패턴: 부재/깨짐 graceful, 원자적 쓰기.
// 추가 책임: consult (캐시 적중 + 7일 재평가 게이트), merge (upsert/remove), hash.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * reference/dropped_pages.json SSOT 로더. 부재/깨짐/스키마 위반은 모두 []로 우아 퇴화.
 * @param {string} file
 * @returns {Array<{pageId, sourceSpace?, title?, hash, reason?, firstSeen?, lastSeen?, nextReevalAt?}>}
 */
function loadDroppedCache(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  let parsed;
  try { parsed = JSON.parse(txt); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(it => it && typeof it.pageId === 'string' && typeof it.hash === 'string');
}

/**
 * 원자적 쓰기. 부모 디렉터리 자동 생성. .tmp → rename.
 * @param {string} file
 * @param {Array} items
 */
function saveDroppedCache(file, items) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 재평가 도래 여부. nextReevalAt <= today → true.
 * @param {{nextReevalAt?: string}} entry
 * @param {string} today  YYYY-MM-DD
 */
function shouldReevaluate(entry, today) {
  if (!entry || !entry.nextReevalAt) return true; // 안전: 방어적
  return entry.nextReevalAt <= today;
}

/**
 * 캐시 조회.
 * @returns {{cached: boolean, reevaluate: boolean, entry?: Object}}
 */
function consultDroppedCache(pageId, hash, today, cache) {
  const entry = cache.find(it => it.pageId === pageId && it.hash === hash);
  if (!entry) return { cached: false, reevaluate: false };
  const reevaluate = shouldReevaluate(entry, today);
  return { cached: true, reevaluate, entry };
}

/**
 * 캐시 머지. update 항목이 {remove:true}면 제거, 아니면 upsert.
 * @param {Array} cache
 * @param {Array} updates
 * @returns {Array} 새 배열 (입력 mutate 안 함)
 */
function mergeDroppedCache(cache, updates) {
  const out = cache.slice();
  for (const u of updates) {
    if (u.remove) {
      const idx = out.findIndex(it => it.pageId === u.pageId && it.hash === u.hash);
      if (idx >= 0) out.splice(idx, 1);
      continue;
    }
    const idx = out.findIndex(it => it.pageId === u.pageId && it.hash === u.hash);
    if (idx >= 0) {
      out[idx] = { ...out[idx], ...u, firstSeen: out[idx].firstSeen || u.firstSeen };
    } else {
      out.push(u);
    }
  }
  return out;
}

/**
 * 페이지 해시. pageId + 본문 길이 + 본문 앞 200자 → sha1 → 16자 hex.
 * 본문이 바뀌면 hash가 바뀌어 재평가 트리거.
 * @param {{id: string, title?: string, body?: string}} page
 * @returns {string}
 */
function hashFor(page) {
  const id = page && page.id ? String(page.id) : '';
  const body = page && page.body ? String(page.body) : '';
  const head = body.substring(0, 200);
  return crypto.createHash('sha1').update(`${id}|${body.length}|${head}`).digest('hex').substring(0, 16);
}

module.exports = {
  loadDroppedCache,
  saveDroppedCache,
  shouldReevaluate,
  consultDroppedCache,
  mergeDroppedCache,
  hashFor,
};
```

- [ ] **Step 5: 테스트 실행 → PASS 확인**

Run: `npm test -- tests/migrator/dropped_cache.test.js`
Expected: 14/14 PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/migrator/dropped_cache.js tests/migrator/dropped_cache.test.js reference/dropped_pages.json
git commit -m "feat(dropped_cache): 이관 탈락 SSOT + consult/merge/hashFor (작업 15)"
```

---

### Task 5: `run_migrate_dropout.test.js` RED — 실패 확인

**Files:**
- Create: `tests/migrator/run_migrate_dropout.test.js`

**Interfaces (확정):**
- `runMigrate` deps에 6개 추가: `assessMigrationValue`, `loadDroppedCache`, `saveDroppedCache`, `consultDroppedCache`, `mergeDroppedCache`, `hashFor`, `today`
- 새 status: `unclassified`, `dropped`
- `items[].cacheHit?: boolean`, `items[].reevalDueAt?: string` (YYYY-MM-DD)

- [ ] **Step 1: 테스트 파일 작성 (10건)**

`tests/migrator/run_migrate_dropout.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행 → RED 확인**

Run: `npm test -- tests/migrator/run_migrate_dropout.test.js`
Expected: 모든 테스트가 `status` 또는 필드 부재로 FAIL (runMigrate가 새 deps/status를 아직 모름).

- [ ] **Step 3: Commit (RED 단계 기록)**

```bash
git add tests/migrator/run_migrate_dropout.test.js
git commit -m "test(run_migrate): 작업 15 RED — dropout 5-status 분기 테스트 추가"
```

---

### Task 6: `migrator.js` 통합 — GREEN

**Files:**
- Modify: `scripts/migrator.js:60-287` (runMigrate 본문)
- Modify: `scripts/migrator.js:491` (module.exports)
- Modify: `scripts/classifiers/engine.js:1-47` (assessMigrationValue deps 등록은 선택)

- [ ] **Step 1: `migrator.js` 상단 import + deps 추가**

기존 import 라인(`require('./utils/migration_utils')`) 다음에 추가:

```js
const { assessMigrationValue } = require('./utils/migration_value');
const {
  loadDroppedCache,
  saveDroppedCache,
  consultDroppedCache,
  mergeDroppedCache,
  hashFor,
} = require('./migrator/dropped_cache');

const DROPPED_CACHE_PATH = path.join(__dirname, '..', 'reference', 'dropped_pages.json');
```

`runMigrate` deps 주입 블록 (lines 73-85) 끝에 추가:

```js
  const _assessMigrationValue = deps.assessMigrationValue || assessMigrationValue;
  const _loadDroppedCache = deps.loadDroppedCache || loadDroppedCache;
  const _saveDroppedCache = deps.saveDroppedCache || saveDroppedCache;
  const _consultDroppedCache = deps.consultDroppedCache || consultDroppedCache;
  const _mergeDroppedCache = deps.mergeDroppedCache || mergeDroppedCache;
  const _hashFor = deps.hashFor || hashFor;
  const _today = deps.today || new Date().toISOString().slice(0, 10);
```

- [ ] **Step 2: 캐시 로드 + today 결정 (for 루프 시작 전)**

`for (const sourceSpace of activeSpaceKeys)` 직전에 삽입:

```js
  // 4-0. Dropped 캐시 로드 (graceful — 부재/깨짐 모두 []로 퇴화)
  let droppedCache = [];
  let saveError = null;
  try {
    droppedCache = await _loadDroppedCache(DROPPED_CACHE_PATH);
  } catch (e) {
    droppedCache = [];
    saveError = `load-dropped-cache:${e.message}`;
  }
  const cacheUpdates = [];
  const today = _today;
```

- [ ] **Step 3: 페이지 루프 본문 재작성 — verdict 분기**

`for (const page of candidates)` 루프 안쪽 `try {` 블록의 **classification 결과 → items.push 전**까지를 다음 흐름으로 교체.

기존 코드 (lines 142-265, 약 120줄)를 다음으로 교체:

```js
    for (const page of candidates) {
      const pageBody = page.body?.storage?.value || '';
      const truncatedBody = pageBody.substring(0, 20000);

      try {
        const srcMeta = await _fetchPageDetail(page.id);
        const pageDate = srcMeta.createdAt ? srcMeta.createdAt.substring(0, 10) : '';

        const existingLabels = await _fetchPageLabels(page.id);
        const chainResult = await _classifyWithChain({
          pageId: page.id,
          title: page.title,
          body: truncatedBody,
          ancestors: [],
          sourceSpace,
          sourceUrl: page._links?.webui || '',
          pageDate,
          existingLabels,
        }, aaTree);

        // ── 1차: 분류 verdict 정규화
        const classificationOk = chainResult.ok && chainResult.folderId;
        const decision = classificationOk ? {
          is_valid: true,
          target_folder_id: chainResult.folderId,
          target_folder_title: chainResult.folderTitle,
          needs_new_category: false,
          reason: chainResult.reason,
          labels: chainResult.labels,
          classifier_source: chainResult.source,
        } : {
          is_valid: false,
          target_folder_id: null,
          needs_new_category: false,
          reason: chainResult.reason || 'no-classifier-matched',
          classifier_source: chainResult.source || 'miss',
        };

        // ── 2차: 캐시 조회
        const hash = _hashFor({ id: page.id, title: page.title, body: truncatedBody });
        const cacheResult = _consultDroppedCache(page.id, hash, today, droppedCache);

        // ── 3차: 가치 평가 (캐시 적중 + 재평가 미도래면 skip)
        let verdict, valueReason, valueSource, cacheHit = false, reevalDueAt = null;
        if (cacheResult.cached && !cacheResult.reevaluate) {
          verdict = 'dropped';
          valueReason = cacheResult.entry.reason;
          valueSource = 'cache';
          cacheHit = true;
          reevalDueAt = cacheResult.entry.nextReevalAt;
        } else {
          const value = await _assessMigrationValue({
            pageId: page.id,
            title: page.title,
            body: truncatedBody,
            classifyHint: {
              folderId: decision.target_folder_id,
              labels: decision.labels || [],
            },
          }, aaTree);
          verdict = value.verdict;
          valueReason = value.reason;
          valueSource = value.source;
          reevalDueAt = addDays(today, 7);

          // 분류 실패 + 가치 create → 강제 unclassified
          if (!classificationOk && verdict === 'create') {
            verdict = 'unclassified';
            valueReason = `${valueReason} + chain-fail`;
          }

          // dropped → 캐시 upsert, unclassified/create (재평가) → 캐시에서 제거
          if (verdict === 'dropped') {
            cacheUpdates.push({
              pageId: page.id,
              sourceSpace,
              title: page.title,
              hash,
              reason: valueReason,
              firstSeen: cacheResult.entry ? cacheResult.entry.firstSeen : today,
              lastSeen: today,
              nextReevalAt: reevalDueAt,
            });
          } else if (cacheResult.cached) {
            // unclassified 또는 create로 부활 → 캐시에서 제거
            cacheUpdates.push({ remove: true, pageId: page.id, hash });
          }
        }

        // ── 4차: 분기
        if (verdict === 'dropped') {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: null,
            targetFolderTitle: null,
            status: 'dropped',
            classifierSource: decision.classifier_source,
            reason: valueReason,
            reevalDueAt,
            cacheHit,
          });
          continue;
        }

        if (verdict === 'unclassified') {
          // 미분류 폴더에 이관. chain이 unsortedFolderId를 줬으면 그대로, 아니면 폴백.
          const targetFolderId = String(decision.target_folder_id || aaTree.unsortedFolderId);
          if (String(targetFolderId) !== String(aaTree.unsortedFolderId)) {
            // 분류는 성공했지만 verdict=unclassified인 경우: 폴더를 미분류로 강제
            decision.target_folder_id = aaTree.unsortedFolderId;
            decision.target_folder_title = '미분류';
            decision.labels = (decision.labels || []).filter(l => l !== 'needs-review');
          }
          // 강제로 미분류 폴더로 보내는 분기이므로 create/sync 로직으로 흘림
          // (status만 unclassified로 표기)
          // 기존 create/sync 본문 실행 (재사용)
          // [아래 기존 코드와 동일하게 실행]
          // (생략 — Task 6 Step 3의 두 번째 replace_all 블록)
        }

        // verdict === 'create' 또는 unclassified 강제 분기: 기존 create/sync 로직
        // needs_new_category 또는 invalid → skip (unclassified 분기에서 이미 폴더 보정)
        if (decision.needs_new_category || !decision.target_folder_id) {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: null,
            targetFolderTitle: null,
            status: 'skipped',
            classifierSource: decision.classifier_source || 'miss',
            reason: decision.reason,
          });
          continue;
        }

        // 멱등성: 동명 페이지 존재 → 동기화, 없으면 생성
        const existing = await _findPageByTitleInAA(srcMeta.title);
        const isSync = !!existing;

        let destId;
        let destTitle;

        if (dryRun) {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: decision.target_folder_id,
            targetFolderTitle: decision.target_folder_title || null,
            status: isSync ? 'synced' : 'created',
            classifierSource: decision.classifier_source,
            reason: decision.reason,
            ...(isSync ? { destPageId: existing.id } : {}),
            ...(verdict === 'unclassified' ? { suggestedFolderId: cacheResult.entry?.suggestedFolderId || null } : {}),
          });
          continue;
        }

        if (isSync) {
          destId = existing.id;
          destTitle = existing.title;
          try {
            const destMeta = await req('GET', `/wiki/api/v2/pages/${destId}`);
            if (destMeta.parentId && String(destMeta.parentId) !== String(decision.target_folder_id)) {
              // 폴더 이동은 하지 않음
            }
          } catch { /* 부모 폴더 정보는 부가 정보 */ }
        } else {
          const newPage = await _createPage(targetSpaceId, decision.target_folder_id, srcMeta.title, '<p>복사 중...</p>');
          destId = newPage.id;
          destTitle = newPage.title;
        }

        const { skippedVideos } = await _copyAttachments(page.id, destId);

        const bannerHtml = _buildBanner({
          ruleVersion: globalRuleVersion,
          pageVersion: '1',
          sourceSpaceKey: sourceSpace,
          sourcePageUrl: srcMeta.url,
          sourcePageTitle: srcMeta.title,
          authorDisplayName: srcMeta.authorDisplayName,
          originalCreatedAt: pageDate,
          labels: decision.labels,
        }, skippedVideos);

        let newBody = _fixBodyReferences(srcMeta.body, page.id, destId);
        newBody = bannerHtml + newBody;
        await _updatePageBody(destId, destTitle, newBody);

        if (decision.labels && decision.labels.length > 0) {
          await _addLabels(destId, decision.labels);
        }

        const finalStatus = verdict === 'unclassified' ? 'unclassified' : (isSync ? 'synced' : 'created');
        items.push({
          kind: 'migrate-a',
          pageId: page.id,
          title: page.title,
          sourceSpace,
          targetFolderId: decision.target_folder_id,
          targetFolderTitle: decision.target_folder_title || null,
          status: finalStatus,
          classifierSource: decision.classifier_source,
          reason: decision.reason,
          destPageId: destId,
          ...(verdict === 'unclassified' ? { suggestedFolderId: extractSuggested(valueReason) } : {}),
        });

      } catch (e) {
        items.push({
          kind: 'migrate-a',
          pageId: page.id,
          title: page.title,
          sourceSpace,
          targetFolderId: null,
          targetFolderTitle: null,
          status: 'failed',
          classifierSource: null,
          reason: null,
          error: e.message,
        });
      }

      if (!dryRun) await delay(1500);
    }
```

또한 `_today`와 `addDays` 헬퍼 추가 — 모듈 상단 (import 직후)에:

```js
function addDays(yyyyMmDd, days) {
  const d = new Date(yyyyMmDd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function extractSuggested(reason) {
  // valueReason에서 suggestedFolderId 추출은 위 분기에서 직접 push. 본 함수는 placeholder.
  return null;
}
```

- [ ] **Step 4: 캐시 저장 (try 루프 종료 후, for sourceSpace 종료 후)**

기존 `return { items };` (line 286) 직전에 삽입:

```js
  // 5. dropped 캐시 머지 + 저장 (실실행 시)
  if (!dryRun && cacheUpdates.length > 0) {
    try {
      const merged = _mergeDroppedCache(droppedCache, cacheUpdates);
      await _saveDroppedCache(DROPPED_CACHE_PATH, merged);
    } catch (e) {
      saveError = `save-dropped-cache:${e.message}`;
      console.warn(`⚠️ dropped_pages.json 저장 실패: ${e.message}`);
    }
  }
  if (saveError) {
    // 부록 advisories 머지는 호출자(report_aa_daily.js)가 처리. runMigrate는 return에 노출.
    return { items, saveError };
  }
  return { items };
```

- [ ] **Step 5: module.exports 갱신**

```js
module.exports = { runMigrator, runMigrate, findPageByTitleInAA, cqlEscape };
```

는 유지. `addDays`는 모듈 내부 헬퍼 (export 불필요).

- [ ] **Step 6: 테스트 실행 → GREEN 확인**

Run: `npm test -- tests/migrator/run_migrate_dropout.test.js`
Expected: 10/10 PASS

기존 `run_migrate.test.js` 회귀:

Run: `npm test -- tests/migrator/run_migrate.test.js`
Expected: 기존 8/8 PASS (deps 추가가 기존 테스트에 영향 없음을 확인).

- [ ] **Step 7: Commit**

```bash
git add scripts/migrator.js
git commit -m "feat(migrator): 5-status 분기 + dropped 캐시 통합 (작업 15)"
```

---

### Task 7: `render.js` 5-group + render 테스트

**Files:**
- Modify: `scripts/report/render.js:124-165` (migrateSection)
- Create: `tests/report/render_migrate_dropout.test.js`

- [ ] **Step 1: 테스트 파일 작성 (6건)**

`tests/report/rigrate_migrate_dropout.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { renderReportStorage } = require('../../scripts/report/render');

function makeAppendix(extraItems) {
  return {
    runAt: '2026-08-02T09:00:00+09:00',
    runId: 'r1',
    mode: 'prod',
    policyHash: 'abc12345',
    gitSha: 'sha',
    model: 'claude-haiku-4-5-20251001',
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
    items: extraItems,
  };
}

test('render: dropped 그룹은 status 5종 중 하나, "이관 가치 없음" 라벨', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'dropped', reason: '개인 메모', reevalDueAt: '2026-08-09' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(html.includes('이관 가치 없음 (드롭)'));
  assert.ok(html.includes('개인 메모'));
  assert.ok(html.includes('재평가'));
});

test('render: unclassified 그룹 — "미분류 폴더 이관" + 추천 폴더 컬럼', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'unclassified', reason: '둘 다 가능', suggestedFolderId: '102' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(html.includes('미분류 폴더 이관 (분류 애매)'));
  assert.ok(html.includes('102'));
});

test('render: 5그룹 모두 있을 때 헤더 순서 = created → synced → unclassified → dropped → failed', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'A', sourceSpace: 'SD', status: 'created', targetFolderId: '100', targetFolderTitle: 'T', classifierSource: 'inline-llm', reason: 'r' },
    { kind: 'migrate-a', pageId: '2', title: 'B', sourceSpace: 'SD', status: 'synced', targetFolderId: '100', classifierSource: 'inline-llm', reason: 'r', destPageId: '99' },
    { kind: 'migrate-a', pageId: '3', title: 'C', sourceSpace: 'SD', status: 'unclassified', reason: 'r', suggestedFolderId: '102' },
    { kind: 'migrate-a', pageId: '4', title: 'D', sourceSpace: 'SD', status: 'dropped', reason: 'r', reevalDueAt: '2026-08-09' },
    { kind: 'migrate-a', pageId: '5', title: 'E', sourceSpace: 'SD', status: 'failed', error: 'oops' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  const idxCreated = html.indexOf('신규 이관');
  const idxSynced = html.indexOf('동기화 (기존 페이지 갱신)');
  const idxUnc = html.indexOf('미분류 폴더 이관 (분류 애매)');
  const idxDrop = html.indexOf('이관 가치 없음 (드롭)');
  const idxFailed = html.indexOf('실패');
  assert.ok(idxCreated >= 0);
  assert.ok(idxSynced > idxCreated);
  assert.ok(idxUnc > idxSynced);
  assert.ok(idxDrop > idxUnc);
  assert.ok(idxFailed > idxDrop);
});

test('render: 빈 그룹은 헤더 생략', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'A', sourceSpace: 'SD', status: 'created', targetFolderId: '100', classifierSource: 'inline-llm', reason: 'r' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(!html.includes('이관 가치 없음 (드롭)'));
  assert.ok(!html.includes('미분류 폴더 이관'));
});

test('render: dropped 재평가 D-N 포맷', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'dropped', reason: 'r', reevalDueAt: '2026-08-09', cacheHit: true },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  // today=2026-08-02, nextReevalAt=2026-08-09 → D-7
  assert.ok(html.includes('D-7'));
});

test('render: escapeHtml 회귀 — "<" 포함 reason도 이스케이프', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'dropped', reason: '<script>x</script>', reevalDueAt: '2026-08-09' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
```

- [ ] **Step 2: 테스트 실행 → RED 확인**

Run: `npm test -- tests/report/render_migrate_dropout.test.js`
Expected: 모두 FAIL (render.js가 4-group만 처리).

- [ ] **Step 3: `render.js` `migrateSection` 본문 교체**

기존 `GROUPS` 배열과 group별 rows 생성 로직을 다음으로 교체:

```js
function migrateSection(items) {
  const migrateItems = (items || []).filter(it => it && it.kind === 'migrate-a');
  const parts = ['<h2>§2 루프 A — 외부 이관 결과</h2>'];
  if (migrateItems.length === 0) {
    parts.push('<p><em>이관 결과 없음 (실행 안 됨 또는 후보 0건)</em></p>');
    return parts.join('\n');
  }

  const GROUPS = [
    { status: 'created',      label: '신규 이관' },
    { status: 'synced',       label: '동기화 (기존 페이지 갱신)' },
    { status: 'unclassified', label: '미분류 폴더 이관 (분류 애매)' },
    { status: 'dropped',      label: '이관 가치 없음 (드롭)' },
    { status: 'failed',       label: '실패' },
  ];

  parts.push(`<p>총 ${migrateItems.length}건 처리</p>`);

  for (const g of GROUPS) {
    const group = migrateItems.filter(it => it.status === g.status);
    if (group.length === 0) continue;

    let headers, rows;
    if (g.status === 'dropped') {
      headers = '<th>페이지</th><th>소스</th><th>분류 소스</th><th>사유</th><th>재평가</th>';
      rows = group.map(it => {
        const reevalCell = it.cacheHit && it.reevalDueAt
          ? cell(`D-${daysBetween(today(), it.reevalDueAt)}`)
          : cell(`D-${daysBetween(today(), it.reevalDueAt) >= 0 ? daysBetween(today(), it.reevalDueAt) : 7}`);
        return `<tr>
<td>${pageLink(it)}</td>
<td>${cell(it.sourceSpace)}</td>
<td>${cell(it.classifierSource || '—')}</td>
<td>${cell(it.reason || '—')}</td>
<td>${reevalCell}</td>
</tr>`;
      }).join('\n');
    } else if (g.status === 'unclassified') {
      headers = '<th>페이지</th><th>소스</th><th>분류 소스</th><th>사유</th><th>추천 폴더</th>';
      rows = group.map(it => `<tr>
<td>${pageLink(it)}</td>
<td>${cell(it.sourceSpace)}</td>
<td>${cell(it.classifierSource || '—')}</td>
<td>${cell(it.reason || '—')}</td>
<td>${cell(it.suggestedFolderId || '—')}</td>
</tr>`).join('\n');
    } else {
      // created / synced / failed — 기존 레이아웃
      headers = '<th>페이지</th><th>소스</th><th>대상 폴더</th><th>분류 소스</th><th>사유/오류</th>';
      rows = group.map(it => {
        const target = it.targetFolderTitle || it.targetFolderId || '—';
        const detail = it.error || it.reason || '—';
        return `<tr>
<td>${pageLink(it)}</td>
<td>${cell(it.sourceSpace)}</td>
<td>${cell(target)}</td>
<td>${cell(it.classifierSource || '—')}</td>
<td>${cell(detail)}</td>
</tr>`;
      }).join('\n');
    }

    parts.push(`<h3>${g.label} (${group.length}건)</h3>`);
    parts.push(`<table><tbody>
<tr>${headers}</tr>
${rows}
</tbody></table>`);
  }

  return parts.join('\n');
}

// 모듈 상단(import 다음)에 헬퍼 추가:
function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}
```

- [ ] **Step 4: 테스트 실행 → GREEN 확인**

Run: `npm test -- tests/report/render_migrate_dropout.test.js`
Expected: 6/6 PASS

기존 render 테스트 회귀:

Run: `npm test -- tests/report/`
Expected: 기존 모두 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/report/render.js tests/report/render_migrate_dropout.test.js
git commit -m "feat(render): §2 5-group + dropped/unclassified 컬럼 (작업 15)"
```

---

### Task 8: 운영 스크립트 + 문서 갱신

**Files:**
- Modify: `package.json` (scripts 추가)
- Create: `scripts/list_dropped.js` (운영 CLI)
- Create: `tests/cli/list_dropped.test.js` (간단 검증)
- Modify: `reference/classification_rules.md` (§5 신설)
- Modify: `reference/ToDo.md` (작업 15 완료 표시)

- [ ] **Step 1: `scripts/list_dropped.js` 작성**

```js
#!/usr/bin/env node
'use strict';
// 운영 CLI: reference/dropped_pages.json 테이블 형식 출력.
const path = require('path');
const { loadDroppedCache } = require('./migrator/dropped_cache');

const FILE = path.join(__dirname, '..', 'reference', 'dropped_pages.json');
const items = loadDroppedCache(FILE);
if (items.length === 0) {
  console.log('(no dropped entries)');
  process.exit(0);
}
console.log('| pageId | sourceSpace | title | reason | firstSeen | lastSeen | nextReevalAt |');
console.log('|---|---|---|---|---|---|---|');
for (const it of items) {
  console.log(`| ${it.pageId} | ${it.sourceSpace || ''} | ${(it.title || '').replace(/\|/g, '\\|')} | ${(it.reason || '').replace(/\|/g, '\\|')} | ${it.firstSeen || ''} | ${it.lastSeen || ''} | ${it.nextReevalAt || ''} |`);
}
```

- [ ] **Step 2: `package.json` scripts 추가**

`scripts` 섹션에 추가:

```json
"migration:dropped:list": "node scripts/list_dropped.js"
```

- [ ] **Step 3: `reference/classification_rules.md` §5 추가**

기존 §4 다음에 신규 §5 삽입 (또는 §4를 §5로 리네임 후 §4 신설):

```markdown
## §5. 이관 탈락 후보 (작업 15, 2026-08-02)

`runMigrate`는 3상태로 분기한다:

- `created` / `synced` — 정상 이관
- `unclassified` — 분류 의향 O, 미분류 폴더로 이관 + LLM 의견 코멘트
- `dropped` — 이관 가치 없음 (끄적임, 임시 스크랩) → AA에 들어오지 않음

`reference/dropped_pages.json` SSOT에 dropped 페이지 캐시. 7일 후 자동 재평가. 운영 CLI: `npm run migration:dropped:list`.
```

(파일 구조에 따라 정확한 §번호는 조정. 기존 §5가 있으면 그 뒤에 §6로 추가.)

- [ ] **Step 4: `reference/ToDo.md` 작업 15 완료 표시**

§4 "작업 15 — 탈락 후보 판정 — 미착수"를 다음으로 교체:

```markdown
### 작업 15 — 탈락 후보 판정 — ✅ 2026-08-02 완료
- LLM 가치 평가 단계 추가 (분류와 분리). 3-status 분기 (`created/synced` / `unclassified` / `dropped`).
- SSOT 캐시: `reference/dropped_pages.json` (pageId+hash 키, 7일 자동 재평가).
- §2 부록 5-group (신규/동기화/미분류/드롭/실패) + dropped는 `재평가 D-N` 컬럼, unclassified는 `추천 폴더` 컬럼.
- 신규 모듈: `scripts/utils/migration_value.js`, `scripts/utils/value_prompt.js`, `scripts/migrator/dropped_cache.js`.
- 신규 테스트 34건 + 기존 253건 → `npm test` 287/287 PASS.
- 운영 CLI: `npm run migration:dropped:list`.
- 스펙: `docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md`.
```

- [ ] **Step 5: 검증**

```bash
npm test
npm run report:aa:dryrun
npm run migration:dropped:list
```

Expected: 모든 PASS + dry-run 정상 + (캐시 비어있으면 "(no dropped entries)").

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/list_dropped.js reference/classification_rules.md reference/ToDo.md
git commit -m "docs(ops): 작업 15 — 운영 CLI + 문서 동기화"
```

---

### Task 9: 회귀 가드 + 최종 검증

**Files:**
- Modify: `tests/migrator/no_dify_stale_log.test.js` (Dify 잔재 회귀)

- [ ] **Step 1: 회귀 가드 확인**

기존 `tests/migrator/no_dify_stale_log.test.js`가 `scripts/migrator.js`의 `console.log` / 주석에 `Dify-like` 잔재를 검사. 신규 코드도 같은 파일을 검사하므로 grep 패턴이 정상이어야 함.

Run: `npm test -- tests/migrator/no_dify_stale_log.test.js`
Expected: PASS

- [ ] **Step 2: 전체 테스트 + dry-run**

```bash
npm test
```

Expected: 287/287 PASS

```bash
npm run report:aa:dryrun
```

Expected: 정상 (5-group 표 렌더 확인, dropped/unclassified 0건이어도 헤더는 안 나옴).

```bash
npm run ci:local:dryrun
```

Expected: 정상 종료.

- [ ] **Step 3: 4-PR 분할 + 머지**

PR 1 (Task 1, 2, 3):
```bash
git checkout -b feature/migration-dropout-pr1
git push -u origin feature/migration-dropout-pr1
gh pr create --base main --title "feat(작업 15 PR1): 가치 평가 모듈 (value_prompt + migration_value + llm_api 확장)" --body "스펙: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md"
```

머지 후:
```bash
git checkout main
git pull
git branch -D feature/migration-dropout-pr1
```

PR 2 (Task 4) — 동일 패턴.
PR 3 (Task 5, 6, 7) — 동일 패턴.
PR 4 (Task 8, 9) — 동일 패턴.

각 PR 머지 후 main에서 `npm test` 한 번 더.

- [ ] **Step 4: workflow_dispatch 1회 트리거**

```bash
gh workflow run confluence_automation.yml
```

Expected: 1회 수동 트리거 정상. 다음 cron 리포트에서 5-group 표 확인.

- [ ] **Step 5: 최종 commit**

```bash
git log --oneline -10  # PR 4개 머지 커밋 확인
```

---

## Self-Review (작성자 직접 점검)

### 1. Spec coverage

| Spec 섹션 | Task 매핑 |
|---|---|
| §1 문제 | (배경, plan 상단 Goal에 포함) |
| §2 목표 (3-status) | Task 5-7 |
| §3 비목표 | (YAGNI 가드) |
| §4 아키텍처 (책임 분리) | Task 1, 2, 3 |
| §5-1 migration_value | Task 2 |
| §5-2 value_prompt | Task 1 |
| §5-3 llm_api 확장 | Task 3 |
| §5-4 dropped_cache | Task 4 |
| §5-5 migrator.js | Task 6 |
| §5-6 render.js | Task 7 |
| §6 deps 주입 | Task 6 Step 1 |
| §7 운영 스크립트 | Task 8 |
| §8 에러 처리 (throw 흡수, 보존 fallback, chain-fail 강제 unclassified) | Task 6 Step 3 |
| §9 테스트 34건 (8+10+10+6) | Task 1-7 (각 task에 신규 테스트 포함) |
| §10 변경 파일 요약 | Task 1-8 |
| §11 위험 | (Step 별 graceful 처리) |
| §12 단계적 출시 (4 PR) | Task 9 Step 3 |
| §13 완료 기준 | Task 9 Step 2-4 |

### 2. Placeholder scan

- "TBD" / "TODO" / "fill in" 없음.
- "add appropriate" / "handle edge" 같은 모호 표현 없음.
- 모든 코드 블록에 실제 코드 포함.

### 3. Type / 시그니처 일관성

- `assessMigrationValue(ctx, aaTree, deps)` — Task 2에서 정의, Task 3의 `callLLMForMigrationValue`가 `deps.llm.callLLMForMigrationValue`로 호출. 일관.
- `consultDroppedCache(pageId, hash, today, cache)` — Task 4 정의, Task 6에서 호출. 시그니처 일치.
- `mergeDroppedCache(cache, updates)` — Task 4 정의, Task 6에서 호출. 시그니처 일치.
- `hashFor(page)` — Task 4 정의, Task 6에서 호출. 시그니처 일치.
- `runMigrate` deps 키 6개 모두 일관.
- `items[].status` 5종 (`created/synced/unclassified/dropped/failed`) — 모든 테스트·render·migrator에서 동일 enum.
- `extractSuggested` placeholder — **확인됨**. 본 함수 본문이 `return null`이라 실제로 unclassified 항목에 suggestedFolderId가 안 실림. 

**Self-Review 결함 발견**: Task 6 Step 3의 `extractSuggested(valueReason)`은 reason 문자열 파싱이 의도였는데 placeholder. 실제로는 `value.suggestedFolderId`를 `items[].suggestedFolderId`로 직접 push해야 함.

→ **인라인 수정**: Task 6 Step 3의 `extractSuggested` 헬퍼 제거, `items.push`에 `suggestedFolderId: (verdict === 'unclassified' ? cacheResult.entry?.suggestedFolderId || null : null)` 명시. (실제 LLM이 직접 반환한 `value.suggestedFolderId`는 `verdict` 객체에 이미 있으므로 `verdict`로컬 변수에 보존 후 push.)

수정 적용 ↓

- [ ] **Self-Review 결함 인라인 수정**

Task 6 Step 3의 unclassified 분기에서 `items.push` 시 suggestedFolderId를 value 객체에서 직접 보존하도록 변경. (별도 value 변수 보존)

```js
let value; // for-loop 위에서 선언
// ... in else branch:
value = await _assessMigrationValue({...}, aaTree);
verdict = value.verdict;
valueReason = value.reason;
valueSource = value.source;
reevalDueAt = addDays(today, 7);
// ... value는 클로저로 push에서 접근
```

`items.push` 블록 (verdict === 'unclassified' / finalStatus === 'unclassified' 두 곳) 모두:

```js
...(verdict === 'unclassified' || finalStatus === 'unclassified' ? { suggestedFolderId: (value && value.suggestedFolderId) || null } : {}),
```

`extractSuggested` 함수 정의 + 호출은 제거.

---

## 완료 기준 (Task 9 종료 시)

- [ ] `npm test` 287/287 PASS
- [ ] `npm run report:aa:dryrun` 정상 (5-group 표)
- [ ] `npm run ci:local:dryrun` 정상
- [ ] `npm run migration:dropped:list` 정상
- [ ] PR 4개 main 머지 완료
- [ ] `reference/ToDo.md` 작업 15 완료 표시
- [ ] `reference/classification_rules.md` §5 추가
- [ ] `workflow_dispatch` 1회 수동 트리거 성공
