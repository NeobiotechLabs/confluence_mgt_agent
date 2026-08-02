# 작업 15 — 4-PR 분할 가이드

> 작업 15(탈락 후보 판정)는 12개 커밋으로 구성됨. 리뷰 부담을 줄이고 점진적 출시를 위해 4개의 PR로 분할함.
> **이 문서는 PR을 실제로 만드는 절차를 기술하며, 머지 순서는 반드시 PR1 → PR2 → PR3 → PR4를 따른다.**

---

## 0. 사전 조건

- 작업 15 코드(`085a7c1` 이후)는 `main`에 직선 12커밋으로 쌓여 있음.
- 모든 커밋은 `feat/fix/test/docs` 타입 + 작업 15 표기. squash 대상 아님(rebase 머지 권장).
- 각 PR 머지 직후 `main`에서 `npm test` 1회 실행 권장(§7-2 기대값: 302/304 PASS + 2 RED — `tests/report/orchestrator_llm_wire.test.js`의 작업 15 무관 baseline RED).

---

## 1. 커밋 매핑 (12 커밋 → 4 PR)

| PR | Task | 커밋 | 의존 | 핵심 변경 |
|---|---|---|---|---|
| **PR 1** | Task 1, 2, 3 | `0a17e05` / `11740d8` / `57afcd9` / `9979d0a` / `17922f5` | (없음, 첫 머지) | 가치 평가 모듈(`value_prompt` + `migration_value` + `llm_api` 확장) |
| **PR 2** | Task 4 | `372f88a` / `a2cb18a` | PR 1 | dropped_cache SSOT + trailing newline |
| **PR 3** | Task 5, 6, 7 | `0e24a6e` / `3dea841` / `3dc1a44` / `af12dfd` | PR 1, PR 2 | RED 강화 → 5-status runMigrate → render 5-group |
| **PR 4** | Task 8, 9 | `823ce30` | PR 1, PR 2, PR 3 | 운영 CLI + 문서 동기화 |

> **분할 이유**: PR 1 = "도구 스키마 + LLM wiring"(외부 의존 없음). PR 2 = "SSOT 캐시"(PR 1의 가치 평가 함수를 호출하지만 인터페이스만 의존). PR 3 = "통합 + 렌더"(PR 1·2에 의존). PR 4 = "운영 마무리"(전체 의존).
> PR 4는 단일 커밋(`823ce30`)이지만 독립 운영 스크립트만 변경하므로 의존 PR을 모두 머지한 뒤 안전.

---

## 2. PR 1 — 가치 평가 모듈 (Task 1, 2, 3)

**브랜치**: `feature/migration-dropout-pr1`

```bash
git checkout main
git pull
git checkout -b feature/migration-dropout-pr1
```

**포함 커밋** (5):
- `0a17e05` — `feat(value_prompt): 이관 가치 평가 도구 스키마 + 빌더 (작업 15)`
- `11740d8` — `feat(migration_value): LLM 가치 평가 단계 추가 (작업 15)`
- `57afcd9` — `fix(migration_value): add trailing newlines to satisfy POSIX`
- `9979d0a` — `feat(llm_api): callLLMForMigrationValue 추가 (작업 15)`
- `17922f5` — `fix(llm_api): restore callLLM signature + self-contained callLLMForMigrationValue (작업 15 Fix 1)`

> **Fix 1 커밋(`17922f5`)은 PR 1에 포함**: PR 1 직전 main에 머지되면 `callLLM` 시그니처 호환성 깨짐 → 동일 PR에 묶어 단일 atomic 변경으로 다룸.

**머지 명령**:
```bash
git push -u origin feature/migration-dropout-pr1
gh pr create --base main \
  --title "feat(작업 15 PR1): 가치 평가 모듈 (value_prompt + migration_value + llm_api 확장)" \
  --body "스펙: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md
- §5-2 value_prompt: select_migration_value tool schema + 빌더
- §5-1 migration_value: LLM 가치 평가 단계 + throw 흡수 보수 fallback
- §5-3 llm_api: callLLMForMigrationValue 추가 (호환 보존 Fix 1 동봉)
테스트: 22건 신규 (Task 1: 7건 + Task 2: 8건 + Task 3: 5건 + Fix 1: 2건)"
```

**머지 후 정리**:
```bash
git checkout main && git pull
npm test   # 269/271 + 2 RED baseline (작업 15 무관) 확인
git branch -D feature/migration-dropout-pr1
```

---

## 3. PR 2 — dropped_cache SSOT (Task 4)

**브랜치**: `feature/migration-dropout-pr2`

```bash
git checkout main && git pull
git checkout -b feature/migration-dropout-pr2
```

**포함 커밋** (2):
- `372f88a` — `feat(dropped_cache): 이관 탈락 SSOT + consult/merge/hashFor (작업 15)`
- `a2cb18a` — `fix(dropped_cache): add trailing newlines to satisfy POSIX`

**머지 명령**:
```bash
git push -u origin feature/migration-dropout-pr2
gh pr create --base main \
  --title "feat(작업 15 PR2): dropped_cache SSOT (consult/merge/hashFor + trailing newline)" \
  --body "스펙: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md
- §5-4 dropped_cache: pageId+hash 키, 7일 자동 재평가, reference/dropped_pages.json
- §5-4 trailing newline 보존 (POSIX 정합)
- PR 1 의존: migration_value의 verdict=dropped 분기를 cache로 흘림
테스트: 14건 신규 (Task 4)"
```

**머지 후 정리**:
```bash
git checkout main && git pull
npm test   # 283/285 + 2 RED baseline 확인
git branch -D feature/migration-dropout-pr2
```

---

## 4. PR 3 — 5-status 통합 + render 5-group (Task 5, 6, 7)

**브랜치**: `feature/migration-dropout-pr3`

```bash
git checkout main && git pull
git checkout -b feature/migration-dropout-pr3
```

**포함 커밋** (4):
- `0e24a6e` — `test(run_migrate): 작업 15 RED — dropout 5-status 분기 테스트 추가`
- `3dea841` — `test(run_migrate): 작업 15 RED — assert 강화 (callCount/lastSeen/dryRun status)`
- `3dc1a44` — `feat(migrator): 5-status 분기 + dropped 캐시 통합 (작업 15)`
- `af12dfd` — `feat(render): §2 5-group + dropped/unclassified 컬럼 (작업 15)`

> **커밋 순서가 의도**: RED(test) → RED(test 강화) → GREEN(migrator) → GREEN(render). TDD 순서대로.

**머지 명령**:
```bash
git push -u origin feature/migration-dropout-pr3
gh pr create --base main \
  --title "feat(작업 15 PR3): runMigrate 5-status + render §2 5-group" \
  --body "스펙: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md
- §5-5 migrator: runMigrate에 consultDroppedCache + mergeDroppedCache 통합
- §5-6 render: §2 부록 5-group 표 (신규/동기화/미분류/드롭/실패)
- §6 deps 주입: runMigrate deps 키 6개 + §8 chain-fail 강제 unclassified
- §10 변경 파일 요약: scripts/migrator.js, scripts/report/render.js
PR 1·2 의존: migration_value.verdict + dropped_cache interface
테스트: 16건 신규 (Task 5: 6건 + Task 7: 6건 + Task 6 통합 4건)"
```

**머지 후 정리**:
```bash
git checkout main && git pull
npm test   # 299/301 + 2 RED baseline 확인
git branch -D feature/migration-dropout-pr3
```

---

## 5. PR 4 — 운영 CLI + 문서 (Task 8, 9)

**브랜치**: `feature/migration-dropout-pr4`

```bash
git checkout main && git pull
git checkout -b feature/migration-dropout-pr4
```

**포함 커밋** (1):
- `823ce30` — `docs(ops): 작업 15 — 운영 CLI + 문서 동기화`

**머지 명령**:
```bash
git push -u origin feature/migration-dropout-pr4
gh pr create --base main \
  --title "docs(작업 15 PR4): 운영 CLI (list_dropped) + 문서 동기화" \
  --body "스펙: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md
- §7 운영 스크립트: scripts/list_dropped.js + npm run migration:dropped:list
- §10 변경 파일 요약 갱신: reference/ToDo.md, docs/AUTOMATION_GUIDE.md, docs/HANDOFF.md, docs/STATUS.md
- §11 위험: trailing newline 보존, npm test는 PR1-3과 동일 baseline 유지
PR 1·2·3 의존: dropped_pages.json SSOT는 PR 2, render 5-group은 PR 3에서 머지됨
테스트: 신규 0건 (회귀 가드만, tests/migrator/no_dify_stale_log.test.js로 Dify 잔재 차단)"
```

**머지 후 정리**:
```bash
git checkout main && git pull
npm test   # 302/304 + 2 RED baseline 확인
git branch -D feature/migration-dropout-pr4
git log --oneline -10   # 머지 커밋 4개 확인
```

---

## 6. 머지 후 workflow_dispatch 1회 수동 트리거

> **이 단계는 사용자(환경 소유자)가 수동으로 실행함**. 본 자동화에서는 호출하지 않음.

```bash
gh workflow run confluence_automation.yml
```

기대 동작:
- `daily-report` 1 job 정상 실행.
- 다음 cron 리포트에서 §2 5-group 표에 `dropped` / `unclassified` 컬럼이 보임.
- `dropped_pages.json`이 비어 있으면 헤더만, 항목이 있으면 D-N 재평가일이 표시됨.

---

## 7. 검증 체크리스트 (각 PR 머지 직후)

### 7-1. dry-run 무결성

```bash
npm run report:aa:dryrun  # 5-group 표 렌더 확인
node scripts/list_dropped.js  # "(no dropped entries)" 또는 JSON dump
```

> 주의: `npm run ci:local:dryrun`은 `package.json`의 echo 메시지에 따옴표 미처리 `()`가 있어 **sh 파싱 에러** 발생. 이건 작업 15와 무관한 기존 버그. `node scripts/report_aa_daily.js --dry-run` 직접 호출로 우회 가능. 본 작업 PR에서는 fix하지 않음(별도 maintenance 이슈 권장).

### 7-2. 테스트 카운트 기대값

| PR 머지 후 | 전체 | PASS | RED | RED 위치 |
|---|---|---|---|---|
| main (작업 15 시작 전) | 250 | 250 | 0 | — |
| PR 1 | 271 | 269 | 2 | `tests/report/orchestrator_llm_wire.test.js` |
| PR 2 | 285 | 283 | 2 | (동상) |
| PR 3 | 301 | 299 | 2 | (동상) |
| PR 4 | 304 | 302 | 2 | (동상) |

> RED 2건은 작업 15과 **무관**한 baseline(`orchestrator_llm_wire.test.js`의 rate-limit 절감 / confidence 합산 로직). 의도적으로 보존됨.

### 7-3. 회귀 가드

```bash
node --test tests/migrator/no_dify_stale_log.test.js
# 기대: 2/2 PASS — Dify 잔재 회귀 가드 정상
```

---

## 8. 변경 파일 요약 (4 PR 통합)

| 카테고리 | 파일 | PR |
|---|---|---|
| **신규 모듈** | `scripts/utils/value_prompt.js` | 1 |
| | `scripts/utils/migration_value.js` | 1 |
| | `scripts/migrator/dropped_cache.js` | 2 |
| | `scripts/list_dropped.js` | 4 |
| **확장** | `scripts/utils/llm_api.js` (`callLLMForMigrationValue` 추가 + 시그니처 복원) | 1 |
| | `scripts/migrator.js` (5-status 분기 + dropped_cache 통합) | 3 |
| | `scripts/report/render.js` (§2 5-group + dropped/unclassified 컬럼) | 3 |
| | `package.json` (`migration:dropped:list` 스크립트 추가) | 4 |
| **문서** | `reference/ToDo.md` (작업 15 완료 표시 + §5 작업 항목) | 4 |
| | `docs/AUTOMATION_GUIDE.md` (운영 CLI 추가) | 4 |
| | `docs/HANDOFF.md` (핸드오프 갱신) | 4 |
| | `docs/STATUS.md` (현 상태 갱신) | 4 |
| **테스트 (신규 50건)** | `tests/utils/value_prompt.test.js` (7건) | 1 |
| | `tests/utils/migration_value.test.js` (8건) | 1 |
| | `tests/utils/llm_api_migration_value.test.js` (5건) | 1 |
| | `tests/utils/dropped_cache.test.js` (14건) | 2 |
| | `tests/migrator/run_migrate_dropout.test.js` (6건 + 강화 4건 = 10건) | 3 |
| | `tests/report/render_migration_dropout.test.js` (6건) | 3 |
| **회귀 가드** | `tests/migrator/no_dify_stale_log.test.js` (기존 2건) | (전 PR 공통) |

---

## 9. 위험 및 롤백

| 위험 | 완화 | 롤백 |
|---|---|---|
| `callLLM` 시그니처 변경으로 기존 caller 깨짐 | `17922f5`에서 self-contained `callLLMForMigrationValue`로 분리 | PR 1 revert |
| `dropped_pages.json` 부재 시 migrator fail | `dropped_cache.loadOrInit`이 빈 객체 반환 | PR 2 revert |
| render 5-group 표 깨짐 (data shape 변경) | PR 3 RED 10건이 shape를 lock | PR 3 revert |
| 운영자가 `migration:dropped:list` 입력 실수 | CLI 자체는 read-only, 파일 직접 수정 차단 X | (해당 없음) |

---

## 10. 완료 기준 (재확인)

- [x] `npm test` 302/304 PASS + 2 RED baseline
- [x] `node --test tests/migrator/no_dify_stale_log.test.js` 2/2 PASS
- [x] `node scripts/list_dropped.js` 정상
- [x] `npm run report:aa:dryrun` 정상 (5-group 렌더)
- [x] `node scripts/report_aa_daily.js --dry-run` 정상
- [ ] PR 4개 main 머지 (사용자 액션)
- [ ] `workflow_dispatch` 1회 수동 트리거 (사용자 액션)