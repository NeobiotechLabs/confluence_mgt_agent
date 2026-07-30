# 프로젝트 할일 / 진행 상황 (ToDo)

> 마지막 갱신: 2026-07-30
>
> 이 문서는 **현재 정책과 상태**를 기준으로 작성되었습니다. 옛 정책(Dify, human 큐, v1 폴더 규칙 등)은 더 이상 사실이 아니므로 이 문서에 남아 있지 않습니다.

---

## 0. 한 줄 요약

- **목표**: 사내 Confluence 신규 스페이스(AA)를 잘 구조화해서, MPS(Planning/Evaluation) 작성용 RAG 원천으로 유지.
- **현재 상태**: AA 스페이스 이관 + 일일 자동 리포트 + 자가 정화(audit·reorganize) 동작 중. 분류 체인은 **rule → inline-llm(Anthropic) → fallback** 단일 흐름으로 단순화 완료.
- **다음 큰 작업**: 분류 체인의 워크플로우 YAML 재편(작업 4) + 룰 변경 자동화(작업 5).

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

---

## 4. 진행 중 / 다음 작업

### 작업 4 — 워크플로우 YAML 재편 (다음 우선)
- `.github/workflows/confluence_automation.yml`을 `migrator`(수집/이관) + `daily-report`(자가 정화 + 리포트) 두 job으로 정리.
- 각 job에 `ANTHROPIC_API_KEY` env 주입 확인.
- `CLASSIFICATION_PROVIDER` env 분기는 불필요(체인 단일화로 단순화).

### 작업 5 — 룰 업데이트 자동화
- 일별 cron(`daily-report`)이 자동으로 룰 변경을 흡수하므로 별도 batch 워크플로우는 **선택 사항**.
- 필요 시: 룰 해시(`config/analysis_rules.json` sha256)가 전날과 다르면 자동으로 dry-run 리포트에 §5 알림 추가.

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
