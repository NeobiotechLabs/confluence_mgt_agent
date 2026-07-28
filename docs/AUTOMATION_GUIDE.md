# Confluence AA Space 자동화 가이드

> 작성일: 2026-07-28
> 대상: confluence_mgt_agent 운영자 및 신규 합류자
> 자동화 파이프라인(`audit-aa → reorganize-aa → migrate`)을 처음 세팅하거나, 일상적으로 운영할 때 참고

---

## 0. 자동화가 하는 일

신규 스페이스(AA, 덴탈AI연구소 Archive)를 정책에 맞게 **자동 유지보수**합니다.

- 사람이 페이지를 옮기면 → 다음 cron에서 자동 감지
- 정책과 어긋난 페이지를 발견하면 → 자동 분류/이동/라벨 부여
- 사람이 따로 명령을 내릴 필요 없이 Confluence UI에서 평소처럼 사용하면 시스템이 따라옴

핵심 가치: 휴먼 리소스 투입 없이 일관된 정책 유지.

---

## 1. 아키텍처 한눈에

```
┌─────────────────────────────────────────────────────────────────────┐
│ 작업자                                                              │
│  • 평소처럼 Confluence UI에서 페이지 드래그                          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Confluence Cloud (자동)                                              │
│  • 부모 변경 시 자동으로 last-parent-{oldFolderId} 라벨 부여         │
│  • is-folder, human-classified 라벨 관리                            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ GitHub Actions (KST 09:00 매일 cron + workflow_dispatch 수동)       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────┐│
│  │ audit-aa    │→ │ reorganize-aa│→ │  migrate   │→ │ notify-      ││
│  │ 휴먼 이동   │  │ 체인 분류     │  │ 실제 이관   │  │ failure      ││
│  │ 감지        │  │ 라벨 동기화   │  │            │  │ (실패 시만)  ││
│  └─────────────┘  └──────────────┘  └────────────┘  └──────────────┘│
│   ↓ PR 자동 생성                                                      │
│   bot/audit-decisions-{timestamp}                                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 운영자 (선택)                                                        │
│  • Auto-PR 검토 및 머지                                              │
│  • 예외 상황 수동 처리                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 최초 세팅 (한 번만)

### 2.1 저장소 클론

```bash
git clone git@github.com:NeobiotechLabs/confluence_mgt_agent.git
cd confluence_mgt_agent
npm install
```

### 2.2 GitHub Secrets 등록

저장소 Settings → Secrets and variables → Actions → New repository secret:

| Secret 이름 | 용도 | 어디서 발급 |
|-------------|------|------------|
| `CONFLUENCE_EMAIL` | Confluence 계정 이메일 | 본인 Atlassian 계정 |
| `CONFLUENCE_TOKEN` | Confluence API 토큰 | https://id.atlassian.com/manage-profile/security/api-tokens |
| `ANTHROPIC_API_KEY` | Claude API 키 (claude-haiku-4-5-20251001) | https://console.anthropic.com/ |

> ⚠️ 토큰은 절대 코드/문서에 커밋하지 말 것. `.env` 로컬용, GitHub Secrets 원격용으로 분리.

### 2.3 로컬 .env 파일

```bash
cp .env.sample .env
# .env 파일에 본인 키 입력
```

### 2.4 Self-hosted Runner 등록

GitHub Actions의 `runs-on: self-hosted`는 사내 러너가 등록돼 있어야 동작합니다.

- 저장소 Settings → Actions → Runners → New self-hosted runner
- OS: Linux 권장 (Windows/macOS도 가능)
- 라벨은 기본값 사용 (별도 커스텀 라벨 없음)

러너가 꺼져 있으면 cron이 silent fail — 모니터링 필요.

### 2.5 첫 실행 (수동 트리거 권장)

cron을 기다리지 말고 Actions 탭에서 `Confluence AA Space Automation` → Run workflow로 수동 실행:

1. `audit-aa` job → 로그에서 "휴먼 이동 0건 감지" 또는 "N건 감지, PR 생성됨" 확인
2. `reorganize-aa` job → 로그에서 분류 체인 호출 결과 확인
3. `migrate` job → 로그에서 페이지 이동 결과 확인

모두 성공하면 세팅 완료.

---

## 3. 운영 사이클 (일상)

### 3.1 매 KST 09:00 자동 실행

```
UTC 00:00 = KST 09:00 (cron: '0 0 * * *')
```

| Job | 하는 일 | 실패 시 |
|------|--------|---------|
| `audit-aa` | AA 스페이스의 모든 페이지 훑기, 휴먼 이동 감지, `config/classification_decisions.json` 갱신, Auto-PR 생성 | `notify-failure` Slack/Email 발송 |
| `reorganize-aa` | 분류 체인(HumanPolicy → Rule → Claude → Unsorted) 실행, 라벨 동기화 | `notify-failure` Slack/Email 발송 |
| `migrate` | 새 라벨 기반 실제 페이지 이동 (필요 시) | `notify-failure` Slack/Email 발송 |

### 3.2 휴먼 이동 자동 감지 메커니즘

Confluence Cloud는 페이지의 부모 폴더가 변경되면 **자동으로** `last-parent-{oldFolderId}` 라벨을 부여합니다.

예시:
```
[작업자가 UI에서 "덴탈AI 보고서" 페이지를 "26 보고서" 폴더로 드래그]
  ↓
Confluence가 자동으로 last-parent-123456 (예: 옛 폴더 ID) 라벨 부여
  ↓
다음 audit 실행 (KST 09:00)
  ↓
scripts/audit_aa_space.js가 이 라벨 읽음
  ↓
휴먼 의도로 판단 → config/classification_decisions.json에 매핑 추가
  ↓
Auto-PR 생성 (bot/audit-decisions-{timestamp})
```

**작업자가 추가로 알려줘야 하는 경우는 거의 없음.**

### 3.3 Auto-PR 처리

audit job이 생성하는 PR은 작업자가 검토 후 머지:

1. GitHub 저장소 → Pull requests 탭
2. `bot/audit-decisions-*` 브랜치 PR 확인
3. `config/classification_decisions.json` 변경 내용 검토
4. OK면 Merge (Squash 권장)

> 머지하지 않아도 다음 cron에서 새 PR이 쌓이므로 정리 차원에서 머지 권장.

### 3.4 보호 라벨 (절대 제거하지 말 것)

`scripts/utils/migration_utils.js`의 `isProtected()` 함수로 보호됩니다:

- `is-folder` — 폴더 식별
- `human-classified` — 휴먼 정책으로 확정된 페이지
- `last-parent-*` — 직전 부모 폴더 추적용 (자동 감지의 핵심)

이 라벨을 임의로 제거하면 자동 감지 체인이 끊어집니다.

---

## 4. 분류 체인 (4단계 Port/Adapter)

`scripts/classifiers/engine.js`의 `classifyWithChain(ctx, aaTree)` 구현:

```
[1] HumanPolicy (highest priority)
    config/classification_decisions.json 매핑 확인
    source: 'human-ui-move' (priority 0)
    ↓ miss
[2] Rule
    config/categories.yaml 또는 inline rule (regex 매칭)
    source: 'manual-script' 또는 'rule-promoted'
    ↓ miss
[3] Claude API
    Anthropic SDK tool_use (claude-haiku-4-5-20251001)
    source: 'claude-api'
    ↓ miss / error
[4] Unsorted 폴더 fallback
    aaTree.unsortedFolderId, folderTitle: '미분류'
    source: 'fallback'
```

**Priority가 낮은 source가 이깁니다** (휴먼 의도가 항상 우선).

---

## 5. 작업자 일상 시나리오

### 5.1 평소 사용 (대부분의 경우)

1. Confluence UI에서 페이지 드래그, 제목 수정, 내용 편집
2. **아무것도 안 해도** 다음 cron에서 자동 반영
3. Auto-PR이 오면 검토/머지

### 5.2 새 AA 폴더를 만들었을 때

분류 체인이 새 폴더를 모르면 fallback으로 빠집니다.

조치:
1. `setup_aa_space.js`로 폴더 생성했는지 확인
2. 폴더 제목이 rule 패턴과 일치하면 자동 인식됨
3. 패턴에 없으면 `config/classification_decisions.json`에 직접 매핑 추가

### 5.3 분류가 잘못된 경우

1. Confluence UI에서 페이지를 올바른 폴더로 직접 드래그
2. 다음 cron에서 자동 정정됨 (휴먼 이동 우선)
3. 또는 `config/classification_decisions.json`에 매핑 추가

### 5.4 라벨이 안 붙는 폴더 이동

`last-parent-*` 라벨은 **페이지**에만 부여됩니다. 폴더 자체를 이동할 때는 자동 감지 안 됨.

조치: 폴더 이동은 수동으로 하되, 안의 페이지들이 다음 audit에서 부모 변경 감지되어 자동 처리됩니다.

---

## 6. 운영 명령어 (로컬)

| 명령 | 용도 |
|------|------|
| `npm run audit:aa` | audit 한 번 실행 (로컬 디버그) |
| `npm run reorganize:aa` | reorganize 한 번 실행 |
| `npm run reorganize:aa:dryrun` | 실제 변경 없이 시뮬레이션 |
| `npm run migrate:all` | migrator 한 번 실행 |

> 로컬 실행 전 `.env`에 키가 있어야 함. Actions 환경변수와 별개.

### 테스트 실행

```bash
node --test "tests/**/*.test.js"
```

9/9 PASS가 정상.

---

## 7. 트러블슈팅

### 7.1 Cron이 아예 안 돈다

1. Self-hosted runner 상태 확인 (오프라인 아닌지)
2. 저장소 Settings → Actions → General → "Allow all actions and reusable workflows" 활성화 확인
3. 워크플로우 파일의 `on.schedule` 문법 확인 (`'0 0 * * *'` — UTC 00:00 = KST 09:00)

### 7.2 audit job이 401/403 반환

`CONFLUENCE_EMAIL` 또는 `CONFLUENCE_TOKEN` Secret 만료/오류.

조치: Secrets 갱신 후 `workflow_dispatch`로 재실행.

### 7.3 notify-failure가 안 온다

`notify-failure` job은 `self-hosted` 러너에서 실행됩니다. 러너가 죽어 있으면 발송 안 됨.

대안: workflow YAML에서 해당 job의 `runs-on`을 `ubuntu-latest`로 변경 (PR 필요).

### 7.4 Auto-PR이 충돌해서 실패

`branch-suffix: timestamp`로 이미 방지되어 있으나, 같은 초에 두 번 실행되면 충돌 가능.

조치: 추후 `branch-suffix: short-commit-hash`로 변경 검토 (follow-up 항목).

### 7.5 라벨이 사라졌다

`migration_utils.js`의 `isProtected()` 가드를 우회하는 코드가 들어갔을 수 있음.

조치:
1. `git log`에서 최근 변경 확인
2. `git grep "labels.toRemove"`로 syncLabels 로직 점검
3. 필요 시 수동으로 보호 라벨 재부여

---

## 8. 관련 문서

- 설계: [`docs/superpowers/specs/2026-07-28-confluence-migrator-revamp-design.md`](superpowers/specs/2026-07-28-confluence-migrator-revamp-design.md)
- 플랜: [`docs/superpowers/plans/2026-07-28-confluence-migrator-revamp.md`](superpowers/plans/2026-07-28-confluence-migrator-revamp.md)
- 진행 ledger: [`.superpowers/sdd/2026-07-28-confluence-migrator-revamp/progress.md`](../.superpowers/sdd/2026-07-28-confluence-migrator-revamp/progress.md)
- 컨텍스트: [`CLAUDE.md`](../CLAUDE.md), [`reference/ToDo.md`](../reference/ToDo.md)

---

## 9. 변경 이력

| 날짜 | 변경 |
|------|------|
| 2026-07-28 | 초안 작성 (Plan `2026-07-28-confluence-migrator-revamp` 완료 후) |