# CLAUDE.md

Claude Code(`claude.ai/code`)가 이 저장소에서 작업할 때 읽는 안내 문서. **현재 정책과 코드 사실**을 기준으로 작성되었으며, 새 세션/새 PC에서 이 문서와 `reference/ToDo.md`만 보면 진행 상황과 다음 작업을 이어받을 수 있다.

---

## 1. 저장소 개요

| 항목 | 값 |
|---|---|
| 저장소명 | `confluence_mgt_agent` |
| 원격 | `git@github.com:NeobiotechLabs/confluence_mgt_agent.git` |
| 목적 | 사내 Confluence 스페이스(SD → AA) 자동화 관리 + MPS 워크플로우용 RAG 원천 유지 |
| 현재 메인 스페이스 | AA (덴탈AI연구소 Archive) — 이관·자가 정화·일일 리포트가 운용 중 |
| 참조 스페이스 | SD (Digital R&D Center) — 1회성 분석 완료, 이관 소스 |

진행 상황·다음 작업: [`reference/ToDo.md`](reference/ToDo.md)
분류 체인·룰 정책: [`reference/classification_rules.md`](reference/classification_rules.md)

---

## 2. 현재 아키텍처 (단일화 완료)

```
(Pages) → human → structural → inline-llm(본문, Anthropic SDK) → fallback(미분류 + LLM 의견 코멘트)
                                                                      ↓
                                            docs/report_aa_daily.js (sin)
                              (() → audit → reorganize → render → POST)
```

- **분류 체인**: [`scripts/utils/classification_provider.js`](scripts/utils/classification_provider.js) 단일 흐름. `human → structural → inline-llm(본문) → fallback(미분류+의견)` (2026-07-31 재설계 — rule 단계 폐기, 판단 기준 SSOT: `reference/classification_guidelines.md`). 호출자(`migrator.js`, `audit_aa_space.js`, `reorganize_aa_space.js`)는 `classifyWithChain(ctx, aaTree)`로만 접근 → 호환성 보존.
- **LLM**: 공식 Anthropic SDK ([`scripts/utils/llm_api.js`](scripts/utils/llm_api.js)). 모델 `claude-haiku-4-5-20251001` (env `ANTHROPIC_MODEL`로 override). `tool_use(select_folder)` 결과를 `{ok, folderId, labels, reason}`으로 정규화. throw 흡수.
- **키 관리**: GitHub Actions Secrets `ANTHROPIC_API_KEY`. **`.env`에 절대 커밋 금지**. 키 부재 시 LLM 단계 skip → fallback.
- **출력 채널**: Confluence 일일 리포트 페이지(AA 스페이스 "자동화 리포트" 폴더). 오늘 리포트 없음 = 장애.
- **자가 정화**: [`scripts/audit_aa_space.js`](scripts/audit_aa_space.js) + [`scripts/reorganize_aa_space.js`](scripts/reorganize_aa_space.js) 모두 `run*({dryRun, deps?})` export → 오케스트레이터([`scripts/report_aa_daily.js`](scripts/report_aa_daily.js))에서 in-process 실행.
- **마이그레이션**: [`scripts/migrator.js`](scripts/migrator.js) 멱등 — `findPageByTitleInAA`로 동명 페이지를 제자리 동기화(본문·배너·첨부·라벨). `runMigrate({dryRun, deps})` export → [`scripts/report_aa_daily.js`](scripts/report_aa_daily.js)에서 in-process 실행(§2 루프 A 부록 통합).
- **사용하지 않음**: Dify 워크플로우, human queue, Auto-PR(`peter-evans/create-pull-request` 제거됨), `scripts/classifiers/claude.js` (호출 경로 없음).

### 2-1. 워크플로우 (`.github/workflows/confluence_automation.yml`)
- **cron**: `'0 0 * * *'` (KST 09:00) → `daily-report` 1 job.
- **`daily-report`**: `node scripts/report_aa_daily.js` (env: `CONFLUENCE_*`, `ANTHROPIC_API_KEY`, `GITHUB_SHA`/`RUN_ID`). 마이그레이션 → 감사 → 재정렬 → 리포트 순차 실행.
- **`permissions`**: `contents: read` (PR 생성 권한 제거).
- **실패 알림**: `notify-failure` job이 `daily-report` 결과에 따라 동작.

### 2-2. 디렉토리
| 경로 | 내용 |
|---|---|
| `scripts/` | CLI 스크립트 (`analyze_sd`, `migrator`, `audit_aa_space`, `reorganize_aa_space`, `clean_aa_space`, `report_aa_daily`, `report/`, `classifiers/`, `utils/`, `setup_aa_space` 등) |
| `scripts/utils/` | `aa_pages.js`, `classification_provider.js`, `llm_api.js`, `migration_utils.js` — 재사용 모듈 |
| `scripts/classifiers/` | `engine.js` (호환 시그니처 위임), `rule.js` (SSOT 룰 matcher) |
| `tests/` | `node:test` 기반. `classifiers/`, `migrator/`, `report/`, `utils/` (총 250 PASS) |
| `docs/` | `AUTOMATION_GUIDE.md`, `HANDOFF.md`, `STATUS.md`, `spec_auto_report.md`, `superpowers/` |
| `reference/` | `ToDo.md`(진행), `classification_rules.md`(체인지 매뉴얼), `SD_space_analysis.md`, `AA_space_design_plan.md`, `PROJECT_STATUS.md`(옛, 참고용) |
| `test_results/` | **로컬 dry-run 산출물 전용** — `aa_report_dryrun_YYYY-MM-DD_HHMM.html` 형식. .gitignore 대상. `reference/`에 dryrun 결과 절대 두지 않음. |
| `config/` | `analysis_rules.json`(SSOT), `migration_candidates.json`, `spaces_config.json` |

---

## 3. 개발 명령어

| 목적 | 명령어 |
|---|---|
| 의존성 설치 | `npm install` |
| 테스트 | `npm test` |
| SD 스페이스 분석(1회성) | `node scripts/analyze_sd.js` |
| **마이그레이션(전체)** | `npm run migrate:all` |
| 마이그레이션(개별) | `npm run migrate:mps` / `migrate:project` / `migrate:tech` / `migrate:guide` / `migrate:report` |
| 감사 | `npm run audit:aa` |
| 자가 정화(dry-run) | `npm run reorganize:aa:dryrun` |
| 자가 정화(실실행) | `npm run reorganize:aa` |
| **일일 리포트(dry-run)** | `npm run report:aa:dryrun` |
| **일일 리포트(실실행)** | `npm run report:aa` |
| LLM 환경 점검 | `npm run check:llm` |
| 로컬 CI 시뮬레이션 | `npm run ci:local:dryrun` |

> 위 스크립트 정의: [`package.json`](package.json).

---

## 4. Confluence API / 외부 시스템

- **인스턴스**: `https://neobiotech.atlassian.net`
- **API 버전**: v2 (페이지) + v1 (라벨, 레거시 호환). 폴더 정보는 v2에서만 정확(ancestors에 포함).
- **인증**: 이메일 + API 토큰 (Basic Auth). GitHub Actions Secrets: `CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`, `ANTHROPIC_API_KEY`.
- **rate limit**: Confluence Cloud 기본 5000 req/h. `report_aa_daily` 1회 실행 ≈ 250-300 req(공유 캐시 후).
- **Dify**: 사용 안 함. 사내 토큰 만료(2026-07-28)와 무관하게 정책상 폐기.

---

## 5. 작업 시 주의사항

- **비밀 정보**: API 토큰, LLM API 키는 절대 커밋 금지. `.env`는 로컬 개발 전용, GitHub Actions는 Secrets/env 주입.
- **대량 작업**: rate limit 고려. `report_aa_daily`는 `aa_pages.js`로 `listAAPages` 1회 공유.
- **스페이스 구조**: AA는 페이지 + 폴더(`is-folder` 라벨) 혼용. 폴더는 최대 3단계 중첩. 리포트 페이지는 `bot-report` + `auto-report` 라벨로 자기 배제.
- **테스트 규약**: `node:test` + `node:assert`. 모든 외부 의존은 deps 주입. 새 코드는 **TDD(RED → GREEN → REFACTOR)**.
- **dry-run 우선**: 새로 만든 변경은 `*:dryrun` 스크립트로 안전 확인 후 실실행. dry-run 산출물은 `test_results/`에만 저장 (`aa_report_dryrun_YYYY-MM-DD_HHMM.html` 형식). `reference/`는 SSOT/문서 전용 — 테스트 결과 두지 않음.

---

## 6. 핸드오프 체크리스트 (다른 PC/세션에서 이어받기)

1. `git pull` 후 `npm install`.
2. `reference/ToDo.md` §0 "한 줄 요약" + §4 "진행 중 / 다음 작업" 확인.
3. `reference/classification_rules.md`에서 체인·룰 의도 확인.
4. `npm test`로 baseline 통과 확인 (현재 56/56).
5. 작업 4(워크플로우 YAML 재편) 또는 작업 5(룰 자동화) 시작.
