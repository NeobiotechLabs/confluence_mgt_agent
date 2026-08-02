# 세션 인수인계 (Handoff)

> 작성: 2026-07-31 (작업 13-14 완료 + §2 표 개선 + metrics 수정)
> 받는 사람: 다음 세션을 여는 작업자

---

## 0. 컨텍스트 복원 순서 (3분)

1. **`CLAUDE.md`** (저장소 루트) — 프로젝트 개요, 아키텍처, 개발 명령어
2. **`reference/ToDo.md`** — 진행 상황·다음 작업 (가장 중요)
3. **`reference/classification_rules.md`** — 분류 체인 의도·변경 절차
4. **`docs/USER_GUIDE.md`** — 사용자 가이드 (유틸 스크립트 포함 최신)
5. **본 문서 §3** — LLM 분류 재설계 완료 상태 + 남은 보류 작업

---

## 1. 현재 상태 한 줄 요약

AA 스페이스 이관 + 일일 자동 리포트 + 자가 정화(audit·reorganize) **동작 중**.
분류 체인 `human → structural → llm(본문) → fallback(미분류+의견)` 완전 재구현 완료.
자연어 지침(`classification_guidelines.md`)이 `analysis_rules.json` regex를 대체.
§4 AI 권고판을 LLM 생성 분석으로 전환 (운영 데이터 종합 → 구체적 권고 3~5개).
§2 루프 A 외부 이관 결과 부록 통합 (migrator.js → report_aa_daily.js in-process).
워크플로우 단일화 (별도 migrate job 제거, migrate→audit→reorganize→report 단일 프로세스).

- 테스트: **253/253 PASS**
- 미커밋 변경: 없음 (전체 커밋 완료)

---

## 2. 미커밋 변경 사항

없음 — 전체 커밋 완료.

---

## 3. LLM 본문 기반 분류 재설계 — 완료 (2026-07-31)

### 구현 완료 항목

| 파일 | 역할 |
|---|---|
| `scripts/utils/content_extractor.js` | HTML → 평문 본문 (info macro 제외, 2000자 truncation) |
| `scripts/utils/classification_prompt.js` | guidelines 로드, system/user prompt 조립, `select_folder` tool (confidence 포함) |
| `scripts/utils/llm_api.js` | `callLLMForClassification` — 본문 포함, confidence-aware 정규화 |
| `scripts/utils/classification_provider.js` | `human → structural → llm → fallback` 체인 (rule 단계 제거) |
| `scripts/classifiers/engine.js` | 실 Anthropic client + body + guidelines 연결 |
| `scripts/reorganize_aa_space.js` | 재분류 후보만 본문 fetch, 미분류행 LLM 의견 코멘트 첨부 |
| `reference/classification_guidelines.md` | 자연어 지침 SSOT (폴더별 판단 기준 + 라벨 사전) |

### 정리 완료 항목 (이번 세션)

- `audit_aa_space.js` — `ruleClassifier` 의존 제거. `shouldCommitHumanDecision`을 단순화 (rule 호출 제거, always-true).
- `report/report_lib.js` — `policyHash()` CONFIG_FILES에 `../reference/classification_guidelines.md` 추가.

### 남은 보류 작업 (작업 15)

- **작업 15 — 탈락 후보 판정**: LLM이 이관 가치 없는 페이지를 판별해 탈락 사유 표시. `runMigrate` 내 `classifyWithChain` 호출 시 "이관 가치 없음" 옵션 추가 또는 별도 프롬프트.

---

## 4. 이번 세션에서 완료한 작업

### 4-1. 유틸 스크립트 5종 (신규, TDD)

| 스크립트 | 용도 | npm 명령어 |
|---|---|---|
| `scripts/tree_aa.js` | AA 디렉토리 트리 뷰 (폴더별 페이지 수) | `npm run tree:aa` |
| `scripts/snapshot_aa_tree.js` | 로컬 디렉토리 맵 스냅샷 + diff | `npm run snapshot:aa` |
| `scripts/delete_aa_before.js` | 원본 작성일 기준 일괄 삭제 | `node scripts/delete_aa_before.js --before=YYYY-MM-DD --dry-run` |
| `scripts/find_unmigrated.js` | 이관 누락 페이지 탐색 | `npm run find:unmigrated --space=SD --from=2025-01-01 --dry-run` |
| `scripts/report_aa_daily.js` (수정) | dry-run 리포트 파일 저장 | `npm run report:aa:dryrun` → `reference/aa_report_dryrun.html` |

테스트: `tests/utils/` 4종 33건 신규, 총 185건 PASS.

### 4-2. delete_aa_before.js 날짜 추출 수정

- **문제**: 174페이지 중 33페이지만 날짜 추출 성공
- **원인 1**: 대부분 페이지에 이관 배너 없음 → Confluence `createdAt` fallback 추가
- **원인 2**: 배너 텍스트 "원본 최종수정일" (공백 없음) vs regex "원본 최종 수정일" (공백 있음) → `\s*` 유연 매칭
- **수정 후**: 174/174 추출 성공 (173페이지가 2026년 — AA 최근 구축, 정상)

### 4-3. USER_GUIDE.md 갱신

- §1.6 분류 체인 4단계 다이어그램
- §2.2 휴먼 결정 흐름
- §3.3 delete dry-run + 리포트 파일 저장
- §3.6 유틸 스크립트 5종 사용법 (신규 섹션)
- §5.1 명령어 테이블 갱신

### 4-4. LLM 분류 재설계 논의·합의

- 제목 regex 분류의 근본적 한계 논의
- LLM 본문 기반 분류 + 미분류 의견 + 학습 루프 설계 합의
- 코드베이스 탐색 3건 완료 (분류 체인, 감사·재조직, 리포트·advisory)

### 4-5. LLM 분류 재설계 정리 (이번 세션)

- `audit_aa_space.js` — `ruleClassifier` import 및 `shouldCommitHumanDecision` 내 ruleClassifier 호출 제거. `shouldCommitHumanDecision`을 sync 함수로 단순화 (always-true).
- `report/report_lib.js` — `CONFIG_FILES`에 `../reference/classification_guidelines.md` 추가 → guidelines 파일 변동이 policyHash에 반영됨.
- 223/223 테스트 전부 통과 확인.

### 4-6. 외부 이관 결과 부록 통합 (작업 13, TDD)

- `scripts/migrator.js`: `runMigrate({dryRun, deps})` export 추가. 모든 외부 의존 주입 가능. `{items: [{kind:'migrate-a', pageId, title, sourceSpace, targetFolderId, status, classifierSource, reason, ...}]}` 반환. 상태: created/synced/skipped/failed.
- `scripts/report_aa_daily.js`: `runMigrate({dryRun})` 호출 → `migrateResult.items`를 부록 `items[]`에 머지.
- `scripts/report/render.js`: `migrateSection(items)` — §2 표 렌더.
- 테스트: `tests/migrator/run_migrate.test.js` 8건 + `tests/report/render_migrate_a.test.js` 5건 = 13건 신규.

### 4-7. 워크플로우 단일화 (작업 14)

- `.github/workflows/confluence_automation.yml`: 별도 `migrate` job 삭제. `notify-failure` needs를 `daily-report`만 참조.
- 실행 순서: `migrate → audit → reorganize → report` (단일 프로세스).
- 250/250 테스트 전부 통과 확인.

---

## 5. 핵심 코드 사실 (Quick Reference)

### 분류 체인 호출 경로
```
migrator.js ─────┐
audit_aa_space.js ┼─→ classifyWithChain(ctx, aaTree) ─→ classification_provider.js
reorganize_aa_space.js ─┘                                    │
                                        human → structural → llm(본문) → fallback(+의견)
```

### LLM 호출
```javascript
// engine.js가 내부에서 호출:
callLLMForClassification({ client, title, body, treeText, guidelines, model })
// → body는 HTML strip + 2000자 truncation (content_extractor.js)
// → guidelines는 classification_guidelines.md 자연어 지침 (classification_prompt.js)
// → select_folder tool_use → confidence: 'high'|'low'
// → high만 분류 성공, low는 fallback + 의견 보존
// 모델: claude-haiku-4-5-20251001 (env ANTHROPIC_MODEL override)
```

### 보호 라벨
`is-folder`, `bot-report`, `auto-report`, `human-classified`

### 리포트 advisory 시스템
- `advisories[]` mutable 배열 (report_aa_daily.js)
- 문자열 → §4 `<ul>`, `misplacement-suspect` 객체 → §4 `<table>`
- 부록 JSON schema v1: `items[]` kinds: `move-b`, `unmatched`, `misplacement-suspect`, `kb-unknown`

### 주요 파일 위치
| 파일 | 역할 |
|---|---|
| `scripts/utils/content_extractor.js` | HTML → 평문 본문 (strip + truncation) |
| `scripts/utils/classification_prompt.js` | guidelines 로드 + prompt 조립 + select_folder tool |
| `scripts/utils/classification_provider.js` | 분류 체인 (human→structural→llm→fallback) |
| `scripts/utils/llm_api.js` | Anthropic SDK wrapper + callLLMForClassification |
| `scripts/classifiers/engine.js` | classifyWithChain 시그니처 adapter (client 생성 포함) |
| `scripts/classifiers/rule.js` | 룰 matcher (audit 휴리스틱 + report unmatched 추적 전용, 분류 체인 미사용) |
| `scripts/audit_aa_space.js` | 감사 + 휴먼 이동 감지 (ruleClassifier 의존 제거됨) |
| `scripts/reorganize_aa_space.js` | 자가 정화 (본문 fetch + 미분류 의견 코멘트 첨부) |
| `scripts/report_aa_daily.js` | 일일 리포트 오케스트레이터 |
| `scripts/report/render.js` | 리포트 HTML 렌더 |
| `scripts/report/report_lib.js` | 순수 함수 모음 (policyHash에 guidelines 포함) |
| `reference/classification_guidelines.md` | 분류 지침 SSOT (자연어 — LLM system prompt 주입) |
| `config/analysis_rules.json` | 룰 matcher용 JSON (audit·report unmatched 추적 참조) |
| `config/classification_decisions.json` | 휴먼 결정 기록 |
| `reference/classification_rules.md` | 분류 체인 의도·변경 절차 |

---

## 6. 주의사항 (함정)

1. **npm 인수 전달**: `"delete:aa:before": "node scripts/delete_aa_before.js --"` 끝에 `--` 필요. 없으면 npm이 `--before`를 자체 config로 소비.
2. **`aaTree.flat[0]?.parentId` 사용 금지** — `fetchAASpaceHomepageId()` 사용.
3. **`PROTECTED_LABELS`** — `last-parent-*`는 `startsWith('last-parent-')` 검사 (정확 일치 아님).
4. **rate limit**: Confluence Cloud 5000 req/h. `report_aa_daily` ≈ 250-300 req. 본문 fetch 추가 시 증가 — 재분류 대상 페이지만 fetch하도록 설계.
5. **`.env` 커밋 금지**: `ANTHROPIC_API_KEY`, `CONFLUENCE_TOKEN` 등. GitHub Actions Secrets 사용.
6. **Windows CRLF**: 가이드 문서 LF→CRLF 경고 무시 가능.

---

## 7. 다음 세션 첫 메시지 예시

> "HANDOFF.md §3読んで、LLM 본문 기반 분류 재설계 이어서 진행해줘. 설계 합의는 되어 있고 구현 계획(TDD 단계)도 §3-5에 있어."

또는:

> "미커밋 변경사항 먼저 커밋하고, 그 다음 LLM 분류 재설계 시작하자."

---

작성자: Claude (현재 세션)
수신자: 다음 세션의 작업자
