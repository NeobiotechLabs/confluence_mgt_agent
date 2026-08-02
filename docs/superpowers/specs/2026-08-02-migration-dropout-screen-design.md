# 작업 15 — 이관 탈락 후보 판정 (Migration Dropout Screening)

> 설계 작성일: 2026-08-02
> 상태: 디자인 (구현 전 사용자 승인 대기)
> 참조: `reference/ToDo.md` §4 작업 15, `docs/ideation/autoloop_and_report.md` §4-§7

## 1. 문제

현재 `runMigrate`는 두 가지 상태만 가진다 — `created/synced` (정상 이관) 또는 `skipped/failed` (이관 못 함). **세 번째 상태 — "이관 가치 없음"은 부재**. 그 결과:

- "끄적임", 임시 스크랩, 학습 노트처럼 조직·과제 입장에서 업무 가치가 없는 페이지도 AA 스페이스로 이관됨.
- §2 부록에서 운영자가 어떤 페이지가 저가치였는지 가시적으로 보이지 않음 → LLM 지침 개선 입력 약함.
- 같은 페이지가 매일 후보에 올라오면 LLM 호출이 반복됨 (작업 16 캐시 요구의 1차 형태).

## 2. 목표

LLM의 가치 평가를 추가하여 3상태로 분기:

| status | 의미 | 액션 |
|---|---|---|
| `created` / `synced` | 적절한 폴더로 분류 성공 | 정상 이관 |
| `unclassified` | 분류 의향은 있지만 어디가 애매 | 미분류 폴더 이관 + LLM 의견 코멘트 |
| `dropped` | 이관 가치 없음 (끄적임, 임시 스크랩) | AA에 들어오지 **않음** |

추가 요구:

1. **SSOT 캐시**: `reference/dropped_pages.json` — 같은 페이지가 다시 후보에 와도 LLM 재호출 없이 dropped (단, 7일 후 자동 재평가).
2. **§2 부록**: 3상태 모두 사유 + 추천 폴더 / 재평가 시각 표시.
3. **§4 AI 권고**: unclassified 누적이 "폴더 신설" 권고 입력으로 자연스럽게 흐르도록 (기존 §4 LLM 권고에 흡수, 별도 변경 없음).

## 3. 비목표

- 사용자 수동 복원 CLI (별도 후속 작업).
- SSOT 파일 자동 백업/로테이션.
- §4 AI 권고의 unclassified 가중치 명시 (기존 LLM 권고에 의존).
- 분류 캐시 (작업 16과 별도).

## 4. 아키텍처

### 4-1. 책임 분리

기존 분류 체인(`classifyWithChain`)은 **어디에 넣을지**만 판단. 가치 평가는 **별도 LLM 호출**로 분리. 이유:

- LLM 단일 책임 → 응답 안정성, 디버깅·테스트 쉬움.
- 분류와 가치는 다른 평가 기준 (폴더 적합성 vs 조직 업무 가치).
- 7일 후 재평가 시 **가치 평가만** 다시 호출. 분류는 작업 16 캐시와 자연 연결.

### 4-2. 흐름

```
runMigrate (for each candidate page)
  ├─ 1. classifyWithChain(ctx, aaTree)         [기존, 변경 없음]
  │    → {ok, folderId, labels, source}
  ├─ 2. consultDroppedCache(pageId, hash, today)  [신규]
  │    → {cached: bool, reevaluate: bool, entry?: {...}}
  ├─ 3. assessMigrationValue(ctx, aaTree)         [신규, LLM #2]
  │    → {verdict: 'create' | 'unclassified' | 'dropped', reason, suggestedFolderId?}
  └─ 4. 분기
       - dropped & cached → 즉각 dropped (LLM 호출 절감)
       - dropped & not cached → 캐시 upsert + dropped
       - unclassified → 미분류 폴더 이관 + 의견
       - create → 정상 이관
```

### 4-3. 7일 재평가

- `firstSeen + 7일 <= today`가 되면 다음 사이클에서 LLM 재호출.
- 재평가 dropped 유지 → `firstSeen` 유지, `lastSeen`/`nextReevalAt` 갱신.
- 재평가 unclassified → 캐시에서 제거, 페이지 미분류 폴더 이관.
- 재평가 create → 캐시에서 제거, 정상 이관.

## 5. 컴포넌트

### 5-1. `scripts/utils/migration_value.js` (신규)

```js
async function assessMigrationValue(ctx, aaTree, deps) {
  // 키 부재 / llm deps 없음 → 보수적으로 'create' (운영 설정 이슈이지 페이지 가치 판단이 아님)
  // callLLMForMigrationValue 호출, 결과 정규화
  // verdict ∈ {create, unclassified, dropped} 검증
  return { ok: true, verdict, reason, suggestedFolderId? };
}
```

- `classification_provider.js`와 같은 의존성 주입 패턴 (`deps.llm`).
- 모든 외부 의존은 `deps`로 주입 가능 (테스트 격리).

### 5-2. `scripts/utils/value_prompt.js` (신규)

`classification_prompt.js`와 동일 패턴:

- `SELECT_MIGRATION_VALUE_TOOL` — Anthropic tool_use 스키마.
- `buildValueSystemPrompt({treeText, guidelines})` — system prompt.
- `buildValueUserMessage({title, bodyText, classifyHint})` — `classifyHint`로 1차 분류 결과(후보 폴더/라벨) 전달 → LLM이 가치 판단 시 일관된 시각 유지.

**가치 판단 기준 (system prompt에 포함)**:

- `create`: 조직·과제 입장에서 업무 가치가 있어 AA에 보관할 만함.
- `unclassified`: 가치는 있지만 분류 애매 — 기존에 부합 폴더가 없거나 둘 이상 경합. `suggestedFolderId`로 추천 폴더 명시.
- `dropped`: 개인 메모, 임시 캡처, 학습 노트, 외부 스페이스의 임시 스냅샷 등. AA 보관 가치 없음.

이관 배너 무시는 `classification_guidelines.md` §1.4와 일관 — 가치 판단에서도 본문 앞머리의 자동 이관 배너는 메타데이터로 취급.

### 5-3. `llm_api.js` 확장

`callLLMForMigrationValue` 추가:

```js
async function callLLMForMigrationValue({
  client, title, body, treeText, guidelines, classifyHint, model, max_tokens = 512, callFn = callLLM,
}) {
  const system = buildValueSystemPrompt({ treeText, guidelines });
  const user = buildValueUserMessage({ title, bodyText: extractBodyText(body), classifyHint });
  const r = await callFn({ client, system, user, tools: [SELECT_MIGRATION_VALUE_TOOL], model, max_tokens });
  // 정규화: verdict 검증, 모르는 enum → 'create'
  // 실패 (ok=false) → {ok:false, verdict:'create', reason: r.reason || 'miss'}
}
```

max_tokens 512 (분류보다 작은 출력).

### 5-4. `scripts/migrator/dropped_cache.js` (신규)

기존 `unmatched_state_io.js` 패턴 그대로:

```js
async function loadDroppedCache(file)             { /* 부재/깨짐 → [] */ }
async function saveDroppedCache(file, items)      { /* .tmp → rename 원자 */ }
function shouldReevaluate(entry, today)            { /* nextReevalAt <= today */ }
function consultDroppedCache(pageId, hash, today, cache) {
  // {cached: true, entry}  | {cached: false, reevaluate: false}
  // | {cached: true, reevaluate: true, prevEntry}
}
function mergeDroppedCache(cache, updates) {
  // (pageId, hash) 키로 upsert (lastSeen, nextReevalAt 갱신)
  // {remove: true} → 제거
}
function hashFor(page) { /* pageId + length + 첫 200자 sha1 → 16자 */ }
```

SSOT 스키마:

```json
[
  {
    "pageId": "12345",
    "sourceSpace": "SD",
    "title": "...",
    "hash": "abc123...",
    "reason": "개인 메모, 업무 관련 없음",
    "firstSeen": "2026-08-02",
    "lastSeen": "2026-08-02",
    "nextReevalAt": "2026-08-09"
  }
]
```

### 5-5. `scripts/migrator.js` (수정)

`runMigrate`에 위 모듈 와이어업:

- deps 주입 6개 추가: `assessMigrationValue`, `loadDroppedCache`, `saveDroppedCache`, `consultDroppedCache`, `mergeDroppedCache`, `hashFor`.
- `DROPPED_CACHE_PATH = 'reference/dropped_pages.json'`.
- 캐시 로드 1회 (페이지 루프 시작 전) → `cacheUpdates` 누적 → 마지막에 머지·저장.
- `today` 결정: `runAt.slice(0, 10)` (report_aa_daily.js와 일관).
- status 분기 5종: `created / synced / unclassified / dropped / failed`.

분기 로직 (요약):

```js
if (chainResult.folderId에는 분기 의존 없음) {
  // classifyWithChain 결과만 보고는 분기 안 함. 가치 평가 후 verdict로 결정.
}

const cacheResult = consultDroppedCache(pageId, hash, today, droppedCache);
let verdict, reason, source;

if (cacheResult.cached && !cacheResult.reevaluate) {
  verdict = 'dropped';
  reason = cacheResult.entry.reason;
  source = 'cache';
} else {
  const value = await assessMigrationValue(ctx, aaTree, deps);
  verdict = value.verdict;
  reason = value.reason;
  source = value.source;
  // dropped → cacheUpdates.push({upsert})
  // unclassified & cacheResult.reevaluate → cacheUpdates.push({remove})
  // create & cacheResult.reevaluate → cacheUpdates.push({remove})
}

if (verdict === 'dropped') {
  items.push({ status: 'dropped', reason, reevalDueAt: ..., cacheHit: !!cacheResult.cached, ... });
  continue;
}

if (verdict === 'unclassified') {
  // targetFolderId = aaTree.unsortedFolderId (chainResult.folderId가 null이면 unsorted)
  // 또는 chainResult.folderId가 unsortedFolderId였던 경우는 그대로 진행
  // (실행 경로는 기존 create/sync 그대로, status만 'unclassified')
  items.push({ status: 'unclassified', reason, suggestedFolderId: ... });
  // 재평가가 unclassified였으면 캐시에서 제거
  continue;
}

// verdict === 'create' → 기존 created/synced 로직
```

**기존 decision.is_valid=false 흐름은 흡수**: 분류 실패는 어차피 verdict='unclassified' 또는 'create'로 통합 가능. `chainResult.is_valid=false` + `verdict='create'`이면 정상 이관 시도하는 모순은 LLM이 단독으로 'create'라고 응답한 경우 = LLM이 가치는 본다는 의미이므로 미분류 폴더로 이관. 안전을 위해 `chainResult.ok=false && verdict==='create'` → verdict를 `unclassified`로 강제.

**`chainResult.folderId === unsortedFolderId`** (fallback이 미분류 폴더로 보낸 경우): 별도 분기 없이 verdict 분기로 흘러감. 'create'이면 이관 시도하되 `targetFolderId = unsortedFolderId` 그대로 (폴더 ID를 명시적으로 미분류로 보냄). 'unclassified'이면 동일 결과 (중복 방지 없이 status='unclassified'로 통합).

### 5-6. `scripts/report/render.js` (수정)

`migrateSection` 그룹 순서:

```js
const GROUPS = [
  { status: 'created',      label: '신규 이관' },
  { status: 'synced',       label: '동기화 (기존 페이지 갱신)' },
  { status: 'unclassified', label: '미분류 폴더 이관 (분류 애매)' },
  { status: 'dropped',      label: '이관 가치 없음 (드롭)' },
  { status: 'failed',       label: '실패' },
];
```

테이블 헤더:

- `created/synced`: 기존 (페이지/소스/대상 폴더/분류 소스/사유).
- `unclassified`: (페이지/소스/분류 소스/사유/추천 폴더).
- `dropped`: (페이지/소스/분류 소스/사유/재평가).
- `failed`: 기존 유지.

재평가 컬럼 값은 `cacheHit=true`면 `D-N` (오늘 기준 `nextReevalAt - today` 일수), `cacheHit=false`면 `D-7` (오늘 +7일).

## 6. deps 주입 (testability)

`runMigrate({dryRun, deps})`에 6개 추가:

```js
const _assessMigrationValue = deps.assessMigrationValue || assessMigrationValue;
const _loadDroppedCache = deps.loadDroppedCache || loadDroppedCache;
const _saveDroppedCache = deps.saveDroppedCache || saveDroppedCache;
const _consultDroppedCache = deps.consultDroppedCache || consultDroppedCache;
const _mergeDroppedCache = deps.mergeDroppedCache || mergeDroppedCache;
const _hashFor = deps.hashFor || hashFor;
```

`deps.today`도 주입 가능 (테스트에서 today 고정).

## 7. 운영 스크립트 (선택)

`package.json`에 1~2개 추가:

- `npm run migration:dropped:list` — `reference/dropped_pages.json` 테이블 형식 출력.
- `npm run migration:dropped:reset -- --pageId=XXX` — 특정 페이지 캐시 제거 (수동 복원 1차 형태).

## 8. 에러 처리

| 단계 | 에러 | 처리 |
|---|---|---|
| `loadDroppedCache` | 파일 부재/깨짐/스키마 위반 | `[]`로 graceful 퇴화 |
| `assessMigrationValue` | LLM API throw, 키 부재, 도구 미사용 | `{ok:false, verdict:'create', reason:'llm-error:…'}` — 보수적 'create' → `chainResult.ok=false` 강제 unclassified로 fallback |
| `saveDroppedCache` | 디스크 쓰기 실패 | throw 안 함, `saveError` 문자열로 caller에 전달 → advisories 머지 (unmatched 패턴) |
| `assessMigrationValue` 응답 verdict | 모르는 enum | `'create'`로 fallback |
| `chainResult.ok=false` + `verdict='create'` | 가치 있다고 응답했지만 분류 실패 | verdict 강제 `'unclassified'` |
| 캐시 파일 schema mismatch | 항목 부족 | 해당 항목 skip (방어적) |

## 9. 테스트 (TDD)

### 9-1. `tests/utils/migration_value.test.js` (신규, ~8건)

- 정상: `verdict='create'` → 그대로 반환.
- 정상: `verdict='unclassified'` + `suggestedFolderId` 보존.
- 정상: `verdict='dropped'` + reason 보존.
- 실패: API throw → `{ok:false, verdict:'create', reason:'api-error:…'}`.
- 실패: 키 부재 → `verdict:'create'` 보수 fallback.
- 정규화: 모르는 enum → `'create'`.
- 정규화: `verdict` 누락 → `'create'`.
- 정규화: `verdict` 외 추가 필드 무시.

### 9-2. `tests/migrator/dropped_cache.test.js` (신규, ~10건)

- `loadDroppedCache` — 파일 부재 / 빈 파일 / 정상 / 깨진 JSON / schema 위반 → `[]`.
- `saveDroppedCache` — 원자적 쓰기 (`.tmp` → `rename`), 부모 디렉터리 자동 생성.
- `consultDroppedCache` — 캐시 미스 / 캐시 적중+재평가 미도래 / 캐시 적중+재평가 도래.
- `mergeDroppedCache` — upsert (키 일치 → lastSeen 갱신, firstSeen 유지) / 추가 (키 부재) / remove / 다중 update.
- `hashFor` — 동일 입력 → 동일 hash, 다른 title → 다른 hash.

### 9-3. `tests/migrator/run_migrate_dropout.test.js` (신규, ~10건)

- 정상: `verdict='create'` → status `created` (캐시 미스).
- 정상: `verdict='dropped'` → status `dropped`, 캐시 upsert (실 DB 호출 1회).
- 정상: 캐시 적중 → `assessMigrationValue` 호출 **안 됨** (mock 호출 카운트 0).
- 정상: 7일 후 재평가 → LLM 호출, 'unclassified' 응답 → status `unclassified`, 캐시에서 제거.
- 정상: dryRun → 캐시 저장 안 됨.
- 실패: `chainResult.ok=false` + `verdict='create'` → verdict 강제 `'unclassified'`.
- 실패: LLM throw → `verdict='create'` 보수 → unclassified fallback.
- 실패: `saveDroppedCache` 실패 → `saveError` advisories 머지, 리포트 POST는 계속.
- 동일성: 같은 페이지가 2회 후보 → 1회만 LLM 호출 (캐시 적중).
- 의존성: 모든 deps mock 가능 (이전 run_migrate.test.js 패턴).

### 9-4. `tests/report/render_migrate_dropout.test.js` (신규, ~6건)

- 5그룹 모두 렌더 (created / synced / unclassified / dropped / failed).
- dropped 그룹에 `재평가` 컬럼 표시.
- unclassified 그룹에 `추천 폴더` 컬럼 표시.
- 빈 그룹은 헤더 생략 (기존 패턴).
- escapeHtml 회귀 (테스트 1건 유지).
- 부록 JSON schema v1 보존 (advisories에 `saveError` 머지 가능).

### 9-5. 회귀 가드

- 기존 `tests/migrator/run_migrate.test.js` 8건 — `assessMigrationValue`를 mock으로 받는 deps 추가만 필요. 테스트 유지.
- `tests/utils/classification_provider.test.js` — 변경 없음.
- `npm test` 통과 기준: 기존 253 + 신규 34 = **287/287 PASS**.

## 10. 변경 파일 요약

| 파일 | 종류 | 내용 |
|---|---|---|
| `scripts/utils/migration_value.js` | 신규 | `assessMigrationValue` |
| `scripts/utils/value_prompt.js` | 신규 | 도구 스키마 + system/user 빌더 |
| `scripts/utils/llm_api.js` | 수정 | `callLLMForMigrationValue` 추가 |
| `scripts/migrator/dropped_cache.js` | 신규 | SSOT 캐시 I/O + consult/merge |
| `scripts/migrator.js` | 수정 | deps 6개 추가, 5상태 분기, 캐시 upsert/remove |
| `scripts/report/render.js` | 수정 | `migrateSection` 5그룹, dropped/unclassified 컬럼 |
| `scripts/classifiers/engine.js` | (선택) 수정 | `assessMigrationValue` deps에 등록 |
| `package.json` | (선택) 수정 | `migration:dropped:*` 스크립트 |
| `reference/dropped_pages.json` | (런타임) | 빈 배열 `[]`로 시작 |
| `reference/classification_rules.md` | 수정 | §5 "이관 탈락 후보 (작업 15)" 추가 |
| `reference/ToDo.md` | 수정 | 작업 15 완료 항목 추가 |
| `docs/AUTOMATION_GUIDE.md` | (선택) 수정 | 운영 가이드 1줄 |

## 11. 위험 & 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| LLM 2회 호출 → rate limit / 비용 | 낮음 (haiku + 수십 건/일) | deps 주입 + dry-run + 캐시 적중 |
| verdict 정규화 누락 | LLM이 모르는 enum 응답 | 보수적 `'create'` fallback + 테스트 |
| SSOT 손상 | 캐시 전소 | atomic write + graceful load |
| `chainResult.ok=false && verdict='create'` 모순 | 잘못된 폴더 생성 | 강제 unclassified fallback |
| 7일 후 자동 재평가 → 갑자기 다 풀려나 | 부록 큰 변동 | `nextReevalAt` 갱신 추적, 운영자 관찰 가능 (§5 운영 스크립트) |

## 12. 단계적 출시

1. **PR 1**: `migration_value.js` + `value_prompt.js` + `llm_api.js` 확장 + 신규 테스트 8건. (가치 평가 모듈 단독, runMigrate 미연결.)
2. **PR 2**: `dropped_cache.js` + 신규 테스트 10건. (캐시 모듈 단독.)
3. **PR 3**: `migrator.js` 통합 + `render.js` 수정 + 신규 테스트 16건. (전체 연결.)
4. **PR 4**: 운영 스크립트 (선택) + 문서 갱신.

각 PR은 `npm test` + `npm run report:aa:dryrun` 통과 검증.

## 13. 완료 기준

- [ ] §1-§12 구현.
- [ ] `npm test` 287/287 PASS.
- [ ] `npm run report:aa:dryrun` 정상 출력 (5그룹 표 + 재평가 컬럼).
- [ ] `npm run ci:local:dryrun` 정상.
- [ ] `reference/ToDo.md` 작업 15 완료 표시.
- [ ] `reference/classification_rules.md` §5 추가.
- [ ] PR 4개 (또는 통합 1개) 머지 후 `workflow_dispatch`로 1회 수동 트리거 → 다음 cron 리포트 정상.
