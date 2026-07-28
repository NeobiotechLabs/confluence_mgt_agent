# Confluence Migrator 재설계 — Dify 의존 제거 + 휴먼 분류 정책

## 0. 메타

- **작성일**: 2026-07-28
- **대상 저장소**: `NeobiotechLabs/confluence_mgt_agent`
- **배경**: 기존 마이그레이션 시스템에서 **분류 추론**을 사내 Dify 워크플로우에 위임하고 있었음. Dify 외부 의존성을 제거하고, 휴먼 결정 + 룰 + LLM fallback 체인을 GitHub Actions 환경에서 동작하도록 재설계.
- **목표**: (1) Dify 의존 완전 제거, (2) 휴먼이 AA 스페이스 UI에서 수동으로 이동/라벨링한 결과를 다음 실행에 자동 반영, (3) 현재 AA 스페이스에 잘못 배치된 페이지 재배치.

---

## 1. 문제 정의

### 1.1 현재 상태

- `scripts/migrator.js` → `scripts/utils/dify_api.js` → 사내 Dify Workflow
- Dify Knowledge: `dify/space_rules_knowledge.md` (스페이스별 룰, 레이블 사전)
- Dify System Prompt: `dify/system_prompt.md` (JSON 출력 스키마)
- GitHub Actions Secrets: `DIFY_API_URL`, `DIFY_API_KEY`
- **결과**: 분류 추론이 외부 서비스 장애·키 회수 시 즉시 실패, 결정 로그가 Dify 응답 본문 안에 있어 추적 어려움, 휴먼이 잘못된 분류를 정정할 수단 부재.

### 1.2 핵심 통찰

- `scripts/analyze_migration_candidates.js`는 **이미 `config/analysis_rules.json` 룰 기반**으로 동작 중. Dify는 사실상 "룰을 못 맞춘 새 케이스"의 fallback임.
- 휴먼이 AA 스페이스에서 페이지를 옮기면 그 정보가 `parentId`에 즉시 반영되지만, 자동화 시스템은 다시 그 페이지를 잘못된 자리에 두는 경우가 있었음.

### 1.3 해결 방향

- **분류 체인**: 휴먼 정책(`classification_decisions.json`) → 룰(`analysis_rules.json`) → Claude API(LLM fallback) → 미분류 폴더
- **휴먼 결정 흡수**: UI에서 이동한 페이지를 다음 `audit` 실행 시 자동으로 감지, `classification_decisions.json`에 commit
- **충돌 처리**: 동일 제목 = update (인플레이스)
- **자동화 빈도**: 기존 cron 매일 09:00 KST 유지

---

## 2. 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│  GitHub Actions (self-hosted, 매일 09:00 KST)                       │
│                                                                     │
│  ① scripts/audit_aa_space.js                                        │
│      └─ AA 스페이스 페이지 트리 조회 → 최상위/고아 페이지 리포트     │
│      └─ 휴먼이 이미 옮긴 페이지의 위치를 decisions.json에 commit     │
│                                                                     │
│  ② scripts/reorganize_aa_space.js                                   │
│      └─ Classifier 체인: 휴먼 정책 → 룰 → Claude → 미분류            │
│      └─ 결정된 폴더로 movePage (update 모드)                        │
│                                                                     │
│  ③ scripts/migrator.js (기존, Dify 호출만 교체)                     │
│      └─ 원본 스페이스 → AA 이관 (분류는 reorganize와 동일 체인)      │
│                                                                     │
│  Secrets: CONFLUENCE_*, ANTHROPIC_API_KEY                            │
│  (제거: DIFY_API_URL, DIFY_API_KEY)                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  config/                                                            │
│    ├── analysis_rules.json     (기존) 룰 정의                        │
│    └── classification_decisions.json  (신규) 휴먼 정책                │
│                                                                     │
│  scripts/classifiers/            (신규, Port/Adapter)                │
│    ├── iface.js                 ClassifierIface                       │
│    ├── rule.js                  RuleClassifier (analysis_rules 기반) │
│    ├── human.js                 HumanPolicyClassifier (decisions)    │
│    ├── claude.js                ClaudeClassifier (LLM fallback)      │
│    └── engine.js                ClassifierChain (순차 fallback)      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 데이터 흐름: Classifier Chain

### 3.1 입력 컨텍스트

```js
{
  pageId: string,         // 원본 페이지 ID
  title: string,          // 페이지 제목
  body: string,           // 페이지 본문 (truncated)
  ancestors: string[],    // 원본 스페이스 내 조상 페이지 제목 (root → leaf)
  sourceSpace: string,    // 원본 스페이스 키 (SD, WND, Device, SmileArch)
  sourceUrl: string,      // 페이지 webUrl
  pageDate: string,       // ISO 8601 (YYYY-MM-DD)
  existingLabels: string[] // 이미 부착된 레이블
}
```

### 3.2 체인 순서

```
┌────────────────────────────────────────────────────────────┐
│ 1) HumanPolicyClassifier                                    │
│    classification_decisions.json 룰 순회                    │
│    match: { titleRegex, ancestorContains, sourceSpace,     │
│             labels }                                       │
│    첫 매칭에서 targetFolderId → 확정                        │
│    일치 → { ok: true, source: 'human', folderId, labels }   │
└────────────────────────────────────────────────────────────┘
                          │ miss
                          ▼
┌────────────────────────────────────────────────────────────┐
│ 2) RuleClassifier (config/analysis_rules.json)              │
│    analyze_migration_candidates.js의 엔진 재사용           │
│    - 글로벌 exclude (archived, dailyScrum, weeklyDate)     │
│    - cutoff_date 이전                                       │
│    - 카테고리 룰 순회 → category/subCategory/labels         │
│    일치 → { ok: true, source: 'rule', folderId, labels }    │
└────────────────────────────────────────────────────────────┘
                          │ miss
                          ▼
┌────────────────────────────────────────────────────────────┐
│ 3) ClaudeClassifier (LLM fallback)                          │
│    Anthropic Messages API (model: claude-haiku-4-5)         │
│    system_prompt: dify/system_prompt.md + knowledge 변환    │
│    tools: { context_tree, label_catalog, folder_catalog }   │
│    → 정확히 1개 folderId 반환하도록 제한                     │
│    결과 → { ok: true, source: 'claude', folderId, labels }  │
└────────────────────────────────────────────────────────────┘
                          │ miss or error
                          ▼
┌────────────────────────────────────────────────────────────┐
│ 4) 폴백: AA 스페이스의 "미분류" 폴더 + label 'needs-review' │
│    + 사람이 분류할 수 있도록 분류 보류 큐에 적재             │
└────────────────────────────────────────────────────────────┘
```

### 3.3 Classifier 인터페이스

```js
// scripts/classifiers/iface.js
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
 * @property {string} [folderId]      // AA 폴더 ID
 * @property {string} [folderTitle]   // 디버깅용
 * @property {string[]} [labels]      // 부착할 레이블
 * @property {string} [reason]        // chain에서 사용
 *
 * @typedef {Object} ClassifierIface
 * @property {string} name
 * @property {(ctx: ClassifyContext, aaTree: AATree) => Promise<ClassifyResult>} classify
 */
```

### 3.4 Classifier 엔진

```js
// scripts/classifiers/engine.js
async function classifyWithChain(ctx, aaTree) {
  // 1) 휴먼
  const human = await humanClassifier.classify(ctx, aaTree);
  if (human.ok) return human;

  // 2) 룰
  const rule = await ruleClassifier.classify(ctx, aaTree);
  if (rule.ok) return rule;

  // 3) Claude (LLM fallback)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const claude = await claudeClassifier.classify(ctx, aaTree);
      if (claude.ok) return claude;
    } catch (e) {
      log.warn('claude fallback failed', e.message);
    }
  }

  // 4) 미분류 폴더로
  return { ok: true, source: 'fallback', folderId: aaTree.unsortedFolderId, labels: ['needs-review'] };
}
```

---

## 4. 휴먼 정책 파일 스키마

### 4.1 `config/classification_decisions.json`

```jsonc
{
  "$schema_version": "1.0",
  "decisions": [
    {
      "id": "dec-2026-07-28-001",
      "match": {
        "titleRegex": "(?i)임플란트\\s*로봇",        // 제목 정규식
        "ancestorContains": "Device",                // 또는 조상 경로
        "sourceSpace": "Device",                    // 또는 원본 스페이스
        "labels": ["group-device"]                  // 또는 이미 가진 레이블
      },
      "targetFolderId": "123456789",
      "targetFolderTitle": "기구설계 > Implant Robot",
      "labels": ["group-device", "project-implant-robot", "doctype-spec"],
      "decidedBy": "jaehwan.sim",
      "decidedAt": "2026-07-28T10:00:00Z",
      "source": "human-ui-move"          // human-ui-move | manual-script | rule-promoted
    }
  ]
}
```

### 4.2 매칭 규칙

- **AND 결합**: `match` 객체의 모든 키 값이 만족해야 매칭. 단, 각 키 값은 배열 · 정규식 등 다양한 표현 OK.
- **우선순위**: `source` 필드 (`human-ui-move` > `manual-script` > `rule-promoted`). 같은 source 안에서는 `decidedAt` 최신 우선.
- **titleRegex**: JS `RegExp` 다이렉트 사용. 플래그 `i` 강제.
- **ancestorContains**: 조상 배열 중 하나라도 부분일치.
- **sourceSpace**: 정확 일치.
- **labels**: 배열이면 OR (existingLabels 중 하나라도 일치).

### 4.3 휴먼 결정 자동 commit (audit 단계)

```
scripts/audit_aa_space.js
  1. AA 스페이스 모든 페이지 조회 (depth 제한)
  2. 페이지의 label 중 'last-parent-{id}' 가 있다면 → 직전 부모
  3. 현재 부모 ≠ 직전 부모 → 이동 발생
  4. 휴먼 ui-move로 추정 가능한 경우:
     - 휴먼이 최상위(AA 홈)에서 특정 폴더로 페이지를 옮긴 경우
     - 그 페이지가 RuleClassifier에 의해 분류되지 않았던 페이지인 경우
     → classification_decisions.json에 신규 entry 추가
       { source: 'human-ui-move', decidedBy: <git config email>, decidedAt: <now> }
  5. 페이지 라벨에 'last-parent-{id}' = <currentParentId> 기록
  6. 리포트: 최상위 + 고아 페이지만 .github/reports/audit-{date}.md
```

**중복 방지**: 휴먼이 옮긴 페이지의 새로운 부모 폴더와 **RuleClassifier가 분류했을 것 같은 폴더**가 동일하면 휴먼 정책 신규 등록을 생략. (즉, RuleClassifier가 이미 판단할 수 있는 케이스라면 휴먼 이동은 그냥 Rule의 결과로 인정.)
업데이트된 휴먼 정책 등록 조건:
1. 페이지가 **최상위**에서 옮겨졌거나, **고아**였음 (`parentId === AA_HOME` 또는 `parentId`가 unknown).
2. 휴먼이 임의로 만든 폴더(IS-FOLDER 레이블이 새 폴더)로 이동한 경우 (RuleClassifier가 절대 매칭 못 하는 케이스).
3. 또는 휴먼이 옮긴 위치가 RuleClassifier가 모를 만한 카테고리인 경우 (예: `분류 보류` → `HW 부품 조사`).

경우 1과 2, 3이 모두 아니면 휴먼 정책 신규 등록 안 함.

---

## 5. 충돌 처리 (update 모드)

| 케이스 | 동작 |
|--------|------|
| AA 스페이스에 동일 제목 페이지 없음 | create (기존) |
| 동일 제목 페이지 존재, 같은 부모 | update (인플레이스) |
| 동일 제목 페이지 존재, 다른 부모 | 그대로 두고 `needs-merge: title` 로그, 사람 큐 |

업데이트 시:
- 배너 + 본문 + 첨부 재매핑
- 본문 내 SD 페이지 ID → AA 페이지 ID 치환 (`fixBodyReferences`)
- 레이블: `syncLabels`로 결손분만 추가, 불필요분 제거 (단, `is-folder`, `human-classified`, `last-parent-*`는 보호)

---

## 6. 신규/변경 파일

### 6.1 신규

| 파일 | 설명 |
|------|------|
| `scripts/classifiers/iface.js` | `ClassifierIface` JSDoc typedef |
| `scripts/classifiers/rule.js` | `RuleClassifier` (analysis_rules.json 기반) |
| `scripts/classifiers/human.js` | `HumanPolicyClassifier` (decisions.json 기반) |
| `scripts/classifiers/claude.js` | `ClaudeClassifier` (Anthropic API) |
| `scripts/classifiers/engine.js` | `ClassifierChain` (순차 fallback) |
| `scripts/audit_aa_space.js` | 최상위/고아 + 휴먼 이동 감지 |
| `scripts/reorganize_aa_space.js` | 휴먼 정책 기반으로 AA 내부 재배치 |
| `scripts/utils/aa_space_tree.js` | IS-FOLDER 트리 캐시 + 텍스트 변환 |
| `config/classification_decisions.json` | 휴먼 정책 (빈 `decisions: []`로 시작) |
| `docs/superpowers/specs/2026-07-28-confluence-migrator-revamp-design.md` | 본 문서 |
| `tests/classifiers/*.test.js` | 단위 테스트 (선택) |

### 6.2 변경

| 파일 | 변경 내용 |
|------|----------|
| `scripts/migrator.js` | Dify 호출 → `classifierChain()` |
| `scripts/utils/migration_utils.js` | `movePage` 활용, `syncLabels` 보완 (`human-classified`, `last-parent-*` 보호) |
| `scripts/utils/dify_api.js` | **삭제** (또는 deprecation notice) |
| `.github/workflows/confluence_automation.yml` | 3-job 분리 (`audit` → `reorganize` → `migrate`), `ANTHROPIC_API_KEY` 추가, `DIFY_*` 제거 |
| `package.json` | `npm run` 스크립트 추가 (`audit:aa`, `reorganize:aa`) |
| `.env.sample` | `ANTHROPIC_API_KEY` 추가, `DIFY_*` 제거 |

### 6.3 그대로 유지

- `config/analysis_rules.json` (룰 정의)
- `reference/migration_candidates.md` 호환 (룰 분석기는 그대로 호출)
- `scripts/refresh_result_json.js`
- `scripts/clean_aa_space.js`
- `scripts/setup_aa_space.js`
- `scripts/batch_utility.js`

---

## 7. Classifier 구현 메모

### 7.1 RuleClassifier

`scripts/analyze_migration_candidates.js`의 `matchesCategory` + `buildCategory` + `applyTemplate` 재사용. 다음을 함수로 export:

```js
// scripts/classifiers/rule.js
async function classify(ctx, aaTree) {
  const matched = findFirstMatchingCategory(ctx);
  if (!matched) return { ok: false };
  const folderId = resolveFolderFromCategory(matched.category, aaTree);
  if (!folderId) return { ok: false };
  return {
    ok: true,
    source: 'rule',
    folderId,
    folderTitle: matched.category,
    labels: matched.labels,
    reason: matched.id,
  };
}
```

### 7.2 HumanPolicyClassifier

```js
async function classify(ctx, aaTree) {
  const decisions = await loadDecisions();
  const sorted = sortByPriorityAndDate(decisions);
  for (const d of sorted) {
    if (matches(d.match, ctx)) {
      return { ok: true, source: 'human', folderId: d.targetFolderId, folderTitle: d.targetFolderTitle, labels: d.labels, reason: d.id };
    }
  }
  return { ok: false };
}
```

### 7.3 ClaudeClassifier

```js
async function classify(ctx, aaTree) {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildSystemPrompt(),
    tools: [folderSelectorTool(aaTree), labelSelectorTool()],
    messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
  });
  // tool_use 응답에서 folderId, labels 추출
  // 폴더 ID가 aaTree에 존재하지 않으면 miss 처리
  return result;
}
```

`dify/system_prompt.md` + `dify/space_rules_knowledge.md`를 Anthropic system prompt로 변환. 마크다운 → XML/JSON 직접 매핑.

### 7.4 Anthropic API 키

- GitHub Actions Secret: `ANTHROPIC_API_KEY`
- `.env.sample`: `ANTHROPIC_API_KEY=sk-ant-...`
- 키 미설정 시 ClaudeClassifier는 건너뛰고 룰 → 휴먼 → 미분류로 진행 (sigsegv 방지)

---

## 8. AA 트리 캐시

```js
// scripts/utils/aa_space_tree.js
async function fetchAATree() {
  const pages = await fetchAllAAPages();
  const folders = pages.filter(p => p.labels.includes('is-folder'));
  const tree = buildTree(folders);
  return {
    flat: folders,                  // [{ id, title, parentId, ancestors: [] }]
    tree,                           // nested
    unsortedFolderId: findUnsorted(folders),
    toText: () => formatTreeAsText(tree),
    hasFolder: (id) => folders.some(f => f.id === id),
  };
}
```

기존 `scripts/utils/confluence_api.js`의 `fetchAASpaceTreeText()` 결과를 재사용하되 trees 형태로 cache.

---

## 9. GitHub Actions 변경

### 9.1 `.github/workflows/confluence_automation.yml`

```yaml
name: Confluence AA Space Automation

on:
  schedule:
    - cron: '0 15 * * *'  # 매일 09:00 KST
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
        # decisions.json 변경 시 PR 자동 생성 (peter-evans/create-pull-request)

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

### 9.2 시크릿 변경

- **추가**: `ANTHROPIC_API_KEY`
- **제거**: `DIFY_API_URL`, `DIFY_API_KEY` (코드 제거 후 정리)

---

## 10. 마이그레이션 시퀀스 (변경 후)

```
[09:00 KST] audit_aa_space
  └─ 휴먼 UI 이동 detection → classification_decisions.json commit (PR)
  └─ 최상위/고아 리포트

[09:05 KST] reorganize_aa_space
  └─ Classifier Chain으로 미배치·잘못배치 페이지 재배치
  └─ 휴먼 정책 → 룰 → Claude → 미분류

[09:10 KST] migrate
  └─ 원본 스페이스 → AA 이관 (분류 동일 체인)
```

---

## 11. 테스트 전략

### 11.1 단위 (선택 사항)

- `tests/classifiers/rule.test.js`: 룰 매칭, fallback, exclude
- `tests/classifiers/human.test.js`: decisions.json 순회, 우선순위
- `tests/classifiers/claude.test.js`: mock API로 tool_use 응답 파싱
- `tests/classifiers/engine.test.js`: 체인 순서, fallback 동작

### 11.2 dry-run

- 모든 신규/변경 스크립트는 `--dry-run` 옵션 지원. 결정만 출력, 실제 페이지 변경 없음.

### 11.3 e2e (manual)

1. audit dry-run → 리포트 확인
2. 사람이 UI에서 일부 페이지 이동
3. 다음 audit 실행 → decisions.json에 commit 확인
4. reorganize dry-run → 재배치 결정 확인
5. 실제 실행 → 결과 확인

---

## 12. 롤아웃

1. `config/classification_decisions.json` 빈 파일로 시작 (`{"$schema_version": "1.0", "decisions": []}`)
2. `scripts/classifiers/` 모듈 신규 추가 (기존 코드 미변경)
3. `scripts/migrator.js`의 Dify 호출 한 줄을 `classifierChain()`로 교체 (feature flag)
4. `audit_aa_space.js` + `reorganize_aa_space.js` 추가
5. GH Actions에서 `DIFY_*` 시크릿 제거, `ANTHROPIC_API_KEY` 추가
6. 1주일 dry-run 모니터링 → 휴먼 확인 후 Dify 코드 제거

---

## 13. 비목표 (Out of Scope)

- Dify 자체를 다시 사용하는 옵션
- 다른 스페이스 (Cloud, Server) 지원
- 실시간 bidirectional sync (CI는 eventual)
- Migration log 자동 분석 (대시보드)
- Web UI / Config Editor Tool

---

## 14. 참고

- 기존: `scripts/migrator.js`, `scripts/utils/dify_api.js`, `dify/system_prompt.md`, `dify/space_rules_knowledge.md`
- 룰 엔진: `scripts/analyze_migration_candidates.js`, `config/analysis_rules.json`
- AA 트리: `scripts/utils/confluence_api.js`의 `fetchAASpaceTreeText()`
- GH Actions: `.github/workflows/confluence_automation.yml`
- CLAUDE.md: 키워드 `마이그레이션`, `Dify`, `IS-FOLDER`
