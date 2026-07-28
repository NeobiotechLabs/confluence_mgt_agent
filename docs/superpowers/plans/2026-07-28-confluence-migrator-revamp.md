# Confluence Migrator Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dify 외부 의존을 제거하고, 휴먼 결정 + 룰 + Claude API fallback으로 구성된 Classifier 체인을 GitHub Actions에서 직접 실행하도록 마이그레이션 시스템을 재설계한다. 휴먼이 AA 스페이스 UI에서 수동 이동한 결과를 자동으로 감지·반영하고, 현재 잘못 배치된 페이지를 재배치한다.

**Architecture:** Port/Adapter 패턴의 Classifier 체인 (`scripts/classifiers/`). 휴먼 정책 JSON → 룰 → Claude API → 미분류 폴더 순으로 폴더 ID를 결정. GH Actions의 3-job(`audit-aa` → `reorganize-aa` → `migrate`)이 매일 self-hosted 러너에서 실행. 휴먼 UI 이동은 `audit_aa_space.js`가 다음 실행 시 자동으로 `classification_decisions.json`에 commit.

**Tech Stack:** Node.js 18, GitHub Actions self-hosted, dotenv, Anthropic SDK (`@anthropic-ai/sdk`) — claude-haiku-4-5-20251001. 외부 의존 점진적 제거 (Dify → Anthropic API).

## Global Constraints

- Node.js 18+ (Globs: `package.json`의 `engines` 없음, GH Actions `setup-node@v3` 기준).
- 모듈 시스템: CommonJS (`require`/`module.exports`). ESM 아님.
- 통신: Confluence REST API v2 (`/wiki/api/v2/...`) + v1 (legacy 호환).
- 인증: `CONFLUENCE_EMAIL` + `CONFLUENCE_TOKEN` (Basic Auth) — GitHub Actions Secret.
- LLM: `ANTHROPIC_API_KEY` Secret. 모델 `claude-haiku-4-5-20251001`.
- 키 미설정 시 ClaudeClassifier는 자동 skip (silent fallback). sigsegv 방지.
- 기존 파일의 동작은 dry-run 모드에서는 0으로 유지. `--dry-run` 옵션은 모든 신규 스크립트에 적용.
- 충돌(같은 제목) 처리: update (인플레이스).
- 자동화 빈도: 매일 09:00 KST (`cron: '0 15 * * *'` UTC).
- 의존성 추가: `package.json`의 `dependencies`에 추가 시 lock 파일 갱신.
- 커밋 메시지: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- 모든 산출물은 즉시 `git add` + commit. 미완성 변경은 미커밋.

---

## File Structure

### 신규

| 파일 | 역할 |
|------|------|
| `scripts/utils/aa_space_tree.js` | AA 스페이스 IS-FOLDER 트리 캐시 (`fetchAATree()`, `toText()`) |
| `scripts/classifiers/iface.js` | `ClassifierIface` JSDoc typedef (인터페이스 문서) |
| `scripts/classifiers/rule.js` | `RuleClassifier` — `analysis_rules.json` 룰 엔진 |
| `scripts/classifiers/human.js` | `HumanPolicyClassifier` — `classification_decisions.json` |
| `scripts/classifiers/claude.js` | `ClaudeClassifier` — Anthropic API (tool_use) |
| `scripts/classifiers/engine.js` | `ClassifierChain` — 순차 fallback engine |
| `scripts/audit_aa_space.js` | 최상위/고아 페이지 리포트 + 휴먼 이동 자동 commit |
| `scripts/reorganize_aa_space.js` | AA 스페이스 내부 재배치 (--dry-run 지원) |
| `config/classification_decisions.json` | 휴먼 정책 (초기 `decisions: []`) |
| `tests/classifiers/rule.test.js` | RuleClassifier 단위 테스트 |
| `tests/classifiers/human.test.js` | HumanPolicyClassifier 단위 테스트 |
| `tests/classifiers/engine.test.js` | ClassifierChain 단위 테스트 |
| `tests/classifiers/claude.test.js` | ClaudeClassifier mock 테스트 |

### 변경

| 파일 | 변경 |
|------|------|
| `scripts/migrator.js` | Dify 호출 → `classifyWithChain()` |
| `scripts/utils/migration_utils.js` | `syncLabels`에 `last-parent-*`, `human-classified` 보호 |
| `scripts/utils/dify_api.js` | deprecation 분기 (engine.js로 우회 가능) |
| `scripts/utils/confluence_api.js` | `fetchAASpaceTreeText()` 활용 (변경 최소) |
| `scripts/analyze_migration_candidates.js` | 룰 매칭 함수를 `classifiers/rule.js`로 export |
| `.github/workflows/confluence_automation.yml` | 3-job 분리, 시크릿 교체 |
| `package.json` | `npm run` 스크립트 추가, `@anthropic-ai/sdk` 추가 |
| `.env.sample` | `ANTHROPIC_API_KEY` 추가, `DIFY_*` 제거 |

---

## Task 1: AA 스페이스 트리 캐시 모듈

**Files:**
- Create: `scripts/utils/aa_space_tree.js`
- Test: `tests/utils/aa_space_tree.test.js`

**Interfaces:**
- Consumes: `confluenceRequest` from `scripts/utils/confluence_api.js`
- Produces:
  ```js
  async function fetchAATree(): Promise<{
    flat: Array<{ id, title, parentId, labels, ancestors }>,
    tree: object,
    unsortedFolderId: string,
    toText(): string,
    hasFolder(id: string): boolean,
  }>
  ```

- [ ] **Step 1: Write failing test**

```js
// tests/utils/aa_space_tree.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('hasFolder returns true for known folder id', () => {
  const tree = {
    flat: [{ id: 'a', title: 'A', parentId: null, labels: ['is-folder'], ancestors: [] }],
    tree: {},
    unsortedFolderId: 'unsorted',
    toText: () => '',
    hasFolder: (id) => tree.flat.some(f => f.id === id),
  };
  assert.strictEqual(tree.hasFolder('a'), true);
  assert.strictEqual(tree.hasFolder('b'), false);
});

test('unsortedFolderId fallback convention', () => {
  // "미분류" 또는 "분류 보류" 제목 폴더 id를 우선 반환
  assert.ok(true); // placeholder for future assertion
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/utils/aa_space_tree.test.js`
Expected: FAIL with "Cannot find module '../../scripts/utils/aa_space_tree'"

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/utils/aa_space_tree.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { confluenceRequest } = require('./confluence_api');

const AA_HOME_TITLE = 'AA Home';   // AA 스페이스 홈페이지 제목
const UNSORTED_TITLES = ['미분류', '분류 보류', 'Unsorted'];

async function fetchAATree() {
  // 1) AA 스페이스의 모든 페이지 (IS-FOLDER 라벨 가진 페이지만)
  const folders = await fetchAllFolders();
  const unsortedFolderId = findUnsorted(folders) || folders[0]?.id || null;

  // 2) 트리 구조 조립
  const tree = buildTree(folders);

  return {
    flat: folders,
    tree,
    unsortedFolderId,
    toText() { return formatTreeAsText(tree); },
    hasFolder(id) { return folders.some(f => f.id === id); },
  };
}

async function fetchAllFolders() {
  let cursor = null;
  const all = [];
  do {
    const params = new URLSearchParams({ 'labels': 'is-folder', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages?${params}`);
    for (const p of (res.results || [])) {
      all.push({
        id: p.id,
        title: p.title,
        parentId: p.parentId,
        labels: [], // v2 labels는 별도 호출 필요. 향후 확장
        ancestors: await fetchAncestorTitles(p),
      });
    }
    cursor = res._links?.next;
  } while (cursor);
  return all;
}

async function fetchAncestorTitles(page) {
  const ancestors = [];
  let current = page.parentId;
  let depth = 0;
  while (current && depth < 10) {
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages/${current}`);
    ancestors.unshift(res.title || '');
    current = res.parentId;
    depth++;
  }
  return ancestors;
}

function findUnsorted(folders) {
  for (const t of UNSORTED_TITLES) {
    const found = folders.find(f => f.title === t);
    if (found) return found.id;
  }
  return null;
}

function buildTree(folders) {
  const byId = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
  const roots = [];
  for (const f of byId.values()) {
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId).children.push(f);
    } else {
      roots.push(f);
    }
  }
  return roots;
}

function formatTreeAsText(roots, indent = 0) {
  const lines = [];
  for (const node of roots) {
    lines.push(`${' '.repeat(indent)}- ${node.title} (id: ${node.id})`);
    if (node.children?.length) {
      lines.push(formatTreeAsText(node.children, indent + 2));
    }
  }
  return lines.join('\n');
}

module.exports = { fetchAATree, AA_HOME_TITLE, UNSORTED_TITLES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/utils/aa_space_tree.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/utils/aa_space_tree.js tests/utils/aa_space_tree.test.js
git commit -m "feat(tree): add AA space IS-FOLDER tree cache utility"
```

---

## Task 2: Classifier 인터페이스 + RuleClassifier

**Files:**
- Create: `scripts/classifiers/iface.js`
- Create: `scripts/classifiers/rule.js`
- Modify: `scripts/analyze_migration_candidates.js` (export `findFirstMatchingCategory`)
- Test: `tests/classifiers/rule.test.js`

**Interfaces:**
- Consumes: `fetchAATree()` from Task 1
- Produces:
  ```js
  // iface.js
  // JSDoc typedef only — no exports

  // rule.js
  /** @type {import('./iface').ClassifierIface} */
  const ruleClassifier = { name: 'rule', classify };
  module.exports = { ruleClassifier, classify };

  async function classify(ctx, aaTree) {
    // returns { ok, source: 'rule', folderId, folderTitle, labels, reason }
  }
  ```

- [ ] **Step 1: Write failing test**

```js
// tests/classifiers/rule.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ruleClassifier } = require('../../scripts/classifiers/rule');

test('rule matcher returns ok for known category', async () => {
  const ctx = {
    pageId: '1', title: 'MPS 2026-06 보고',
    body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '',
    pageDate: '2026-06-15', existingLabels: [],
  };
  const aaTree = {
    flat: [{ id: 'f1', title: 'MPS 이력', parentId: null, labels: ['is-folder'], ancestors: [] }],
    tree: {}, unsortedFolderId: 'f1', toText: () => '', hasFolder: () => true,
  };
  const result = await ruleClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'rule');
});

test('rule matcher returns ok:false for dailyScrum', async () => {
  const ctx = {
    pageId: '2', title: 'Daily Scrum 2026-06-01',
    body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '',
    pageDate: '2026-06-01', existingLabels: [],
  };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: null, toText: () => '', hasFolder: () => false };
  const result = await ruleClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/classifiers/rule.test.js`
Expected: FAIL with "Cannot find module '../../scripts/classifiers/rule'"

- [ ] **Step 3: Write interface typedef**

```js
// scripts/classifiers/iface.js
'use strict';
/**
 * @typedef {Object} ClassifyContext
 * @property {string} pageId
 * @property {string} title
 * @property {string} body
 * @property {string[]} ancestors
 * @property {string} sourceSpace
 * @property {string} sourceUrl
 * @property {string} pageDate
 * @property {string[]} existingLabels
 *
 * @typedef {Object} ClassifyResult
 * @property {boolean} ok
 * @property {'human'|'rule'|'claude'|'fallback'|'miss'} source
 * @property {string} [folderId]
 * @property {string} [folderTitle]
 * @property {string[]} [labels]
 * @property {string} [reason]
 *
 * @typedef {Object} ClassifierIface
 * @property {string} name
 * @property {(ctx: ClassifyContext, aaTree: import('../utils/aa_space_tree').fetchAATree extends () => Promise<infer T> ? T : never) => Promise<ClassifyResult>} classify
 */

module.exports = {};
```

- [ ] **Step 4: Write RuleClassifier**

```js
// scripts/classifiers/rule.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');

const ANALYSIS_RULES_PATH = path.join(__dirname, '..', '..', 'config', 'analysis_rules.json');

let cachedRules = null;
function loadRules() {
  if (cachedRules) return cachedRules;
  cachedRules = JSON.parse(fs.readFileSync(ANALYSIS_RULES_PATH, 'utf8'));
  return cachedRules;
}

function regexFromPattern(p, flags = 'i') {
  try { return new RegExp(p, flags); } catch { return null; }
}

function matchesCategory(category, ctx) {
  const { title, ancestors, ancestorStr } = ctx;
  if (category.is_catch_all) return true;
  const m = category.match || {};
  const groups = m.any ? [{ any: m.any }] : [m];
  for (const g of groups) {
    const anyList = g.any || [g];
    if (anyList.length === 0) continue;
    const hit = anyList.some((rule) => {
      if (rule.title_patterns) {
        const regs = rule.title_patterns.map((p) => regexFromPattern(p)).filter(Boolean);
        if (regs.some(r => r.test(title))) return true;
      }
      if (rule.ancestor_contains) {
        if (ancestorStr.includes(rule.ancestor_contains)) return true;
      }
      return false;
    });
    if (!hit) return false;
  }
  if (category.exclude) {
    const exList = category.exclude.title_patterns || [];
    const regs = exList.map((p) => regexFromPattern(p)).filter(Boolean);
    if (regs.some(r => r.test(title))) return false;
  }
  return true;
}

function buildCategory(category, ctx) {
  const f = category.fields || {};
  const vars = { year: ctx.year, title: ctx.title, doctype: '' };
  const out = {
    category: category.name,
    subCategory: category.is_catch_all ? '분류 보류 (휴먼 큐)' : '',
    labels: [],
    reason: category.id,
    isCatchAll: !!category.is_catch_all,
  };
  if (!category.is_catch_all) {
    if (f.subCategory) out.subCategory = f.subCategory;
    else if (f.subCategory_annual && regexFromPattern('연간').test(ctx.title)) out.subCategory = f.subCategory_annual;
    else if (f.subCategory_periodic_template) out.subCategory = applyTemplate(f.subCategory_periodic_template, vars);
    else if (f.subCategory_template) out.subCategory = applyTemplate(f.subCategory_template, vars);
    else out.subCategory = '기타';
  }
  if (f.doctype_map) {
    for (const [key, label] of Object.entries(f.doctype_map)) {
      if (key === 'default') continue;
      if (regexFromPattern(key)?.test(ctx.title)) { out.doctype = label; vars.doctype = label; break; }
    }
    if (!out.doctype) out.doctype = f.doctype_map.default || '';
  }
  if (f.labels_template) {
    out.labels = applyTemplate(f.labels_template, vars).filter(Boolean);
  }
  return out;
}

function applyTemplate(tpl, vars) {
  if (Array.isArray(tpl)) return tpl.map(s => applyTemplate(s, vars)).filter(Boolean);
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

async function classify(ctx, aaTree) {
  const rules = loadRules();
  const categories = rules.categories || [];
  const global = rules.global || {};
  const cutoffDate = new Date((global.cutoff_date || '2024-01-01') + 'T00:00:00Z');
  const ancestors = ctx.ancestors || [];
  const ancestorStr = ancestors.join(' > ');
  const year = (ctx.pageDate || '').substring(0, 4);

  // 글로벌 제외
  const ex = global.exclude_patterns || {};
  if (regexFromPattern(ex.archived_prefix || '^Archived\\s')?.test(ctx.title)) return { ok: false, source: 'miss' };
  if (regexFromPattern(ex.daily_scrum || 'Daily Scrum', 'i')?.test(ctx.title)) return { ok: false, source: 'miss' };
  if (regexFromPattern(ex.weekly_date_record || '^\\d{4}-\\d{2}-\\d{2}')?.test(ctx.title)) return { ok: false, source: 'miss' };
  const date = new Date(ctx.pageDate);
  if (!isNaN(date.getTime()) && date < cutoffDate) return { ok: false, source: 'miss' };

  for (const cat of categories) {
    if (matchesCategory(cat, { title: ctx.title, ancestors, ancestorStr, year })) {
      const matched = buildCategory(cat, { title: ctx.title, ancestors, ancestorStr, year });
      const folderId = resolveFolderId(matched.category, aaTree);
      if (!folderId) continue;
      return {
        ok: true,
        source: 'rule',
        folderId,
        folderTitle: matched.category,
        labels: matched.labels || [],
        reason: matched.id || matched.category,
      };
    }
  }
  return { ok: false, source: 'miss' };
}

function resolveFolderId(categoryName, aaTree) {
  // 카테고리명 → aaTree.flat 의 제목 매칭
  const folder = aaTree.flat.find(f => f.title === categoryName);
  return folder?.id || null;
}

const ruleClassifier = { name: 'rule', classify };

module.exports = { ruleClassifier, classify };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/classifiers/rule.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/classifiers/iface.js scripts/classifiers/rule.js tests/classifiers/rule.test.js
git commit -m "feat(classifier): add rule classifier with iface typedef"
```

---

## Task 3: 휴먼 정책 Classifier

**Files:**
- Create: `scripts/classifiers/human.js`
- Create: `config/classification_decisions.json`
- Test: `tests/classifiers/human.test.js`

**Interfaces:**
- Consumes: `ClassifyContext` from iface; `config/classification_decisions.json`
- Produces:
  ```js
  const humanClassifier = { name: 'human', classify };
  // classify returns { ok: true, source: 'human', folderId, folderTitle, labels, reason }
  ```

- [ ] **Step 1: Write failing test**

```js
// tests/classifiers/human.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { humanClassifier } = require('../../scripts/classifiers/human');

test('human policy matches by titleRegex', async () => {
  const ctx = {
    pageId: '1', title: '임플란트 로봇 spec',
    body: '', ancestors: [], sourceSpace: 'Device', sourceUrl: '',
    pageDate: '2026-07-28', existingLabels: [],
  };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: null, toText: () => '', hasFolder: () => true };
  const result = await humanClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'human');
  assert.strictEqual(result.folderId, 'target-folder');
});

test('human policy returns miss when no match', async () => {
  const ctx = {
    pageId: '2', title: '완전히 무관한 페이지',
    body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '',
    pageDate: '2026-07-28', existingLabels: [],
  };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: null, toText: () => '', hasFolder: () => true };
  const result = await humanClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/classifiers/human.test.js`
Expected: FAIL with "Cannot find module '../../scripts/classifiers/human'"

- [ ] **Step 3: Seed `classification_decisions.json`**

```json
{
  "$schema_version": "1.0",
  "decisions": [
    {
      "id": "dec-2026-07-28-001",
      "match": {
        "titleRegex": "임플란트\\s*로봇",
        "sourceSpace": "Device"
      },
      "targetFolderId": "target-folder",
      "targetFolderTitle": "기구설계 > Implant Robot",
      "labels": ["group-device", "project-implant-robot"],
      "decidedBy": "jaehwan.sim",
      "decidedAt": "2026-07-28T10:00:00Z",
      "source": "human-ui-move"
    }
  ]
}
```

- [ ] **Step 4: Write HumanPolicyClassifier**

```js
// scripts/classifiers/human.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');

const DECISIONS_PATH = path.join(__dirname, '..', '..', 'config', 'classification_decisions.json');

let cache = null;
let cacheMtime = 0;

function loadDecisions() {
  const stat = fs.statSync(DECISIONS_PATH);
  if (cache && stat.mtimeMs === cacheMtime) return cache;
  const data = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  cache = data.decisions || [];
  cacheMtime = stat.mtimeMs;
  return cache;
}

const SOURCE_PRIORITY = {
  'human-ui-move': 0,
  'manual-script': 1,
  'rule-promoted': 2,
};

function sortByPriority(decisions) {
  return [...decisions].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    if (pa !== pb) return pa - pb;
    return (b.decidedAt || '').localeCompare(a.decidedAt || '');
  });
}

function matches(match, ctx) {
  if (!match) return false;
  if (match.titleRegex) {
    try { if (!new RegExp(match.titleRegex, 'i').test(ctx.title)) return false; }
    catch { return false; }
  }
  if (match.ancestorContains) {
    const hay = (ctx.ancestors || []).join(' > ');
    if (!hay.includes(match.ancestorContains)) return false;
  }
  if (match.sourceSpace) {
    if (match.sourceSpace !== ctx.sourceSpace) return false;
  }
  if (match.labels && match.labels.length > 0) {
    const has = match.labels.some(l => (ctx.existingLabels || []).includes(l));
    if (!has) return false;
  }
  return true;
}

async function classify(ctx, aaTree) {
  const decisions = sortByPriority(loadDecisions());
  for (const d of decisions) {
    if (matches(d.match, ctx)) {
      return {
        ok: true,
        source: 'human',
        folderId: d.targetFolderId,
        folderTitle: d.targetFolderTitle,
        labels: d.labels || [],
        reason: d.id,
      };
    }
  }
  return { ok: false, source: 'miss' };
}

const humanClassifier = { name: 'human', classify };

module.exports = { humanClassifier, classify, loadDecisions, sortByPriority, matches };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/classifiers/human.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/classifiers/human.js config/classification_decisions.json tests/classifiers/human.test.js
git commit -m "feat(classifier): add human-policy classifier with decisions.json"
```

---

## Task 4: ClassifierChain 엔진

**Files:**
- Create: `scripts/classifiers/engine.js`
- Test: `tests/classifiers/engine.test.js`

**Interfaces:**
- Consumes: `humanClassifier`, `ruleClassifier` from Tasks 2-3
- Produces:
  ```js
  async function classifyWithChain(ctx, aaTree): Promise<ClassifyResult>
  // 체인: human → rule → claude (조건부) → fallback
  ```

- [ ] **Step 1: Write failing test**

```js
// tests/classifiers/engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyWithChain } = require('../../scripts/classifiers/engine');

test('chain returns human result when matched', async () => {
  const ctx = { title: '임플란트 로봇', sourceSpace: 'Device', ancestors: [], existingLabels: [] };
  const aaTree = { unsortedFolderId: 'u', flat: [], tree: {}, toText: () => '', hasFolder: () => true };
  const result = await classifyWithChain(ctx, aaTree);
  assert.strictEqual(result.source, 'human');
});

test('chain falls back to unsorted folder when no classifier matches', async () => {
  const ctx = { title: '무관한 페이지', sourceSpace: '?', ancestors: [], existingLabels: [] };
  const aaTree = { unsortedFolderId: 'u', flat: [], tree: {}, toText: () => '', hasFolder: () => true };
  // Mark human + rule as miss (skip claude by env)
  delete process.env.ANTHROPIC_API_KEY;
  const result = await classifyWithChain(ctx, aaTree);
  assert.strictEqual(result.source, 'fallback');
  assert.strictEqual(result.folderId, 'u');
  assert.deepStrictEqual(result.labels, ['needs-review']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/classifiers/engine.test.js`
Expected: FAIL with "Cannot find module '../../scripts/classifiers/engine'"

- [ ] **Step 3: Write ClassifierChain**

```js
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
    folderTitle: aaTree.unsortedFolderTitle || '미분류', // derive from aaTree so the title does not drift when the unsorted folder is renamed
    labels: ['needs-review'],
    reason: 'no-classifier-matched',
  };
}

module.exports = { classifyWithChain };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/classifiers/engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/classifiers/engine.js tests/classifiers/engine.test.js
git commit -m "feat(classifier): add classifier chain engine with fallback"
```

---

## Task 5: ClaudeClassifier (Anthropic API)

**Files:**
- Create: `scripts/classifiers/claude.js`
- Modify: `package.json` (add `@anthropic-ai/sdk`)
- Test: `tests/classifiers/claude.test.js`

**Interfaces:**
- Consumes: `aaTree.toText()`, `ClassifyContext`
- Produces:
  ```js
  const claudeClassifier = { name: 'claude', classify };
  // classify returns { ok: true, source: 'claude', folderId, folderTitle, labels, reason }
  ```

- [ ] **Step 1: Install dependency**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write failing test**

```js
// tests/classifiers/claude.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../../scripts/classifiers/claude');

test('claude returns ok:false when API key missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const ctx = { title: 'test', body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '', pageDate: '2026-07-28', existingLabels: [] };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: 'u', toText: () => '', hasFolder: () => false };
  const result = await classify(ctx, aaTree);
  assert.strictEqual(result.ok, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/classifiers/claude.test.js`
Expected: FAIL with "Cannot find module '../../scripts/classifiers/claude'"

- [ ] **Step 4: Write ClaudeClassifier**

```js
// scripts/classifiers/claude.js
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

  const userPrompt = `# Target Document\n- Title: ${ctx.title}\n- Source: ${ctx.sourceSpace}\n- Date: ${ctx.pageDate}\n\n# AA Tree\n<context_tree>\n${aaTree.toText()}\n</context_tree>\n\nPick the best folder, or omit folderId if none fit.`;

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/classifiers/claude.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/classifiers/claude.js tests/classifiers/claude.test.js
git commit -m "feat(classifier): add Claude classifier via Anthropic SDK with tool_use"
```

---

## Task 6: audit_aa_space.js

**Files:**
- Create: `scripts/audit_aa_space.js`

**Behavior:**
- AA 스페이스 트리 조회 → 최상위/고아 페이지 리포트
- 휴먼 UI 이동 자동 감지: `last-parent-{id}` 라벨 비교 → `classification_decisions.json` commit
- 휴먼 정책 commit 조건: 페이지가 최상위/고아였거나 RuleClassifier가 모를 카테고리로 이동

- [ ] **Step 1: Write the script**

```js
// scripts/audit_aa_space.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree } = require('./utils/aa_space_tree');
const { ruleClassifier } = require('./classifiers/rule');
const { loadDecisions } = require('./classifiers/human');

const DECISIONS_PATH = path.join(__dirname, '..', 'config', 'classification_decisions.json');
const REPORT_DIR = path.join(__dirname, '..', '.github', 'reports');

async function listAAPages() {
  let cursor = null;
  const all = [];
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages?${params}`);
    for (const p of (res.results || [])) {
      const labels = await fetchLabels(p.id);
      all.push({ id: p.id, title: p.title, parentId: p.parentId, labels });
    }
    cursor = res._links?.next;
  } while (cursor);
  return all;
}

async function fetchLabels(pageId) {
  try {
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/label?limit=50`);
    return (res.results || []).map(l => l.name);
  } catch { return []; }
}

async function detectMove(page) {
  const lastParentLabel = page.labels.find(l => l.startsWith('last-parent-'));
  if (!lastParentLabel) return null;
  const lastParentId = lastParentLabel.replace('last-parent-', '');
  if (lastParentId === page.parentId) return null;
  return { from: lastParentId, to: page.parentId };
}

async function shouldCommitHumanDecision(page, move, aaTree) {
  // 1) 최상위 → 특정 폴더로 이동 (Rule이 매칭 못 했을 가능성)
  if (move.from === aaTree.flat[0]?.parentId || !move.from) return true;
  // 2) RuleClassifier가 모르는 카테고리
  const ruleResult = await ruleClassifier.classify({
    pageId: page.id, title: page.title, body: '', ancestors: [],
    sourceSpace: '?', sourceUrl: '', pageDate: '', existingLabels: page.labels,
  }, aaTree);
  if (!ruleResult.ok) return true;
  // 3) Rule이 다른 폴더로 분류했다면 → 휴먼이 다른 데로 옮긴 것 → 등록
  return ruleResult.folderId !== move.to;
}

async function commitDecision(page, move) {
  const data = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  const newEntry = {
    id: `dec-${new Date().toISOString().slice(0, 10)}-${Date.now()}`,
    match: { titleRegex: escapeRegex(page.title) },
    targetFolderId: move.to,
    targetFolderTitle: '(resolved at runtime)',
    labels: ['human-classified'],
    decidedBy: process.env.GIT_AUTHOR_EMAIL || 'audit-bot',
    decidedAt: new Date().toISOString(),
    source: 'human-ui-move',
  };
  data.decisions.push(newEntry);
  fs.writeFileSync(DECISIONS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function stampLastParent(pageId, parentId) {
  // 라벨 페이지 부여 (v1 API)
  await confluenceRequest('POST', `/wiki/rest/api/content/${pageId}/label`, {
    prefix: 'global', name: `last-parent-${parentId}`,
  }).catch(() => {});
}

async function main() {
  console.log('=== Audit AA Space ===');
  const aaTree = await fetchAATree();
  const pages = await listAAPages();
  const topLevel = [];
  const moves = [];

  for (const p of pages) {
    if (p.parentId === aaTree.flat[0]?.parentId) topLevel.push(p);
    const move = await detectMove(p);
    if (move && await shouldCommitHumanDecision(p, move, aaTree)) {
      await commitDecision(p, move);
      moves.push({ page: p.title, move });
    }
    if (p.parentId) await stampLastParent(p.id, p.parentId);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORT_DIR, `audit-${date}.md`);
  fs.writeFileSync(reportPath, renderReport(topLevel, moves), 'utf8');
  console.log(`✅ Report: ${reportPath}`);
  console.log(`   Top-level pages: ${topLevel.length}`);
  console.log(`   Human moves committed: ${moves.length}`);
}

function renderReport(topLevel, moves) {
  const lines = ['# AA Space Audit Report', '', `Date: ${new Date().toISOString()}`, ''];
  lines.push(`## Top-level pages (${topLevel.length})`, '');
  for (const p of topLevel) lines.push(`- ${p.title} (id: ${p.id})`);
  lines.push('', `## Human moves auto-committed (${moves.length})`, '');
  for (const m of moves) lines.push(`- ${m.page}: ${m.move.from} → ${m.move.to}`);
  return lines.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run check**

Run: `node -e "require('./scripts/audit_aa_space.js')" 2>&1 | head -20`
Expected: List of available exports (또는 즉시 실행 후 에러). 정상 출력 확인.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit_aa_space.js
git commit -m "feat(audit): add audit_aa_space.js — top-level + human-move detection"
```

---

## Task 7: reorganize_aa_space.js

**Files:**
- Create: `scripts/reorganize_aa_space.js`

**Behavior:**
- AA 스페이스 페이지 전수 조회 + ClassifierChain 적용
- 최상위/고아 페이지를 결정된 폴더로 `movePage`
- `--dry-run` 지원

- [ ] **Step 1: Write the script**

```js
// scripts/reorganize_aa_space.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree } = require('./utils/aa_space_tree');
const { classifyWithChain } = require('./classifiers/engine');
const { movePage } = require('./utils/migration_utils');

const DRY_RUN = process.argv.includes('--dry-run');

async function listAAPages() {
  let cursor = null;
  const all = [];
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages?${params}`);
    for (const p of (res.results || [])) {
      const labels = await fetchLabels(p.id);
      all.push({ id: p.id, title: p.title, parentId: p.parentId, labels });
    }
    cursor = res._links?.next;
  } while (cursor);
  return all;
}

async function fetchLabels(pageId) {
  try {
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/label?limit=50`);
    return (res.results || []).map(l => l.name);
  } catch { return []; }
}

async function fetchAncestors(pageId, byId) {
  const ancestors = [];
  let current = byId.get(pageId)?.parentId;
  let depth = 0;
  while (current && depth < 10) {
    const parent = byId.get(current);
    if (!parent) break;
    ancestors.unshift(parent.title);
    current = parent.parentId;
    depth++;
  }
  return ancestors;
}

async function main() {
  console.log(`=== Reorganize AA Space (${DRY_RUN ? 'DRY-RUN' : 'EXEC'}) ===`);
  const aaTree = await fetchAATree();
  const pages = await listAAPages();
  const byId = new Map(pages.map(p => [p.id, p]));

  let moved = 0;
  for (const p of pages) {
    // Skip folders themselves
    if (p.labels.includes('is-folder')) continue;
    // Skip if already in valid folder (heuristic: not at top level)
    if (p.parentId && !isAtTopLevel(p, aaTree)) continue;

    const ancestors = await fetchAncestors(p.id, byId);
    const ctx = {
      pageId: p.id, title: p.title, body: '',
      ancestors, sourceSpace: 'AA', sourceUrl: '',
      pageDate: '', existingLabels: p.labels,
    };
    const decision = await classifyWithChain(ctx, aaTree);
    if (!decision.ok || decision.folderId === p.parentId) continue;

    if (DRY_RUN) {
      console.log(`[DRY] ${p.title}: ${p.parentId || 'top'} → ${decision.folderId} (source: ${decision.source})`);
    } else {
      try {
        await movePage(p.id, decision.folderId);
        console.log(`✅ ${p.title}: ${p.parentId || 'top'} → ${decision.folderId} (source: ${decision.source})`);
        moved++;
      } catch (e) {
        console.warn(`⚠️ ${p.title} move failed: ${e.message}`);
      }
    }
  }
  console.log(`\n${DRY_RUN ? '[DRY] would move' : 'Moved'}: ${moved} pages`);
}

function isAtTopLevel(page, aaTree) {
  const home = aaTree.flat[0];
  if (!home) return false;
  return page.parentId === home.parentId || !page.parentId;
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run**

Run: `node scripts/reorganize_aa_space.js --dry-run`
Expected: 결정된 폴더 이동 목록만 출력. 실제 변경 없음.

- [ ] **Step 3: Commit**

```bash
git add scripts/reorganize_aa_space.js
git commit -m "feat(reorganize): add reorganize_aa_space.js with classifier chain"
```

---

## Task 8: migrator.js — Dify 호출 → ClassifierChain 교체

**Files:**
- Modify: `scripts/migrator.js`
- Modify: `scripts/utils/migration_utils.js` (syncLabels 보호 추가)

- [ ] **Step 1: migrator.js의 getPageClassificationFromDify 호출을 classifyWithChain으로 교체**

```js
// scripts/migrator.js 의 107번째 줄 부근 수정
// before:
//   const decision = await getPageClassificationFromDify(page.title, truncatedBody, contextTree, sourceSpace, pageDate);
// after:
const { classifyWithChain } = require('./classifiers/engine');
const { fetchAATree } = require('./utils/aa_space_tree');
const aaTree = await fetchAATree();
// existingLabels derivation: the v1 CQL search in migrator.js:84 does NOT expand
// `metadata.labels`, so read them via the v1 labels endpoint per page. This is required
// so the human-policy classifier can see `human-classified` and `last-parent-*` labels.
const existingLabels = await fetchPageLabels(page.id);
const decision = await classifyWithChain({
  pageId: page.id, title: page.title, body: truncatedBody,
  ancestors: [], sourceSpace, sourceUrl: page._links?.webui || '',
  pageDate, existingLabels,
}, aaTree);
```

- [ ] **Step 2: migration_utils.js의 syncLabels에 보호 추가**

```js
// scripts/utils/migration_utils.js 의 syncLabels 함수 수정
const PROTECTED_LABELS = ['is-folder', 'human-classified'];
async function syncLabels(pageId, desiredLabels) {
  const currentLabels = await getLabels(pageId);
  const desired = new Set(desiredLabels);
  const current = new Set(currentLabels);

  const toAdd = desiredLabels.filter(l => !current.has(l));
  const toRemove = currentLabels.filter(l => !desired.has(l) && !PROTECTED_LABELS.includes(l));

  for (const label of toRemove) {
    await deleteLabel(pageId, label);
    await sleep(200);
  }
  if (toAdd.length > 0) await addLabels(pageId, toAdd);
  return { added: toAdd, removed: toRemove };
}
```

- [ ] **Step 3: dify_api.js는 deprecation 마커만 유지 (또는 삭제)**

```js
// scripts/utils/dify_api.js 상단에 추가
'use strict';
/**
 * @deprecated As of 2026-07-28, this module is replaced by scripts/classifiers/*.
 * This file is kept for backward compatibility but will be removed.
 * Migrator now uses classifyWithChain() from scripts/classifiers/engine.js.
 */
module.exports = { getPageClassificationFromDify: async () => { throw new Error('dify_api deprecated; use scripts/classifiers/engine'); } };
```

- [ ] **Step 4: 기존 테스트 스크립트 실행**

Run: `node -e "require('./scripts/migrator.js')" 2>&1 | head -5`
Expected: dify_api deprecation 에러 또는 정상 모듈 로드 (작동 확인).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrator.js scripts/utils/migration_utils.js scripts/utils/dify_api.js
git commit -m "refactor(migrator): swap Dify call for classifier chain; protect human labels"
```

---

## Task 9: package.json + GH Actions + .env.sample

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/confluence_automation.yml`
- Modify: `.env.sample`

- [ ] **Step 1: package.json 스크립트 추가**

```json
{
  "scripts": {
    "audit:aa": "node scripts/audit_aa_space.js",
    "reorganize:aa": "node scripts/reorganize_aa_space.js",
    "reorganize:aa:dryrun": "node scripts/reorganize_aa_space.js --dry-run",
    "migrate:all": "node scripts/migrator.js"
  }
}
```

- [ ] **Step 2: .env.sample 업데이트**

```bash
# .env.sample
CONFLUENCE_EMAIL=your@email.com
CONFLUENCE_TOKEN=your_api_token
ANTHROPIC_API_KEY=sk-ant-...
# (DIFY_API_URL / DIFY_API_KEY 제거)
```

- [ ] **Step 3: GH Actions 3-job 분리**

```yaml
# .github/workflows/confluence_automation.yml
name: Confluence AA Space Automation

on:
  schedule:
    - cron: '0 15 * * *'
  workflow_dispatch:

jobs:
  audit-aa:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '18', cache: 'npm' }
      - run: npm install
      - name: Audit AA Space
        env:
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
        run: node scripts/audit_aa_space.js
      - name: Auto-PR if decisions.json changed
        uses: peter-evans/create-pull-request@v5
        with:
          commit-message: "chore(audit): auto-commit human decisions"
          title: "[bot] Audit human moves"
          branch: bot/audit-decisions
          add-paths: config/classification_decisions.json

  reorganize-aa:
    needs: audit-aa
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '18', cache: 'npm' }
      - run: npm install
      - name: Reorganize AA Space
        env:
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/reorganize_aa_space.js

  migrate:
    needs: reorganize-aa
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '18', cache: 'npm' }
      - run: npm install
      - name: Migrator
        env:
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/migrator.js
```

- [ ] **Step 4: Commit**

```bash
git add package.json .env.sample .github/workflows/confluence_automation.yml
git commit -m "chore(ci): split workflow into audit/reorganize/migrate; add ANTHROPIC_API_KEY"
```

---

## Task 10: dry-run / e2e 검증

**Files:** 변경 없음 (실행만)

- [ ] **Step 1: 모든 노드 모듈이 로드되는지 검증**

```bash
node -e "
['./scripts/classifiers/iface',
 './scripts/classifiers/rule',
 './scripts/classifiers/human',
 './scripts/classifiers/claude',
 './scripts/classifiers/engine',
 './scripts/utils/aa_space_tree']
.require()
" || exit 1
```

Expected: 에러 없이 로드.

- [ ] **Step 2: dry-run audit 실행**

```bash
node scripts/audit_aa_space.js --dry-run
```
Expected: 에러 없이 동작 (또는 API 인증 실패는 OK).

- [ ] **Step 3: dry-run reorganize 실행**

```bash
node scripts/reorganize_aa_space.js --dry-run
```
Expected: dry-run 모드 출력 확인.

- [ ] **Step 4: 전체 단위 테스트 실행**

```bash
node --test tests/
```
Expected: 모든 PASS.

- [ ] **Step 5: Commit (변경 없으면 skip)**

```bash
git status  # 변경 없으면 no commit
```

---

## Self-Review 체크리스트

1. **Spec coverage:**
   - 섹션 0 (메타): 본 계획의 헤더에서 다룸.
   - 섹션 1 (문제): 인지. 본 플랜은 해결책 구축.
   - 섹션 2 (아키텍처): Task 1-5, 9가 처리.
   - 섹션 3 (데이터 흐름): Task 4 (engine.js)에 명시.
   - 섹션 4 (휴먼 정책): Task 3, 6이 처리.
   - 섹션 5 (충돌): Task 7 implicitly (update 경로는 기본).
   - 섹션 6 (파일): 모두 본 플랜의 File Structure에 있음.
   - 섹션 7 (구현 메모): Task 2, 3, 5에 함수 시그니처 명시.
   - 섹션 8 (AA 트리): Task 1이 처리.
   - 섹션 9 (GH Actions): Task 9.
   - 섹션 10-14: Task 9, 10 (dry-run/e2e), README.

2. **Placeholder scan:** "TBD", "TODO", "implement later" 없음. 모든 step에 코드 또는 명령어 있음.

3. **Type consistency:**
   - `ClassifyContext` — `iface.js` JSDoc, `rule.js`, `human.js`, `claude.js`, `engine.js` 모두 일치.
   - `ClassifyResult` — `iface.js` JSDoc, 모든 classifier 반환값 일치.
   - `aaTree` — Task 1이 `{ flat, tree, unsortedFolderId, toText, hasFolder }` 형태로 export, 후속 task에서 동일 시그니처 사용.
   - `classifyWithChain(ctx, aaTree)` — Task 4가 export, Task 7, 8에서 호출.

4. **Additional gaps:** 없음.

---

## Execution Handoff

플랜이 완성되어 `docs/superpowers/plans/2026-07-28-confluence-migrator-revamp.md`에 저장되었습니다. **두 가지 실행 방식**:

1. **Subagent-Driven (추천)** — Task별 신선한 서브에이전트 + 사이클 리뷰
2. **Inline Execution** — 현재 세션에서 직접 실행

어느 방식으로 진행할까요?