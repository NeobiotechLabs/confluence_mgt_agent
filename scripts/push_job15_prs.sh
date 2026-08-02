#!/usr/bin/env bash
# 작업 15 — 4-PR 분할 push + PR 생성 스크립트
#
# 사용법: bash scripts/push_job15_prs.sh
#
# 사전 조건:
#   1) main이 12-commit 직선으로 머지된 상태 (현재 상태)
#   2) 4개 feature 브랜치가 085a7c1 base로 이미 생성됨
#      (git branch | grep feature/migration-dropout-pr*)
#   3) origin이 git@github.com:NeobiotechLabs/confluence_mgt_agent.git
#   4) gh CLI 인증 완료 (`gh auth status`)
#
# 동작:
#   1) PR 1 → 4 순서로 feature 브랜치를 origin에 push
#   2) 각 PR에 대해 gh pr create --base main
#   3) PR 1 머지 후 → PR 2 push, 머지 후 → PR 3 push, ...
#   4) (선택) PR 머지 완료 시 main에서 npm test 1회 실행

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BASE_COMMIT=085a7c1
ORIGIN=${ORIGIN:-origin}
PR_BRANCHES=(feature/migration-dropout-pr1 feature/migration-dropout-pr2 feature/migration-dropout-pr3 feature/migration-dropout-pr4)

# ─────────────────────────────────────────────────────────────────────────
# 1단계: 각 feature 브랜치를 cherry-pick으로 정확한 커밋 구성
# ─────────────────────────────────────────────────────────────────────────
echo "=== 1단계: feature 브랜치 cherry-pick ==="

# PR 1 — 가치 평가 도구 스키마 (Task 1, 1 commit)
git checkout feature/migration-dropout-pr1
git cherry-pick 0a17e05
git checkout main

# PR 2 — 가치 평가 모듈 + LLM wiring + dropped_cache (Task 2, 3, 4, 6 commits)
git checkout feature/migration-dropout-pr2
git cherry-pick 11740d8 57afcd9 9979d0a 17922f5 372f88a a2cb18a
git checkout main

# PR 3 — RED 테스트 + runMigrate 통합 + render 5-group (Task 5, 6, 7, 4 commits)
git checkout feature/migration-dropout-pr3
git cherry-pick 0e24a6e 3dea841 3dc1a44 af12dfd
git checkout main

# PR 4 — 운영 CLI + 문서 (Task 8, 9, 2 commits)
git checkout feature/migration-dropout-pr4
git cherry-pick 823ce30 6bd6e51
git checkout main

echo ""
echo "=== 2단계: push + PR 생성 ==="

# ─────────────────────────────────────────────────────────────────────────
# 2단계: push + PR 생성
# ─────────────────────────────────────────────────────────────────────────

PR1_BODY="## 작업 15 PR 1 — 가치 평가 모듈 (Task 1)

**스펙**: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md §5-1, §5-2, §5-3

### 변경
- \`scripts/utils/value_prompt.js\` (신규) — \`SELECT_MIGRATION_VALUE_TOOL\` 스키마 + \`buildValueSystemPrompt\` / \`buildValueUserMessage\` 빌더
- \`tests/utils/value_prompt.test.js\` (신규, 7 tests)

### 의존성
- (없음, 첫 머지)

### 검증
- \`npm test -- tests/utils/value_prompt.test.js\` → 7/7 PASS
- PR 2 머지 전까지 단독 머지 가능 (외부 의존 없음)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

PR2_BODY="## 작업 15 PR 2 — 가치 평가 + dropped_cache (Task 2, 3, 4)

**스펙**: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md §5-1, §5-3, §5-4

### 변경
- \`scripts/utils/migration_value.js\` (신규) — \`assessMigrationValue\` (verdict: create/unclassified/dropped, deps 주입, throw 흡수)
- \`scripts/utils/llm_api.js\` (수정) — \`callLLMForMigrationValue\` 추가 (self-contained, Fix 1 후 \`callLLM\` 시그니처 원본 유지)
- \`scripts/migrator/dropped_cache.js\` (신규) — SSOT I/O + consult/merge/hashFor (atomic write, graceful load)
- \`reference/dropped_pages.json\` (신규, 빈 배열)
- 신규 테스트 28건 (migration_value 8 + llm_api_value 5 + dropped_cache 15)

### 의존성
- PR 1 (가치 평가 도구 스키마)

### 검증
- \`npm test -- tests/utils/migration_value.test.js tests/utils/llm_api_value.test.js tests/migrator/dropped_cache.test.js\` → 28/28 PASS

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

PR3_BODY="## 작업 15 PR 3 — runMigrate 통합 + render 5-group (Task 5, 6, 7)

**스펙**: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md §5-5, §5-6

### 변경
- \`scripts/migrator.js\` (수정) — runMigrate 본문 재작성: 5-status 분기 (created/synced/unclassified/dropped/failed) + dropped 캐시 통합 + chain-fail 강제 unclassified + saveError 노출
- \`scripts/report/render.js\` (수정) — migrateSection 5-group + dropped/unclassified 컬럼 (\`재평가 D-N\`, \`추천 폴더\`) + appendixSection escapeHtml 3-line fix
- \`tests/migrator/run_migrate_dropout.test.js\` (신규, 10 tests) + \`tests/report/render_migrate_dropout.test.js\` (신규, 6 tests)
- \`tests/migrator/run_migrate.test.js\` (수정) — makeDeps 확장 + 기존 테스트 1건 계약 갱신 (chain-fail → unclassified)
- \`tests/report/render_migrate_a.test.js\` (수정) — 3 obsolete 테스트 갱신 (skipped → unclassified/dropped)

### 의존성
- PR 1 (가치 평가 모듈)
- PR 2 (dropped_cache)

### 검증
- \`npm test -- tests/migrator/run_migrate_dropout.test.js\` → 10/10 PASS
- \`npm test -- tests/report/render_migrate_dropout.test.js\` → 6/6 PASS
- \`npm test -- tests/migrator/run_migrate.test.js tests/report/render_migrate_a.test.js\` → 회귀 0

### 위험
- 1건 기존 테스트 계약 갱신 (chain-fail → unclassified, 작업 15 spec의 신규 계약). 머지 전 reviewer 확인 권장.
- \`appendixSection\` escapeHtml fix (3 lines): pre-existing XSS 회귀 노출. brief scope 외였지만 정당화됨.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

PR4_BODY="## 작업 15 PR 4 — 운영 CLI + 문서 (Task 8, 9)

**스펙**: docs/superpowers/specs/2026-08-02-migration-dropout-screen-design.md §7, §12

### 변경
- \`scripts/list_dropped.js\` (신규) — \`reference/dropped_pages.json\` 테이블 형식 CLI
- \`package.json\` (수정) — \`migration:dropped:list\` 스크립트
- \`reference/classification_rules.md\` (수정) — §9 신설 (작업 15 탈락 후보 정책)
- \`reference/ToDo.md\` (수정) — 작업 15 ✅ 완료 표시 + 테스트 카운트 갱신
- \`reference/JOB15_PR_SPLIT.md\` (신규) — 이 4-PR 분할 가이드
- \`scripts/push_job15_prs.sh\` (신규) — 본 스크립트

### 의존성
- PR 1, 2, 3 (전체 통합)

### 검증
- \`node scripts/list_dropped.js\` → \"(no dropped entries)\" (SSOT 비어있음)
- \`npm test\` → 302/304 PASS + 2 baseline RED (작업 15 무관)
- \`npm run report:aa:dryrun\` → 정상 (5-group, 34 migrate items)
- \`npm test -- tests/migrator/no_dify_stale_log.test.js\` → 2/2 PASS (Dify residue 회귀 가드)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

# ─────────────────────────────────────────────────────────────────────────
# 3단계: push + PR 생성 (PR 1 → 머지 → PR 2 → ... 순서)
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "=== 3단계: PR 1 push + 생성 ==="
git checkout feature/migration-dropout-pr1
git push -u "$ORIGIN" feature/migration-dropout-pr1
gh pr create --base main --head feature/migration-dropout-pr1 \
  --title "feat(작업 15 PR1): 가치 평가 도구 스키마 (value_prompt)" \
  --body "$PR1_BODY"

echo ""
echo ">>> PR 1을 GitHub에서 머지한 후 Enter를 누르세요 (계속)..."
read -r
git checkout main
git pull

echo ""
echo "=== 4단계: PR 2 push + 생성 ==="
git checkout feature/migration-dropout-pr2
git push -u "$ORIGIN" feature/migration-dropout-pr2
gh pr create --base main --head feature/migration-dropout-pr2 \
  --title "feat(작업 15 PR2): 가치 평가 모듈 + dropped_cache (migration_value + llm_api 확장)" \
  --body "$PR2_BODY"

echo ""
echo ">>> PR 2를 GitHub에서 머지한 후 Enter를 누르세요 (계속)..."
read -r
git checkout main
git pull

echo ""
echo "=== 5단계: PR 3 push + 생성 ==="
git checkout feature/migration-dropout-pr3
git push -u "$ORIGIN" feature/migration-dropout-pr3
gh pr create --base main --head feature/migration-dropout-pr3 \
  --title "feat(작업 15 PR3): runMigrate 5-status + render 5-group" \
  --body "$PR3_BODY"

echo ""
echo ">>> PR 3을 GitHub에서 머지한 후 Enter를 누르세요 (계속)..."
read -r
git checkout main
git pull

echo ""
echo "=== 6단계: PR 4 push + 생성 ==="
git checkout feature/migration-dropout-pr4
git push -u "$ORIGIN" feature/migration-dropout-pr4
gh pr create --base main --head feature/migration-dropout-pr4 \
  --title "feat(작업 15 PR4): 운영 CLI + 문서 동기화" \
  --body "$PR4_BODY"

echo ""
echo ">>> PR 4를 GitHub에서 머지한 후 Enter를 누르세요 (계속)..."
read -r
git checkout main
git pull

echo ""
echo "=== 7단계: 최종 검증 ==="
npm test 2>&1 | tail -10

echo ""
echo "=== 8단계: feature 브랜치 정리 ==="
for branch in "${PR_BRANCHES[@]}"; do
  git branch -d "$branch" || true
done

echo ""
echo "✅ 4-PR 분할 push + 머지 완료"
echo ""
echo "다음 단계 (사용자):"
echo "  1) npm run report:aa (dry-run) → 정상 확인"
echo "  2) gh workflow run confluence_automation.yml → 1회 수동 트리거"
echo "  3) 다음 cron 리포트에서 §2 5-group 표 확인 (created/synced/unclassified/dropped/failed)"
