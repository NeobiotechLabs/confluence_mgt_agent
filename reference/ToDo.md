# 프로젝트 할일 / 진행 상황 (ToDo)

> 마지막 갱신: 2026-07-31 (작업 10 — 유틸 스크립트 5종 완료, 작업 11 — LLM 본문 기반 분류 재설계 합의)
>
> 이 문서는 **현재 정책과 상태**를 기준으로 작성되었습니다. 옛 정책(Dify, human 큐, v1 폴더 규칙 등)은 더 이상 사실이 아니므로 이 문서에 남아 있지 않습니다.

---

## 0. 한 줄 요약

- **목표**: 사내 Confluence 신규 스페이스(AA)를 잘 구조화해서, MPS(Planning/Evaluation) 작성용 RAG 원천으로 유지.
- **현재 상태**: AA 스페이스 이관 + 일일 자동 리포트 + 자가 정화(audit·reorganize) 동작 중. 분류 체인은 **rule → inline-llm(Anthropic) → fallback** 단일 흐름으로 단순화 완료. 유틸 스크립트 5종 추가(작업 10). 테스트 185/185 PASS.
- **다음 큰 작업**: **작업 11 — LLM 본문 기반 분류 재설계**. 사용자 합의(2026-07-31): 제목 regex 분류를 폐기하고 **페이지 본문 기반 LLM 분류**로 전환. 새 체인: `human → structural check → LLM(본문) → fallback(미분류 + LLM 의견)`. 자연어 지침 파일이 `analysis_rules.json` regex를 대체. 미분류 페이지에 LLM 의견 첨부 → 사람 검토 → 지침 업데이트 학습 루프. 상세 설계: [`docs/HANDOFF.md`](../docs/HANDOFF.md) §3.
- **사내 LLM 게이트웨이(작업 6)**: 사용자 명시 지시로 **폐기** — "사내 LLM은 현재 관심없어 나중에 필요하면 다시 추가할게". `scripts/utils/llm_api.js`의 공식 Anthropic SDK 경로만 유지.

---

## 1. 아키텍처 — 현재 사실

| 영역 | 현재 |
|---|---|
| 분류 체인 | `rule → inline-llm(Anthropic SDK) → fallback(unsortedFolderId, needs-review)` |
| LLM 모델 | `claude-haiku-4-5-20251001` (env `ANTHROPIC_MODEL`로 override 가능) |
| LLM 키 | GitHub Actions Secrets `ANTHROPIC_API_KEY`. `.env`에는 넣지 않음(워크플로우 env 주입) |
| 출력 채널 | Confluence 일일 리포트 페이지(AA 스페이스 "자동화 리포트" 폴더) |
| Cron | 매일 KST 09:00 — `scripts/report_aa_daily.js` 단일 job |
| 마이그레이션 | `scripts/migrator.js`(멱등 — `findPageByTitleInAA`로 동명 페이지 제자리 동기화) |
| 자가 정화 | `scripts/audit_aa_space.js` + `scripts/reorganize_aa_space.js` |
| 더 이상 사용 안 함 | Dify 워크플로우, human queue, `scripts/classifiers/claude.js`, `scripts/classifiers/human.js` (engine이 위임만 하고 호출 경로 없음) |

상세 의도/배경/변경 절차: [`reference/classification_rules.md`](classification_rules.md).

---

## 2. 주요 npm 명령어

| 목적 | 명령어 |
|---|---|
| 스페이스 분석(SD 일회성) | `node scripts/analyze_sd.js` |
| 마이그레이션 | `npm run migrate:all` (또는 `migrate:mps` / `migrate:project` / `migrate:tech` / `migrate:guide` / `migrate:report`) |
| 자가 정화(dry-run) | `npm run reorganize:aa:dryrun` |
| 자가 정화(실실행) | `npm run reorganize:aa` |
| 감사 | `npm run audit:aa` |
| **일일 리포트(dry-run)** | `npm run report:aa:dryrun` |
| **일일 리포트(실실행)** | `npm run report:aa` |
| 로컬 CI 시뮬레이션 | `npm run ci:local:dryrun` |
| LLM 환경 점검 | `npm run check:llm` |
| AA 디렉토리 트리 | `npm run tree:aa` |
| AA 스냅샷 + diff | `npm run snapshot:aa` |
| 원본 작성일 기준 일괄 삭제 | `node scripts/delete_aa_before.js --before=YYYY-MM-DD --dry-run` |
| 이관 누락 탐색 | `npm run find:unmigrated --space=SD --from=2025-01-01 --dry-run` |
| 테스트 | `npm test` |

---

## 3. 완료된 작업 (체크리스트)

### 3-1. 일일 자동 리포트 (Phase 1) — 2026-07-29
- 스펙: [`docs/spec_auto_report.md`](../docs/spec_auto_report.md) (DRAFT v0.2), 운영: [`docs/AUTOMATION_GUIDE.md`](../docs/AUTOMATION_GUIDE.md)
- 심박 신호: 매일 KST 09:00 cron이 AA 스페이스 "자동화 리포트" 폴더에 리포트 1장을 **반드시** 생성. audit/reorganize 실패해도 POST는 실행. "오늘 리포트 없음 = 장애".
- Auto-PR 제거: `peter-evans/create-pull-request` 삭제, 워크플로우 `permissions: contents: read`로 축소. `audit-aa`+`reorganize-aa` 2 job → `daily-report` 1 job 통합.
- 리포트 구성: 헤더 / §1 요약 계수(전일 delta) / §3 루프 B 이동 로그 / §5 조건부 관리자 알림 / §6 실행 메타 / §7 기계 부록(JSON).
- 보관: 31일 초과분 매일 자동 삭제(최근 7개 무조건 보존).
- 버그 수정:
  - `stampLastParent`의 stale `last-parent-*` 라벨 누적 제거
  - reorganize dry-run 카운트 오표시 해소
  - audit 최상위 고아 계수에서 `is-folder` 제외
  - **스페이스 홈페이지**(parentId=null) 자동 이동 대상 오분류 수정 — 회귀 테스트 3건 추가
- 테스트: `tests/report/` 4종 추가, `npm test` 56/56 PASS(현재).

### 3-2. 마이그레이션 v2 + 멱등성 — 2026-07-29
- `migrate_to_aa_space.js` v2 스크립트로 재이관 진행 중.
- 해결된 문제:
  1. SD→AA 계층 구조 미이동 → 폴더명에 연도 포함(`25 연구소`, `26 연구소` 등)하여 제목 유일성 확보.
  2. 라벨 정규화(`group-center` ↔ `team-center`) → 콜론 제외·하이픈 사용.
  3. 첨부(이미지/영상) 미리보기 누락 → 최신 REST API로 이미지만 다운로드·업로드, 영상은 원본 페이지 참조 배너.
- 멱등성: `migrator.js`에 `findPageByTitleInAA` 추가 → AA에 이미 존재하는 페이지는 **제자리 덮어쓰기 동기화**(본문·배너·첨부·라벨 갱신). 폴더 이동은 audit/reorganize 담당.

### 3-3. 분류 체인 단일화 — 2026-07-30
- `scripts/utils/llm_api.js`: 공식 Anthropic SDK wrapper. `tool_use(select_folder)` 결과를 `{ok, folderId, labels, reason}`으로 정규화. 실패는 throw하지 않고 `{ok:false, source:'miss'}`로 흡수.
- `scripts/utils/classification_provider.js`: **rule → inline-llm → fallback** 체인. `ANTHROPIC_API_KEY` 부재 시 LLM 단계 skip.
- `scripts/classifiers/engine.js`: 신규 provider에 위임. 기존 `classifyWithChain(ctx, aaTree)` 시그니처 유지 → migrator.js·audit_aa_space.js 호환성 보존.
- human/claude/dify 단계는 정책상 제거.
- 문서: [`reference/classification_rules.md`](classification_rules.md).
- 테스트: 56/56 PASS(`tests/utils/llm_api.test.js` 4건 + `tests/utils/classification_provider.test.js` 6건 + `tests/classifiers/engine.test.js` 2건 추가).

### 3-4. 룰 해시 변경 자동 감지 (작업 5) — 2026-07-30
- 일별 cron(`daily-report`)이 룰 변경을 흡수하므로 별도 batch 워크플로우 불필요.
- `policyHash()`(`config/classification_decisions.json` + `config/analysis_rules.json` sha256 앞 8자)의 변동을 직전 리포트 부록의 `policyHash`와 비교.
- `detectRuleChange(prev, curr, today)` → prev 없음(첫 리포트)·해시 동일 → `null`, 상이 시 `⚠️ 룰 변경 감지: … → … (YYYY-MM-DD)` advisory 1줄 → §5 자동 렌더.
- 변경 파일: `scripts/report/report_lib.js`, `scripts/report_aa_daily.js`, `tests/report/report_lib.test.js`.
- 테스트: 62/62 PASS(신규 4건 추가).

### 3-5. 옛 Dify KB 통합 + 경로 정리 (작업 7) — 2026-07-30
- 사용자 의도: "옛 Dify 자산을 정리하고, 분류 프롬프트가 재사용 가능한지 확인".
- 결정:
  - `reference/aa_space_dify_knowledge.md` **삭제**(AA 전용 옛 KB, 사용자 명시 지시).
  - `dify/space_rules_knowledge.md` → `reference/space_rules_knowledge.md`로 **승격 + 재작성**. `§0 [전역(Global) Common Rule]` + `§1~4 [SD/WND/Device/SmileArch] 섹션 룰` 구조로 통일. status 헤더에 `reference-only` 명시(SSOT는 `config/analysis_rules.json`).
  - `dify/system_prompt.md`는 **보존**(사용자 선택) + status 헤더 주석 추가(`status: deprecated-for-dify`, 옛 KB 위치 표기). 본 파일은 Dify 컨테이너 의존이라 코드 자동화에 그대로 이식하지는 않음.
- 코드/문서 갱신:
  - `config/analysis_rules.json` `$description`: 정책 출처 표기를 옛 `dify/` → 새 `reference/space_rules_knowledge.md`로.
  - `reference/migration_candidates.md` L104: 관련 정책 링크를 `reference/classification_rules.md · reference/space_rules_knowledge.md`로.
  - `scripts/`: 옛 `dify/` 경로 참조 0건(작업 4에서 이미 모두 갱신 완료).
- 의도적 보존 4건: `reference/ToDo.md`(작업 4 이력), `reference/PROJECT_STATUS.md`(옛 핸드오프), `docs/spec_auto_report.md`(옛 시점 디자인 스펙), `reference/space_rules_knowledge.md` 헤더(옛 위치 표기), `dify/system_prompt.md`(옛 KB 위치 표기).
- 테스트: 변경 없음(문서·정책 표기 작업이라 회귀 위험 0). `npm test` 62/62 PASS 유지.

### 3-6. 룰 매칭 추적/누락 가시화 (작업 8) — 2026-07-30
- **문제**: 오늘 룰로 매칭되지 않아 `catch_all_known`(`needs-review`)으로 흡수된 페이지가 *왜* 누락됐는지 추적하기 어렵다. 새 룰을 추가할 때 데이터 기반 결정이 어려움.
- **방침**: 일별 cron이 흡수만 하고 끝나면 "룰이 모른다"는 신호가 묻힌다. 부록에 `kind:'unmatched'`로 노출해 사람이 후속 룰을 추가할 수 있게 한다.
- **구현**:
  - `scripts/report/report_lib.js`:
    - `matchAgainstKnowledgeBase({title, ancestors}, kb)` — rules를 순회하며 `match.title_patterns`(정규식)와 `match.ancestor_contains` 평가. `is_catch_all` 룰은 매칭 성공으로 보고하되 `categoryId='catch_all_known'`으로 표기. 명시 매칭 실패 → `null`.
    - `findUnmatchedPages(cur, prev, todayStr)` — `fingerprint = sha1('unmatched', pageId, unsortedFolderId)[:12]` 단위로 seenCount/첫관측일자 보존. prev에 같은 fingerprint 있으면 seenCount+1·firstSeen 보존·lastSeen 갱신, 없으면 seenCount=1·firstSeen=lastSeen=today. prev에만 있고 오늘 없으면 부록엔 안 들어가지만 SSOT엔 남음.
  - `scripts/report/unmatched_state_io.js`:
    - `loadUnmatchedState(file)` — `reference/unmatched_pages.json` 로더. 파일 부재/깨짐/스키마 위반 모두 `[]`로 graceful 퇴화(절대 throw 안 함).
    - `saveUnmatchedState(file, items)` — 원자적 쓰기(`.tmp` → `rename`). 부모 디렉터리 자동 생성.
  - `scripts/report_aa_daily.js`:
    - `computeUnmatchedItems(pages, kb, todayStr, {unsortedFolderId, prevState})` — `pages.filter(parentId===unsortedFolderId)` → KB 매칭 시도 → `null`(진짜 미매칭) 또는 `catch_all_known`(명시 매칭 실패 + 흡수) 모두 `kind:'unmatched'`로 부록 진입. 명시 카테고리 매칭은 정상이라 건너뜀.
    - `runUnmatchedMerge({kbPath, statePath, pages, todayStr, unsortedFolderId, dryRun})` — 통합 헬퍼. KB 로드(부재·깨짐 모두 graceful, kbError=null) → prev 로드 → compute → 실실행이면 save. **save 실패는 throw하지 않고 `saveError` 문자열로 호출자에 전달** → 부록 advisories에 머지 → 리포트 POST는 계속(심박 P1).
    - main() §8-1 와이어업: `KB_PATH = config/analysis_rules.json`, `UNMATCHED_STATE_PATH = reference/unmatched_pages.json`. 부록 `items[]`에 `movedItems.concat(merge.items)` — `move-b`와 `unmatched` 공존, 렌더 측은 `kind`로 분기.
    - dry-run stdout에 `unmatchedItems` 카운트 추가.
  - `reference/classification_rules.md`: §5 "매칭 실패 추적 (작업 8)" 신설, §6 변경 절차 표에 "미매칭 룰 추가" 행 추가.
- **누락 가시화 → 룰 추가 흐름**: 운영자가 매일 부록을 보고 `캘리브레이션 회의록` 류가 반복되면 → `config/analysis_rules.json`에 명시 룰 추가 → 다음 cron부터 자동 흡수 → `unmatched` 카운트 감소.
- **테스트(TDD)**: 22건 신규 추가.
  - `tests/report/match_kb.test.js` 4건 — 빈 KB / 전부 매칭 / 일부 누락 / catch_all 단독.
  - `tests/report/unmatched_wireup.test.js` 8건 — `computeUnmatchedItems` 시그니처·catch_all 흡수·unknown·prevState 머지·prevState mutate 금지.
  - `tests/report/unmatched_state_io.test.js` 8건 — `loadUnmatchedState`/`saveUnmatchedState` graceful + 원자성 + 스키마 필터.
  - `tests/report/orchestrator_unmatched.test.js` 6건 — `runUnmatchedMerge` 통합(KB 정상/부재/깨짐/dryRun/prev 머지/unsortedFolderId 불일치).
  - **`npm test` 93/93 PASS**.
- **변경 파일**: `scripts/report/report_lib.js`, `scripts/report/unmatched_state_io.js`(신규), `scripts/report_aa_daily.js`, `reference/classification_rules.md`, 4건 신규 테스트.
- **SSOT 신규**: `reference/unmatched_pages.json`(append-only, 원자적 쓰기).

### 3-7. 유틸 스크립트 5종 (작업 10) — 2026-07-31
- **사용자 요청**: "AA 운영에 필요한 유틸성 스크립트 5개 만들어줘".
- **구현 (TDD, 33건 신규 테스트)**:
  1. `scripts/tree_aa.js` — AA 디렉토리 트리 뷰. `formatTreeWithCounts(tree, pages)` + `buildFolderPageCounts(pages)`. 📁 폴더 (페이지 수) 포맷 + orphan + total. `npm run tree:aa`.
  2. `scripts/snapshot_aa_tree.js` — 로컬 디렉토리 맵 스냅샷 + diff. `buildSnapshot(folders, pages, capturedAt)` → `reference/aa_tree_snapshot.json` 저장, 이전 스냅샷과 자동 diff (`computeSnapshotDiff`, `formatDiff`). `npm run snapshot:aa`.
  3. `scripts/delete_aa_before.js` — 원본 작성일 기준 AA 페이지 일괄 삭제. `extractOriginalDate(html)` (배너 regex: "원본 작성일" > "원본 최종수정일", `\s*` 유연 매칭) + Confluence `createdAt` fallback. `filterDeleteCandidates(pages, dateMap, beforeDate)` 보호 라벨 제외. `--dry-run` 지원.
  4. `scripts/find_unmigrated.js` — 소스 스페이스에서 이관 누락 페이지 탐색. `filterByDateRange(pages, from, to)` + `findUnmigratedPages(sourcePages, aaTitles)` 제목 기반 교차 대조. `--space=SD --from=YYYY-MM-DD --dry-run`.
  5. `scripts/report_aa_daily.js` (수정) — dry-run 시 `reference/aa_report_dryrun.html` 파일 저장.
- **날짜 추출 수정**: 33/174 → 174/174. 원인: (a) 배너 없는 페이지에 Confluence createdAt fallback, (b) "원본 최종수정일" 공백 없는 변형에 `\s*` 매칭.
- **USER_GUIDE.md 갱신**: §3.6 유틸 스크립트 섹션 신설, §1.6·§2.2·§3.3·§5.1 수정.
- **package.json**: `tree:aa`, `snapshot:aa`, `delete:aa:before`, `delete:aa:before:dryrun`, `find:unmigrated`, `find:unmigrated:sd` 추가.
- **테스트**: `tests/utils/` 4종 (tree_aa 8건, snapshot_aa_tree 7건, delete_aa_before 11건, find_unmigrated 7건). **`npm test` 185/185 PASS**.
- **미커밋**: 5개 파일 변경 + 1개 신규(aa_report_dryrun.html, 산출물).

---

## 4. 진행 중 / 다음 작업

### 작업 4 — 워크플로우 YAML 재편 — ✅ 2026-07-30 완료
- `.github/workflows/confluence_automation.yml`은 이미 의도된 형태(`daily-report` 1 job + `migrate` 후속 + `notify-failure`(`if: failure()`))). 두 job에 `ANTHROPIC_API_KEY` Secrets 주입 확인, `permissions: contents: read` 유지. `CLASSIFICATION_PROVIDER` env 분기는 코드·YAML 어디에도 없음(체인 단일화로 단순화).
- 정리한 코드 잔재: `scripts/migrator.js`의 `Dify LLM 분석` 로그 및 `Dify-like` 주석을 정책에 맞춰 일반화(consonID 보관), `scripts/analyze_migration_candidates.js`의 본문 링크 `dify/space_rules_knowledge.md` → `reference/classification_rules.md`로 교체.
- 회귀 가드: `tests/migrator/no_dify_stale_log.test.js` 2건 추가(`console.log` / 주석 `Dify-like` 잔재 차단). `npm test` 58/58 PASS.

### 작업 5 — 룰 업데이트 자동화 — ✅ 2026-07-30 완료 (해시 diff 감지만 구현)
- **선택 범위**: 별도 batch 워크플로우·추가 알림 채널·Git SHA 표기·PR 권고 모두 제외. 사용자 선택: *"해시 diff 감지만 구현 (Recommended)"*.
- **구현**:
  - `scripts/report/report_lib.js`: 순수 함수 `detectRuleChange(prevHash, currHash, todayStr)` — prev 없음(첫 리포트)·curr 없음(방어)·해시 동일 → 모두 `null`. 상이 시 `⚠️ 룰 변경 감지: {prev} → {curr} ({today})` advisory 문자열 반환. export 추가.
  - `scripts/report_aa_daily.js`: 직전 리포트 부록 `prev?.policyHash`(L183)와 오늘 `policyHash()`(L128) 비교. `runAt.slice(0, 10)`을 todayStr로 전달. 변경 감지 시 `advisories.push(ruleAdvisory)` → 기존 §5 advisory 섹션이 그대로 렌더.
  - `tests/report/report_lib.test.js`: 4건 추가 (prev null / 동일 / 상이 / curr null).
- **회귀 가드**: 직전 부록 파싱 실패(사람 편집) → `prev=null` → 자동으로 첫 리포트 분기로 진입해 advisory 발생 안 함. 운영·advisory 누락 위험 0.
- **효과**: 룰 해시(`classification_decisions.json` + `analysis_rules.json`) 변동 시 다음 리포트 §5에 1줄 알림이 자동 등장. 별도 트리거 불필요.
- **테스트**: `npm test` 62/62 PASS(신규 4건 + 기존 58건).
- **변경 파일**: `tests/report/report_lib.test.js`, `scripts/report/report_lib.js`, `scripts/report_aa_daily.js`.

### 작업 7 — 옛 Dify KB 통합 + 경로 정리 — ✅ 2026-07-30 완료
- 사용자 명시 지시: "1. 지워줘. 그리고, `@dify/system_prompt.md` 가 dify에서 페이지 분류했던 프롬프트인데, 잘 되어 있는지, 어떤 내용인지 확인해서 우리가 가져다 쓸수 있는 지침일지 확인해줘".
- 완료 항목:
  1. `reference/aa_space_dify_knowledge.md` 삭제(AA 전용 옛 KB).
  2. `dify/space_rules_knowledge.md` → `reference/space_rules_knowledge.md` 승격 + 재작성(common.rule + 4섹션 구조).
  3. `dify/system_prompt.md`에 status: deprecated-for-dify 헤더 주석 추가, 본문은 보존.
  4. `config/analysis_rules.json` $description 갱신, `reference/migration_candidates.md` L104 링크 갱신.
  5. ToDo.md 갱신(본 작업).
- 분석 결과(`dify/system_prompt.md` 45 lines 검토):
  - **재사용 가능 부분**: Validation·Labeling·Output Format 스키마(`is_valid`·`target_folder_id`·`labels`·`needs_new_category`)의 *의도*는 `config/analysis_rules.json` SSOT에 이미 반영됨. 프롬프트 구조(Validation→Labeling→Exception→Output 4섹션)는 향후 §0.3 매칭 워크플로우와 정렬 가능.
  - **이식 불필요**: 프롬프트 본문은 Dify 컨테이너 변수(`{{page_title}}`, `{{#context#}}`, `<context_tree>` 등)에 강하게 결합되어 있어, 공식 Anthropic SDK(`scripts/utils/llm_api.js`)로 직결 시 컨테이너 의존이 늘어남. 자동화는 도구 호출(`tool_use(select_folder)`)이 이미 동일한 정규화(`{ok, folderId, labels, reason}`)를 제공.
- 의도적 보존 4건은 §3-5 본문 참조.

### 작업 8 — 룰 매칭 추적(누락 가시화) — ✅ 2026-07-30 완료
- **문제**: 오늘 룰로 매칭되지 않아 `catch_all_known`(`needs-review`)으로 흡수된 페이지가 *왜* 누락됐는지 추적하기 어렵다. 새 룰을 추가할 때 데이터 기반 결정이 어려움.
- **방침**: 일별 cron이 흡수만 하고 끝나면 "룰이 모른다"는 신호가 묻힌다. 부록에 `kind:'unmatched'`로 노출해 사람이 후속 룰을 추가할 수 있게 한다.
- **구현**:
  - `scripts/report/report_lib.js`: `matchAgainstKnowledgeBase({title, ancestors}, kb)` + `findUnmatchedPages(cur, prev, todayStr)` — fingerprint 단위 seenCount/첫관측일자 보존(append-only 머지).
  - `scripts/report/unmatched_state_io.js`(신규): `loadUnmatchedState`/`saveUnmatchedState` — graceful 로드 + 원자적 쓰기(`.tmp` → `rename`).
  - `scripts/report_aa_daily.js`: `computeUnmatchedItems` + `runUnmatchedMerge` 통합 헬퍼. KB 부재/깨짐 모두 empty fallback, save 실패는 throw 대신 `saveError` 문자열로 advisories에 머지 → 리포트 POST는 계속(심박 P1).
  - main() §8-1 와이어업: `KB_PATH = config/analysis_rules.json`, `UNMATCHED_STATE_PATH = reference/unmatched_pages.json`. 부록 items[]에 `movedItems.concat(merge.items)` — `move-b`와 `unmatched` 공존.
- **SSOT 신규**: `reference/unmatched_pages.json` (append-only 머지, 원자적 쓰기).
- **누락 가시화 → 룰 추가 흐름**: 운영자가 매일 부록을 보고 `캘리브레이션 회의록` 류가 반복되면 → `config/analysis_rules.json`에 명시 룰 추가 → 다음 cron부터 자동 흡수 → `unmatched` 카운트 감소.
- **테스트(TDD)**: 22건 신규 추가. **`npm test` 93/93 PASS**.
- **변경 파일**: `scripts/report/report_lib.js`, `scripts/report/unmatched_state_io.js`(신규), `scripts/report_aa_daily.js`, `reference/classification_rules.md`, 4건 신규 테스트.
- **Phase 2 잔여**: 부록 unmatched 항목의 §2 자리표시(루프 A 실데이터) 해소는 별도 작업.

### 작업 9 — §4 AI 권고판 (Phase 2-A) — 진행 중 (2026-07-30, TDD RED 시작)
- **문제**: Phase 1 리포트는 "오늘 뭐가 일어났다"만 보여준다. 운영자가 *어떤 정책 변화*가 필요한지(예: 페이지가 오배치됨, 같은 제목이 계속 애매하게 분류됨)는 매일 부록을 직접 읽어야 한다. 봇은 실행하지 않고 **사람에게 권고만** 한다.
- **방침 결정 (사용자 2026-07-30)**:
  - 신뢰도 산출 = **키워드 가중치**. LLM `reason` 문자열에서 `'정확히'/'일치'/'유사'/'could be'/'maybe'` 같은 어휘를 점수로 매핑. 결정적이고 테스트 가능. LLM이 일관된 어휘를 쓴다는 전제.
  - seenCount 임계치 = **3회**. 주 5일 cron 기준 3영업일 ≈ 3일. 한 주 안에 결정 안 된 항목 = 진짜 애매 → §4에서 강하게 권고.
- **Phase 2-A 범위 (이번 작업)**:
  1. `scripts/report/report_lib.js`에 `computeConfidenceScore(reason)`, `selectRepeatAmbiguous(items, threshold)`, `recommendMisplacements(pages, history, opts)` 신규.
  2. `scripts/report/render.js`에 `renderAdvisoriesSection(advisories)` (§4 렌더 — 헤드 고정 문구).
  3. `scripts/report_aa_daily.js`에 §4 와이어업. 부록 `advisories[]`에 `kind:'misplacement-suspect'` 형식으로 머지.
- **Phase 2-B (보류, 후속)**: §2 루프 A 실데이터 — `scripts/migrator.js`의 이관 결과를 부록에 첨부하는 어댑터 + render §2 + items 머지.
- **테스트(TDD)**: `tests/report/recommend_misplacements.test.js`, `tests/report/render_advisories.test.js` 신규. 추정 10~14건.
- **다음 작업(작업 10 후보, 보류)**: §2 루프 A 실데이터 활성화, 정책 승격(반복 항목 → 명시 룰 변환 워크플로우).

### 작업 11 — LLM 본문 기반 분류 재설계 — 합의 완료, 구현 미착수 (2026-07-31)
- **문제**: 제목 regex 분류는 작성자가 제목을 어떻게 달지 예측 불가 → 룰 무한 추가 유지보수.
- **사용자 합의**: "아예 내용을 기반으로 LLM이 판단" → 완전 재설계.
- **새 체인**: `human(과거 결정) → structural check → LLM(본문 기반) → fallback(미분류 + LLM 의견)`
- **핵심 변경**:
  - rule 단계 제거 → 자연어 지침 파일(`reference/classification_guidelines.md` 예정)로 대체
  - LLM 입력: `ctx.title`만 → **페이지 본문** (HTML strip + ~2000자 truncation)
  - fallback: `needs-review` → **미분류 폴더 + LLM 의견 첨부**
  - advisory: 키워드 가중치 → **LLM 생성 의미 있는 분석**
  - 학습 루프: 미분류 → 사람 검토 → 이동 → 지침 업데이트 → LLM 개선
- **탐색 완료**: 코드베이스 3개 영역 (분류 체인, 감사·재조직, 리포트·advisory) 에이전트 탐색 완료.
- **구현 계획(TDD)**: [`docs/HANDOFF.md`](../docs/HANDOFF.md) §3-5에 7단계 상세.
- **호환성**: `classifyWithChain(ctx, aaTree)` 시그니처 유지.
- **기타 보류**: 워크플로우 순서 `migrate → daily-report → notify-failure` (합의, 미구현).

---

## 5. 협업 필요 (사용자 액션)

- [ ] `npm run report:aa` 로컬 실실행 → Confluence에 폴더·페이지·라벨·마커 생성 확인
- [ ] 즉시 재실행 → `_2` 접미 제목 + delta/seenCount diff 확인
- [ ] 하위호환: `npm run audit:aa`, `npm run reorganize:aa:dryrun` 정상 동작 확인
- [ ] PR 머지(main 보호) → Actions `workflow_dispatch` 수동 트리거 → 다음 날 cron 리포트로 최종 확인

---

## 6. 참고 문서

| 문서 | 용도 |
|---|---|
| [`reference/SD_space_analysis.md`](SD_space_analysis.md) | 기존 SD 스페이스 분석(1회성 참고) |
| [`reference/AA_space_design_plan.md`](AA_space_design_plan.md) | AA 스페이스 설계 의도 |
| [`reference/classification_rules.md`](classification_rules.md) | 분류 체인 의도·SSOT 경계·변경 절차 |
| [`reference/space_rules_knowledge.md`](space_rules_knowledge.md) | 스페이스별 문서 이관 및 판별 정책(reference-only, 옛 Dify KB 통합본) |
| [`docs/spec_auto_report.md`](../docs/spec_auto_report.md) | 일일 리포트 스펙 (DRAFT v0.2) |
| [`docs/AUTOMATION_GUIDE.md`](../docs/AUTOMATION_GUIDE.md) | 운영 가이드 |
| [`docs/STATUS.md`](../docs/STATUS.md) | 상태 요약(있으면) |
| [`docs/HANDOFF.md`](../docs/HANDOFF.md) | 핸드오프(있으면) |
| [`reference/PROJECT_STATUS.md`](PROJECT_STATUS.md) | 옛 핸드오프(Dify 기반, 2026-06-22) — **참고용, 더 이상 사실 아님** |
