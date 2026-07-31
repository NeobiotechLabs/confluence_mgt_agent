# 세션 인수인계 (Handoff)

> 작성: 2026-07-31 (현재 세션 종료 시점)
> 받는 사람: 다음 세션을 여는 작업자

---

## 0. 컨텍스트 복원 순서 (3분)

1. **`CLAUDE.md`** (저장소 루트) — 프로젝트 개요, 아키텍처, 개발 명령어
2. **`reference/ToDo.md`** — 진행 상황·다음 작업 (가장 중요)
3. **`reference/classification_rules.md`** — 분류 체인 의도·변경 절차
4. **`docs/USER_GUIDE.md`** — 사용자 가이드 (유틸 스크립트 포함 최신)
5. **본 문서 §3** — 미완료 작업 (LLM 기반 분류 재설계)

---

## 1. 현재 상태 한 줄 요약

AA 스페이스 이관 + 일일 자동 리포트 + 자가 정화(audit·reorganize) **동작 중**.
분류 체인 `rule → inline-llm → fallback` 단일화 완료.
유틸 스크립트 5종 구현 완료 (미커밋).
**다음 큰 작업: LLM 본문 기반 분류 재설계** (설계 합의 완료, 구현 미착수).

- 테스트: **185/185 PASS**
- 미커밋 변경: 5개 파일 (§2 참조)

---

## 2. 미커밋 변경 사항

```
M docs/USER_GUIDE.md                   — 유틸 스크립트 §3.6 + Gap 수정 반영
M package.json                         — tree:aa, snapshot:aa, delete:aa:before, find:unmigrated 스크립트 추가
M reference/aa_tree_snapshot.json       — 스냅샷 데이터 (실행 산출물)
M scripts/delete_aa_before.js          — 날짜 추출 수정 (배너 regex + Confluence fallback)
M tests/utils/delete_aa_before.test.js — 수정 대응 테스트 추가
?? reference/aa_report_dryrun.html     — dry-run 리포트 산출물 (커밋 불필요)
```

커밋 시 참고: `reference/aa_report_dryrun.html`은 실행 산출물이므로 `.gitignore` 또는 커밋 제외 권장.

---

## 3. 미완료 작업 — LLM 본문 기반 분류 재설계 (최우선)

### 3-1. 배경·문제 인식

사용자가 현재 분류 철학에 근본적 의문 제기:
- **현재**: 제목 정규식(`analysis_rules.json`의 `title_patterns`)으로 분류 → 작성자가 제목을 어떻게 달지 예측 불가 → 룰을 계속 추가해야 함 → 무한 유지보수
- **사용자 제안**: "아예 내용을 기반으로 LLM이 판단하는건?" → 논의 후 완전 재설계 합의

### 3-2. 합의된 새 아키텍처

```
human (과거 결정) → structural check → LLM (본문 기반) → fallback (미분류 + LLM 의견)
```

**현재 체인과의 차이:**

| 항목 | 현재 | 새 설계 |
|---|---|---|
| rule 단계 | 제목 regex 매칭 (12개 카테고리) | **제거** — 자연어 지침 파일로 대체 |
| LLM 입력 | `ctx.title`만 전송 | **페이지 본문** (HTML strip + ~2000자 truncation) |
| LLM 역할 | 제목 기반 보조 판단 | **1차 분류 판단자** |
| fallback | `unsortedFolderId` + `needs-review` | `미분류` 폴더 + **LLM 의견 첨부** |
| advisory | 키워드 가중치 점수 | **LLM 생성 의미 있는 분석** |
| 학습 루프 | `classification_decisions.json` append | 미분류 → 사람 검토 → 이동 → **지침 업데이트** → LLM 개선 |

### 3-3. 설계 핵심 결정 사항

1. **본문 추출**: Confluence storage format HTML → 태그 제거 → 처음 ~2000자. `llm_api.js`의 `callLLM()` user 메시지에 title + body 함께 전송.
2. **자연어 지침 파일**: `config/analysis_rules.json`의 regex 대신 `reference/classification_guidelines.md` (또는 유사) — 폴더별 설명, 판단 기준, 예시. LLM system prompt에 주입.
3. **신뢰도 / 미분류**: LLM이 확신 못하면 `미분류`로 보내고 의견(reason)을 라벨 또는 코멘트로 첨부. 사람이 검토 후 옮기면 그 결정이 지침 업데이트의 근거.
4. **structural check**: LLM 호출 전 구조적 검증 (이미 올바른 폴더에 있는지, 보호 라벨인지 등) — 불필요한 LLM 호출 절감.
5. **성능**: 페이지당 본문 fetch 추가 → API 호출 증가. `listAAPages` 1회 공유 + 본문 fetch는 재분류 대상 페이지만 (전체 174페이지 중 실제 이동 대상은 소수).
6. **호환성**: `classifyWithChain(ctx, aaTree)` 시그니처 유지 → migrator, audit, reorganize 호출 코드 변경 최소화.

### 3-4. 탐색 결과 (코드 사실, 3개 에이전트 완료)

**분류 체인 (`classification_provider.js`)**:
- 4단계: human → rule → llm → fallback, 각 단계 try/catch
- 반환: `{ok, source, folderId, folderTitle, labels, reason}`
- `llm_api.js`: `callLLM({client, system, user, tools, model, max_tokens})` — 현재 `user = ctx.title`만, 본문 미전송
- `rule.js`: `config/analysis_rules.json` 12개 카테고리, `title_patterns`(regex) + `ancestor_contains` + `exclude` 매칭
- `engine.js`: thin adapter, `classifyWithChain(ctx, aaTree)` 시그니처
- `human.js`: `classification_decisions.json`, titleRegex 매칭, priority 정렬

**감사·재조직 (`audit_aa_space.js`, `reorganize_aa_space.js`)**:
- `detectMove`: `last-parent-*` 라벨로 휴먼 이동 감지 → `commitDecision` JSON 기록
- `stampLastParent`: 항상 실행 (dryRun 아니먄)
- reorganize: `is-folder`/`bot-report`/`human-classified`/homepage 스킵 → `classifyWithChain` 호출

**리포트·advisory (`render.js`, `report_aa_daily.js`)**:
- §4 dual-format: `advisories[]` 문자열 → `<ul>`, `misplacement-suspect` 객체 → `<table>`
- §5 조건부 경고 매크로
- 부록 JSON schema v1: items[] kinds: `move-b`, `unmatched`, `misplacement-suspect`, `kb-unknown`
- `advisories[]` mutable accumulator 패턴

### 3-5. 구현 계획 (TDD, 단계별)

아직 플랜 파일 미작성. 다음 세션에서 아래 순서로 진행:

1. **본문 추출 유틸** (`scripts/utils/content_extractor.js`)
   - `stripHtml(html)` → 태그 제거, 텍스트만
   - `truncateContent(text, maxChars=2000)` → 처음 N자
   - `buildLLMInput(ctx, bodyHtml)` → `{title, body}` 조합
   - TDD: HTML strip, truncation, null/empty 처리

2. **자연어 지침 파일** (`reference/classification_guidelines.md`)
   - 폴더별 설명 + 판단 기준 + 예시
   - `config/analysis_rules.json`의 카테고리 정보를 자연어로 전환
   - LLM system prompt에 주입할 포맷

3. **LLM 분류 프롬프트 재설계** (`scripts/utils/llm_api.js` 수정)
   - `callLLMForClassification({title, body, tree, guidelines})` — 본문 포함
   - `select_folder` tool_use 응답에 `confidence` 필드 추가 (또는 reason 기반 판별)
   - 기존 `callLLM()` 시그니처 유지 (하위호환)

4. **분류 체인 재편** (`scripts/utils/classification_provider.js`)
   - `human → structural → llm(content) → fallback(미분류+의견)`
   - rule 단계 제거 또는 structural check로 축소
   - fallback 시 LLM reason을 페이지에 첨부 (라벨 또는 코멘트)

5. **미분류 의견 첨부** (reorganize 또는 별도 모듈)
   - 미분류 이동 시 LLM 의견을 Confluence 코멘트 또는 라벨로 기록
   - 사람이 검토할 때 볼 수 있도록

6. **§4 advisory LLM화** (report_lib.js, render.js)
   - 키워드 가중치 대신 LLM이 생성한 의미 있는 분석
   - 미분류 페이지 현황 + 반복 패턴 + 정책 제안

7. **지침 학습 루프**
   - 사람 이동 → 지침 파일 업데이트 워크플로우
   - `classification_decisions.json` 역할 재정의 (또는 폐기)

### 3-6. 기타 보류 작업

- **워크플로우 순서 변경**: `migrate → daily-report → notify-failure` (이전 세션 합의, 미구현)
- **§2 루프 A 실데이터**: migrator 이관 결과를 부록에 첨부 (Phase 2-B, 보류)

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

---

## 5. 핵심 코드 사실 (Quick Reference)

### 분류 체인 호출 경로
```
migrator.js ─────┐
audit_aa_space.js ┼─→ classifyWithChain(ctx, aaTree) ─→ classification_provider.js
reorganize_aa_space.js ─┘                                    │
                                                    human → rule → llm → fallback
```

### LLM 호출 (`llm_api.js`)
```javascript
callLLM({ client, system, user, tools, model, max_tokens })
// 현재: user = ctx.title (본문 미포함)
// tool_use: select_folder → {ok, folderId, labels, reason}
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
| `scripts/utils/classification_provider.js` | 분류 체인 (rule→llm→fallback) |
| `scripts/utils/llm_api.js` | Anthropic SDK wrapper |
| `scripts/classifiers/rule.js` | SSOT 룰 matcher (analysis_rules.json) |
| `scripts/classifiers/engine.js` | classifyWithChain 시그니처 adapter |
| `scripts/audit_aa_space.js` | 감사 + 휴먼 이동 감지 |
| `scripts/reorganize_aa_space.js` | 자가 정화 (재분류·이동) |
| `scripts/report_aa_daily.js` | 일일 리포트 오케스트레이터 |
| `scripts/report/render.js` | 리포트 HTML 렌더 |
| `scripts/report/report_lib.js` | 순수 함수 모음 |
| `config/analysis_rules.json` | 분류 룰 SSOT (12개 카테고리) |
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
