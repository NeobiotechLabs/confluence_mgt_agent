# 프로젝트 진행 상태

> 최종 갱신: 2026-07-28
> 브랜치: `chore/migration-log-update`
> PR: https://github.com/NeobiotechLabs/confluence_mgt_agent/pull/1

## 한일 (DONE)

### 1. Plan `2026-07-28-confluence-migrator-revamp` 완료
- 17개 commit (Task 1~10 + Task 19 전체)
- Dify 의존 제거, 4단계 분류 체인 (HumanPolicy → Rule → Claude API → Unsorted) 도입
- GH Actions 4-job 분리 (audit-aa → reorganize-aa → migrate → notify-failure)
- cron `'0 0 * * *'` (UTC = KST 09:00)
- 테스트 9/9 PASS
- 1,150 lines dead code 제거

### 2. 자동화 가이드 문서 작성
- `docs/AUTOMATION_GUIDE.md` — 운영자/신규 합류자용 종합 가이드

### 3. Push & PR 생성
- branch `chore/migration-log-update` → origin push 완료 (총 18 commits)
- PR #1 본문 갱신 완료 (제목/요약/가이드 링크 포함)

## 할일 (TODO)

### 즉시 (next session first action)
- [ ] **PR #1 머지** — 작업자가 GitHub UI에서 직접 머지 (PR 내용 검증 후)
- [ ] **머지 후 브랜치 정리** — `git branch -d chore/migration-log-update` + 원격 브랜치 삭제
- [ ] **main에서 최신 코드 받기** — 다른 세션에서 작업 시 `git checkout main && git pull`

### 후속 (병행 가능, 우선순위 순)
1. [ ] **config/classification_decisions.json 초기 매핑 작성**
   - 현재 빈 stub 상태. 실제 휴먼 정책 매핑 필요
   - 예: `{"titleRegex": "^\\[MPS\\]", "category": "MPS", "folderId": "..."}`
2. [ ] **GH Secrets 등록 확인**
   - `CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`, `ANTHROPIC_API_KEY`
   - 저장소 Settings → Secrets and variables → Actions
3. [ ] **Self-hosted runner 가용성 확인**
   - 러너가 offline이면 cron silent fail
4. [ ] **workflow_dispatch 수동 실행 (최초 검증)**
   - Actions 탭 → Confluence AA Space Automation → Run workflow
   - audit-aa → reorganize-aa → migrate 순서로 결과 확인
5. [ ] **config/categories.yaml 작성** (Rule 분류기 패턴 정의)
   - 현재 비어 있음. Rule 분류기가 동작하려면 필요

### Follow-up (비차단, queue에 보관)
- [ ] actionlint 도입 (workflow YAML CI 검증)
- [ ] classifyWithChain 통합 테스트 (precedence: human > rule > claude > fallback)
- [ ] isProtectedLabel() contract test (회귀 방지)
- [ ] fetchLabels concurrency=5 (rate-limit 여유)
- [ ] 잔존 fetchAASpaceTreeText cleanup (`scratch/test_tree.js`가 유일 호출자)
- [ ] branch-suffix를 timestamp에서 short-commit-hash로 (same-second collision 회피)

### 장기 (Plan 별도 필요)
- [ ] SD 스페이스 같은 파이프라인으로 정리 (현재 AA만 완료)
- [ ] 룰 버전 자동화 (`GLOBAL_RULE_VERSION` bump → 자동 재감사)

## 핵심 파일 위치 (다른 세션에서 즉시 참고)

| 파일 | 역할 |
|------|------|
| `CLAUDE.md` | 프로젝트 최상위 컨텍스트 |
| `docs/AUTOMATION_GUIDE.md` | 자동화 운영 종합 가이드 |
| `docs/superpowers/specs/2026-07-28-confluence-migrator-revamp-design.md` | 설계 spec |
| `docs/superpowers/plans/2026-07-28-confluence-migrator-revamp.md` | 구현 플랜 |
| `.superpowers/sdd/2026-07-28-confluence-migrator-revamp/progress.md` | 작업 ledger |
| `reference/ToDo.md` | 비즈니스 컨텍스트 + 마이그레이션 이력 |
| `config/classification_decisions.json` | 휴먼 정책 매핑 (현재 빈 stub) |
| `.github/workflows/confluence_automation.yml` | GitHub Actions 워크플로우 |

## 세션 재개 가이드

다른 컴퓨터/세션에서 이 작업을 이어하려면:

```bash
git clone git@github.com:NeobiotechLabs/confluence_mgt_agent.git   # (또는 기존 clone 사용)
cd confluence_mgt_agent
git checkout chore/migration-log-update                            # 작업 브랜치 (PR 머지 전)
# 또는
git checkout main && git pull                                      # PR 머지 후

# 상태 확인
cat docs/STATUS.md                                                # 이 문서
cat docs/AUTOMATION_GUIDE.md                                      # 운영 가이드

# 테스트 실행 (환경 점검)
node --test "tests/**/*.test.js"
```

세션 시작 시 `docs/STATUS.md` + `docs/AUTOMATION_GUIDE.md`를 먼저 읽으면 컨텍스트가 즉시 복원됩니다.