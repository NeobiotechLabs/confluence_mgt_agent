# 프로젝트 할일 / 진행 상황 (ToDo)

> 마지막 갱신: 2026-07-30 (작업 5 완료 — 룰 해시 변경 자동 감지)
>
> 이 문서는 **현재 정책과 상태**를 기준으로 작성되었습니다. 옛 정책(Dify, human 큐, v1 폴더 규칙 등)은 더 이상 사실이 아니므로 이 문서에 남아 있지 않습니다.

---

## 0. 한 줄 요약

- **목표**: 사내 Confluence 신규 스페이스(AA)를 잘 구조화해서, MPS(Planning/Evaluation) 작성용 RAG 원천으로 유지.
- **현재 상태**: AA 스페이스 이관 + 일일 자동 리포트 + 자가 정화(audit·reorganize) 동작 중. 분류 체인은 **rule → inline-llm(Anthropic) → fallback** 단일 흐름으로 단순화 완료.
- **다음 큰 작업**: 사내 LLM 엔드포인트 연동(작업 6, 옵션). 룰 변경 자동화(작업 5)는 ✅ 완료 — 직전 리포트 부록의 policyHash와 오늘 hash를 비교해 변경 시 §5 advisory 1줄을 자동으로 추가하는 형태로 이미 동작 중.

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

### 작업 6 — 옵션: 사내 LLM 엔드포인트 연동
- 사내 LLM 게이트웨이(`INTERNAL_LLM_URL` / `INTERNAL_LLM_KEY`)가 도입되면 `scripts/utils/llm_api.js`에 adapter 추가.
- Dify 호환 모드는 불필요(정책상 Dify 미사용).

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
| [`docs/spec_auto_report.md`](../docs/spec_auto_report.md) | 일일 리포트 스펙 (DRAFT v0.2) |
| [`docs/AUTOMATION_GUIDE.md`](../docs/AUTOMATION_GUIDE.md) | 운영 가이드 |
| [`docs/STATUS.md`](../docs/STATUS.md) | 상태 요약(있으면) |
| [`docs/HANDOFF.md`](../docs/HANDOFF.md) | 핸드오프(있으면) |
| [`reference/PROJECT_STATUS.md`](PROJECT_STATUS.md) | 옛 핸드오프(Dify 기반, 2026-06-22) — **참고용, 더 이상 사실 아님** |
