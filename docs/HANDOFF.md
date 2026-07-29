# 세션 인수인계 (Handoff)

> 작성: 2026-07-28 (현재 세션 종료 시점)
> 받는 사람: 다음 세션을 여는 작업자 (본인 또는 동료)

## 컨텍스트 복원 순서 (3분)

세션 시작 후 아래 순서로 읽으면 컨텍스트가 복원됩니다.

1. **`CLAUDE.md`** (저장소 루트) — 프로젝트 개요, Confluence API 정보
2. **`docs/STATUS.md`** — 한일/할일 통합 현황 (방금 갱신)
3. **`docs/AUTOMATION_GUIDE.md`** — 자동화 운영 종합 가이드
4. **`reference/ToDo.md`** — 비즈니스 컨텍스트, 마이그레이션 이력

읽은 후 작업자가 본인 의도를 말하면 — 작업을 이어가면 됩니다.

## 핵심 사실 (Quick Reference)

### 저장소
- **원격**: `git@github.com:NeobiotechLabs/confluence_mgt_agent.git`
- **현재 작업 브랜치**: `chore/migration-log-update` (PR #1 머지 전)
- **PR**: https://github.com/NeobiotechLabs/confluence_mgt_agent/pull/1
- **main 커밋 수 대비**: 18 commits ahead (Plan + 가이드)

### 시스템 한 줄 요약
GitHub Actions가 매일 KST 09:00에 `audit-aa → reorganize-aa → migrate` 순으로 돌면서 Confluence AA 스페이스를 자동 정리. 휴먼 의도(Confluence UI 드래그)는 `last-parent-{id}` 라벨로 자동 감지되어 분류 체인에서 최우선 처리됨.

### 4단계 분류 체인 (Port/Adapter)
```
HumanPolicy (config/classification_decisions.json) → Rule → Claude API → Unsorted fallback
```
priority 낮을수록 이김 (human-ui-move = 0이 최우선)

### GitHub Actions
- cron: `'0 0 * * *'` (UTC 00:00 = KST 09:00)
- 4 jobs: `audit-aa` → `reorganize-aa` → `migrate` → `notify-failure`
- self-hosted runner 사용
- `peter-evans/create-pull-request@v5`로 Auto-PR (`bot/audit-decisions-{timestamp}`)

### 기술 스택
- Node.js 18
- Anthropic SDK (`@anthropic-ai/sdk` ^0.115.0), model `claude-haiku-4-5-20251001`
- Confluence Cloud REST API v1/v2 (`https://neobiotech.atlassian.net`)
- Port/Adapter 패턴 (classifiers 디렉토리)
- dotenv ^17.4.2

## 미완료 작업 (다음 세션에서 처리)

### 최우선 (작업자가 직접 결정)
- PR #1 머지 — 본인이 GitHub UI에서 검증 후 머지
- 머지 후 브랜치 정리 (`git branch -d`, 원격 삭제)

### 시스템 활성화
1. `config/classification_decisions.json` 초기 매핑 작성 (빈 stub → 실제 정책)
2. GH Secrets 3개 등록 (`CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`, `ANTHROPIC_API_KEY`)
3. Self-hosted runner 가용성 확인
4. workflow_dispatch 수동 실행으로 검증

### 선택적 후속
- actionlint 도입
- classifyWithChain 통합 테스트
- isProtectedLabel() contract test
- fetchLabels concurrency=5
- 잔존 fetchAASpaceTreeText cleanup

## 의사결정 이력 (왜 이렇게 됐는지)

### Plan 변경 사항 (구 Dify → 신규 GH Actions)
- **Dify 토큰 만료**로 외부 의존 제거 결정 (ToDo.md §"Dify 토큰 만료로 인한 작업 중단")
- 자체 Anthropic API 직접 호출로 대체 → 자급자족형 자동화 목표

### 왜 cron `'0 0 * * *'`?
- KST = UTC+9
- KST 09:00 = UTC 00:00
- 처음 brief에 `'0 15 * * *'`로 적혀 있었지만 KST 자정으로 잘못 해석되어 round 1 fix로 정정됨 (`'0 0 * * *'`)

### 왜 notify-failure가 별도 job?
- 처음 brief는 `migrate` job에만 failure notification
- audit/reorganize 실패가 silent 되는 결함 → 별도 4번째 job으로 분리
- `needs: [audit-aa, reorganize-aa, migrate]` + `if: failure()`

### 왜 휴먼 정책이 최우선?
- 사람이 UI에서 직접 옮긴 의도가 가장 신뢰할 만함
- Rule/Claude가 오분류해도 휴먼 이동은 자동 정정됨
- Priority 0 (human-ui-move)이 가장 낮아서 항상 이김

## 다음 세션 첫 메시지 예시

작업자가 다음 세션을 열 때 아래처럼 시작하면 됩니다:

> "이전 세션에서 confluence_mgt_agent의 마이그레이션 자동화 작업을 마무리하고 PR #1을 만들었어. `docs/STATUS.md`랑 `docs/HANDOFF.md` 읽어보고 이어서 작업하자. 우선 PR 머지하고 config/classification_decisions.json 초기 매핑 작업 시작할 거야."

또는:

> "STATUS.md에서 할일 목록 봤어. 오늘은 actionlint 도입부터 시작하자."

이전 세션 컨텍스트 없이도 위 문서만으로 즉시 진행 가능하도록 설계됨.

## 연락처/메모

- 커밋 trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`
- Plan workspace: `.superpowers/sdd/2026-07-28-confluence-migrator-revamp/`
- Final review 위치: `.superpowers/sdd/2026-07-28-confluence-migrator-revamp/task-19-report.md`

## 주의사항 (다른 세션이 알아야 할 함정)

1. **`aaTree.flat[0]?.parentId`** 사용 금지 — fragile, 5663bf0 commit에서 `fetchAASpaceHomepageId()`로 교체함
2. **`PROTECTED_LABELS`** — `last-parent-*` 라벨은 `startsWith('last-parent-')`로 검사 (정확 일치 아님)
3. **migration_utils.js의 `isProtected()`** — syncLabels에서 보호 라벨을 제거하지 말 것
4. **CRLF 경고** — Windows에서 가이드 문서 작성 시 LF가 CRLF로 변환됨. git이 자동 처리하므로 무시 가능
5. **이미 PR #1이 있음** — `gh pr create`가 아니라 `gh pr edit`로 갱신해야 함

---

작성자: Claude (현재 세션)
수신자: 다음 세션의 작업자