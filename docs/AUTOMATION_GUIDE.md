# Confluence AA Space 자동화 가이드

> 작성일: 2026-07-28 · 최종 수정: 2026-07-29
> 대상: confluence_mgt_agent 운영자 및 신규 합류자
> 자동화 파이프라인(`daily-report → migrate`)을 처음 세팅하거나, 일상적으로 운영할 때 참고

---

## 0. 자동화가 하는 일

신규 스페이스(AA, 덴탈AI연구소 Archive)를 정책에 맞게 **자동 유지보수**합니다.

- 사람이 페이지를 옮기면 → 다음 cron에서 자동 감지
- 정책과 어긋난 페이지를 발견하면 → 자동 분류/이동/라벨 부여
- **매 KST 09:00 실행마다 Confluence에 일일 리포트 페이지 1장을 반드시 생성** (빈 실행도 생성)
- 사람이 따로 명령을 내릴 필요 없이 Confluence UI에서 평소처럼 사용하면 시스템이 따라옴

핵심 가치: 휴먼 리소스 투입 없이 일관된 정책 유지.

### 🫀 리포트 = 심박 신호

일일 리포트는 결과물이자 **자동화가 살아있다는 증거**입니다.

- **오늘 리포트가 없다 = 장애**입니다. cron/러너/인증 중 하나가 멈춘 것이므로 §7.1 점검 절차를 따르세요.
- 실행 중 일부 단계(audit/reorganize)가 실패해도 리포트는 생성됩니다. 부분 실패는 리포트 본문 §5 경고란과 §7 기계 부록의 `advisories`에 기록되며, 이 경우 실패 알림(notify-failure)은 울리지 않습니다(exit code는 리포트 POST 성패로만 결정).
- 리포트 POST 자체가 실패해야 비로소 exit 1 → Slack/Email 알림이 발송됩니다.

---

## 1. 아키텍처 한눈에

```
┌─────────────────────────────────────────────────────────────────────┐
│ 작업자                                                              │
│  • 평소처럼 Confluence UI에서 페이지 드래그                          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Confluence Cloud (AA 스페이스 · 데이터 저장소)                       │
│  • 작업자의 페이지 이동(부모 변경)이 그대로 저장됨                   │
│  • last-parent-* / is-folder / human-classified 라벨 보유            │
│    (라벨을 붙이는 주체는 Confluence가 아니라 아래 audit 단계)        │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ GitHub Actions (KST 09:00 매일 cron + workflow_dispatch 수동)       │
│  ┌────────────────────────────────────────┐  ┌───────────────────┐  │
│  │ daily-report (단일 프로세스)           │→ │ migrate           │  │
│  │  1. audit: 휴먼 이동 감지·라벨 스냅샷  │  │ SD→AA 이관 본체   │  │
│  │  2. reorganize: 분류 체인·자동 이동    │  └───────────────────┘  │
│  │  3. report: Confluence 리포트 POST     │           ↓             │
│  │     (위 1·2가 실패해도 반드시 실행)    │  ┌───────────────────┐  │
│  └────────────────────────────────────────┘  │ notify-failure    │  │
│                                              │ (실패 시만)       │  │
│                                              └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Confluence Cloud > AA 스페이스 > "자동화 리포트" 폴더                │
│  • auto_report_{YYMMDD}_{HHMM} 페이지 1장/일 (심박)                  │
│  • bot-report·auto-report 라벨, 31일 초과분 자동 삭제                │
└─────────────────────────────────────────────────────────────────────┘
```

> **2026-07 변경 이력**: 이전에는 `audit-aa` job이 `config/classification_decisions.json` 변경분을 GitHub Auto-PR(`peter-evans/create-pull-request`)로 쌓고 관리자 머지를 기다리는 구조였습니다. 머지가 지연되며 학습 경로가 막히고 실행 상태 신호가 없다는 문제가 확인되어, 출력 채널을 **Confluence 일일 리포트**로 전환하고 Auto-PR은 제거했습니다. 워크플로우 `permissions`도 `contents: write`+`pull-requests: write`에서 **`contents: read`**로 축소했습니다.

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
| `CONFLUENCE_EMAIL` | Confluence 계정 이메일 (daily-report/migrate) | 본인 Atlassian 계정 |
| `CONFLUENCE_TOKEN` | Confluence API 토큰 (daily-report/migrate) | https://id.atlassian.com/manage-profile/security/api-tokens |
| `ANTHROPIC_API_KEY` | Claude API 키 — 분류 체인 3단계 (daily-report/migrate). 미등록 시 rule-only 모드로 동작 | https://console.anthropic.com/ |
| `SLACK_WEBHOOK_URL` | 실패 알림 Slack 웹훅 (notify-failure) | Slack Incoming Webhooks |
| `EMAIL_USERNAME` | 실패 알림 발송 Gmail 계정 (notify-failure) | Gmail |
| `EMAIL_PASSWORD` | Gmail 앱 비밀번호 (notify-failure) | Google 계정 → 앱 비밀번호 |
| `NOTIFY_EMAIL_TO` | 실패 알림 수신자 (notify-failure) | — |

> ℹ️ 하단 4개 notify Secret은 실패 알림 전용입니다. 미등록해도 자동화 본체는 정상 동작하며, 실패 시 알림만 누락됩니다.

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

러너가 꺼져 있으면 cron이 silent fail — **오늘 리포트가 없는 것으로 감지**됩니다(§7.1).

### 2.5 첫 실행 (수동 트리거 권장)

cron을 기다리지 말고 Actions 탭에서 `Confluence AA Space Automation` → Run workflow로 수동 실행:

1. `daily-report` job → 로그에서 audit/reorganize 결과와 `Report posted: <URL>` 확인
2. Confluence AA 스페이스에 **"자동화 리포트" 폴더**와 그 아래 `auto_report_{YYMMDD}_{HHMM}` 페이지가 생겼는지 확인
3. `migrate` job → 로그에서 페이지 이관 결과 확인

모두 성공하면 세팅 완료.

---

## 3. 운영 사이클 (일상)

### 3.1 매 KST 09:00 자동 실행

```
UTC 00:00 = KST 09:00 (cron: '0 0 * * *')
```

> ⚠️ GitHub `schedule` 이벤트는 **기본 브랜치(default branch, 현재 `main`)** 의 워크플로우 파일 기준으로만 발생합니다. 다른 브랜치에서 워크플로우를 고쳐도 main에 머지되어야 cron에 반영됩니다.

| Job | 하는 일 | 실패 시 |
|------|--------|---------|
| `daily-report` | AA 전체 페이지 훑기 → audit(휴먼 이동 감지·`last-parent` 스냅샷) → reorganize(분류 체인·자동 이동) → **Confluence 일일 리포트 POST**. audit/reorganize가 중간에 실패해도 리포트 POST는 반드시 시도 | 리포트 POST 실패 시에만 `notify-failure` 발송 |
| `migrate` | SD 등 원본 스페이스에서 AA로 신규 페이지 이관 | `notify-failure` Slack/Email 발송 |
| `notify-failure` | 위 job 실패 시 Slack + Email 발송 (`if: failure()`) | — |

### 3.2 휴먼 이동 자동 감지 메커니즘

감지는 **실시간 이벤트가 아니라, 매일 cron이 도는 시점의 폴링(라벨 스냅샷 diff)** 입니다.
Confluence의 자동 기능·웹훅이 아니라, **audit 단계 자신이 라벨을 찍고 다음 실행에서 비교**합니다.

동작 원리 (`scripts/audit_aa_space.js`):

1. audit 실행마다 모든 AA 페이지의 **현재 부모 폴더 ID**를 `last-parent-{현재parentId}` 라벨로 저장합니다 (`stampLastParent`, 기존 `last-parent-*` 라벨은 삭제 후 교체). → "이번 실행 시점의 부모" 스냅샷.
2. 다음 audit 실행에서 페이지의 `last-parent-{oldId}` 라벨(=지난 실행 시점 부모)과 현재 `parentId`를 비교합니다 (`detectMove`).
3. 두 값이 다르면 → 그 사이에 사람이 UI에서 페이지를 옮긴 것으로 판단.
4. 그 이동이 기존 규칙과 어긋나거나 규칙이 모르는 경우 → 사람 의도를 우선으로 인정해 학습합니다 (`commitDecision`). **CI 실행에서는 체크아웃이 매일 리셋되므로 로컬 설정 파일에 쓰지 않고**(`CI=true` 게이트), 감지된 이동은 일일 리포트에 기록됩니다. 로컬 실행(`npm run audit:aa`)은 예전처럼 `config/classification_decisions.json`에 직접 기록합니다.
5. 현재 부모로 `last-parent` 라벨을 갱신 (다음 비교용 스냅샷 — CI에서도 항상 실행되어 같은 이동을 재보고하지 않음).

예시:
```
[1일차 audit] "덴탈AI 보고서" 페이지 부모=A → last-parent-A 라벨 저장
        ↓
[작업자가 UI에서 A → "26 보고서"(B) 폴더로 드래그]   ← 이 시점엔 시스템 동작 없음
        ↓
[2일차 audit (KST 09:00)] last-parent-A 라벨 vs 현재 부모=B 비교 → 이동 감지
        ↓
사람 의도로 판단 → 일일 리포트에 기록 + last-parent-B 로 갱신
        ↓
[3일차] last-parent-B == 현재 부모=B → 재보고 없음
```

**작업자가 추가로 알려줘야 하는 경우는 거의 없습니다.**

**감지 한계**
- 실시간이 아니라 매일 1회(cron) 또는 수동 실행 시점에 감지됩니다.
- 두 실행 사이에 옮겼다 제자리로 돌려놓으면(net-zero 이동) 감지되지 않습니다.
- 폴더 자체 이동은 직접 감지되지 않습니다(`last-parent`는 페이지 전용). 단, 안의 페이지들은 다음 실행에서 부모 변경으로 감지됩니다. (§5.4 참고)

### 3.3 일일 리포트 읽는 법

Confluence AA 스페이스 → **"자동화 리포트"** 폴더에 매일 1장씩 쌓입니다.

| 섹션 | 내용 |
|------|------|
| 헤더 | 생성 시각(KST) info 매크로 |
| §1 요약 | AA 총 페이지, 최상위 고아, 미분류, 자동 이동(루프 B), 실행 경고, 관리자 조치 필요 — **전일 대비 delta** |
| §2 루프 A 상세 | Phase 2 예정 (자리표시) |
| §3 루프 B 이동 로그 | 자동 이동된 페이지 / from→to / 판정 소스(rule·claude·fallback) / 사유 / seen(연속 관측 횟수) + 이동 실패 목록 |
| §4 AI 권고 | Phase 2 예정 (자리표시) |
| §5 관리자 알림 | 조건부 표시: 최상위 고아 존재 / 이동 실패 / 실행 경고(advisory)가 있을 때만 warning 매크로 |
| §6 실행 메타 | runId(`{GITHUB_RUN_ID}#{ATTEMPT}`), mode(ci/local), 정책 해시, 코드 SHA, 분류 모델 |
| §7 기계 부록 | `<!-- aa-report-appendix:v1 -->` 마커 + JSON code 매크로. 다음 날 리포트가 이 부록을 읽어 delta·seenCount를 계산합니다. **사람이 편집하면 다음 delta가 "—"로 우아 퇴화** (크래시 없음) |

**제목 규칙**: `auto_report_{YYMMDD}_{HHMM}` (KST). 같은 시각 충돌 시 `_2`, `_3` 접미.

**보관 정책**: 31일 초과 리포트는 매일 실행 시 자동 삭제됩니다. 단, 최근 7개는 무조건 보존(연속 실패로 오래된 리포트만 남았을 때 전량 삭제되는 사고 방지). 관리자가 Confluence UI에서 개별 페이지를 수동 삭제해도 무방합니다(삭제해도 3.4의 보호 라벨 정책상 봇이 재생성하지 않음 — 다음 날 새 리포트가 올 뿐).

### 3.4 보호 라벨 (절대 제거하지 말 것)

`scripts/utils/migration_utils.js`의 `isProtectedLabel()` 함수로 보호됩니다:

- `is-folder` — 폴더 식별
- `human-classified` — 휴먼 정책으로 확정된 페이지
- `last-parent-*` — 직전 부모 폴더 추적용 (자동 감지의 핵심)

봇 전용 라벨(문서 페이지에 수동 부착 금지):

- `bot-report` — 봇 생성물 표시. audit/reorganize가 이 라벨을 보면 **자기 배제**(스킵)합니다. 리포트 무한 재처리 방지의 실질 방어선입니다.
- `auto-report` — 일일 리포트 표시. 직전 리포트 조회·prune 대상 선정에 사용됩니다.

이 라벨들을 임의로 제거하면 자동 감지 체인이 끊기거나 봇이 자기 산출물을 재처리할 수 있습니다.

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
3. 아침에 "자동화 리포트" 폴더의 오늘 리포트에서 §1 delta와 §5 알림만 확인

### 5.2 새 AA 폴더를 만들었을 때

분류 체인이 새 폴더를 모르면 fallback으로 빠집니다(미분류 행 → 리포트 §5에 고아/미분류 수치로 표시).

조치:
1. `setup_aa_space.js`로 폴더 생성했는지 확인
2. 폴더 제목이 rule 패턴과 일치하면 자동 인식됨
3. 패턴에 없으면 `config/classification_decisions.json`에 직접 매핑 추가

### 5.3 분류가 잘못된 경우

1. Confluence UI에서 페이지를 올바른 폴더로 직접 드래그
2. 다음 cron에서 자동 정정됨 (휴먼 이동 우선, 리포트에 기록)
3. 또는 `config/classification_decisions.json`에 매핑 추가

### 5.4 라벨이 안 붙는 폴더 이동

`last-parent-*` 라벨은 **페이지**에만 부여됩니다. 폴더 자체를 이동할 때는 자동 감지 안 됨.

조치: 폴더 이동은 수동으로 하되, 안의 페이지들이 다음 audit에서 부모 변경 감지되어 자동 처리됩니다.

---

## 6. 운영 명령어 (로컬)

| 명령 | 용도 |
|------|------|
| `npm run report:aa` | **일일 리포트 1회 실행** (audit+reorganize+리포스트 POST, 로컬 검증용) |
| `npm run report:aa:dryrun` | 리포트 렌더 결과만 stdout, Confluence 쓰기 0건 (가장 안전한 점검) |
| `npm run audit:aa` | audit 단독 실행 (로컬에서는 `classification_decisions.json` 기록) |
| `npm run reorganize:aa` | reorganize 단독 실행 |
| `npm run reorganize:aa:dryrun` | 실제 변경 없이 시뮬레이션 |
| `npm run migrate:all` | migrator 한 번 실행 |
| `npm run ci:local` | **Actions 전체 로컬 재현** (daily-report → migrate 순차, setup·notify 제외) |
| `npm run ci:local:dryrun` | 읽기 전용 재현 — 리포트 렌더까지만. migrator는 dry-run 미지원이라 이관 단계는 스킵 |
| `npm run check:llm` | `.env` 기반 LLM 연결 점검 (ping + 분류기 smoke, Confluence 호출 없음) |

> 로컬 실행 전 `.env`에 키가 있어야 함. Actions 환경변수(`secrets.*`)와 별개.

**`.env` 키 안내**

| 키 | 필수 | 용도 |
|----|------|------|
| `CONFLUENCE_EMAIL` | ✅ | Confluence 로그인 이메일 (Basic Auth) |
| `CONFLUENCE_TOKEN` | ✅ | [Atlassian API 토큰](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ANTHROPIC_API_KEY` | ⭕ 선택 | 분류 체인 3단계(AI) 활성화. 없으면 rule 기반만 동작 — 리포트 §6에 `off(rule-only)`로 표시 |
| `ANTHROPIC_MODEL` | ⭕ 선택 | 분류기(`claude.js`) 호출 모델 오버라이드. 미설정 시 `claude-haiku-4-5-20251001`. 사내 게이트웨이 사용 시 해당 모델명(예: `qwen3.8-max-preview`) 필수 |
| `ANTHROPIC_BASE_URL` | ⭕ 선택 | LLM 게이트웨이 URL. SDK가 자동 판독 (코드에서 별도 참조하지 않음) |

> `CI`, `GITHUB_RUN_ID` 등은 Actions가 자동 주입 — **로컬에서는 설정 금지**. `CI=true`면 로컬 결정 로그(`classification_decisions.json`) 기록이 스킵됩니다.

### 테스트 실행

```bash
npm test    # = node --test "tests/**/*.test.js"
```

39/39 PASS가 정상.

---

## 7. 트러블슈팅

### 7.1 오늘 리포트가 없다 (심박 정지)

가장 먼저 의심할 것 순서:

1. **Self-hosted runner 오프라인** — Settings → Actions → Runners 확인. 러너가 죽으면 cron 자체가 실행되지 않고 알림도 없습니다(silent fail).
2. **Actions 탭에 오늘 실행 기록이 있는가**
   - 기록 없음 → cron 미발동. 워크플로우 파일이 default branch(`main`)에 머지되어 있는지, `on.schedule` 문법이 맞는지 확인 (`'0 0 * * *'` — UTC 00:00 = KST 09:00).
   - 기록 있고 실패 → `daily-report` job 로그에서 `API Error [401/403]` 확인 → §7.2.
3. **실행은 됐는데 페이지가 없다** — 로그에서 `Report posted` 또는 POST 재시도 실패 메시지 확인. Confluence 검색(`label:auto-report`)으로 제목 오탐 여부 확인.

### 7.2 daily-report가 401/403 반환

`CONFLUENCE_EMAIL` 또는 `CONFLUENCE_TOKEN` Secret 만료/오류.

조치: Secrets 갱신 후 `workflow_dispatch`로 재실행.

### 7.3 notify-failure가 안 온다

`notify-failure` job은 `self-hosted` 러너에서 실행됩니다. 러너가 죽어 있으면 발송 안 됨.

대안: workflow YAML에서 해당 job의 `runs-on`을 `ubuntu-latest`로 변경 (PR 필요).

### 7.4 리포트에 §5 경고 / advisories가 떴다

리포트 POST는 성공했지만 audit/reorganize 일부가 실패한 "부분 실패"입니다(알림은 울리지 않음).

조치: 리포트 §7 기계 부록의 `advisories` 배열과 §3 이동 실패 표에서 실패한 페이지 ID·에러 메시지 확인 → 해당 페이지 권한/존재 여부 확인 → 다음 날 리포트에서 재시도됨(지속되면 수동 처리).

### 7.5 라벨이 사라졌다

`migration_utils.js`의 `isProtectedLabel()` 가드를 우회하는 코드가 들어갔을 수 있음.

조치:
1. `git log`에서 최근 변경 확인
2. `git grep -n "toRemove" scripts/utils/migration_utils.js`로 syncLabels 로직 점검
3. 필요 시 수동으로 보호 라벨 재부여

### 7.6 prune이 리포트를 잘못 지운 것 같다

이중 안전장치(제목 정규식 `auto_report_{YYMMDD}_{HHMM}` 매칭 + 최근 7개 무조건 보존)로 오폭 가능성은 매우 낮습니다. 확인:

1. 삭제된 페이지가 정말 `auto_report_*` 제목이었는지 (아닌 제목은 절대 삭제되지 않음)
2. `auto_report_260231_0900`처럼 부정확한 날짜의 제목은 파싱 실패로 prune 대상에서 영구 제외됨 — 수동 삭제 필요

---

## 8. 관련 문서

- 일일 리포트 스펙: [`docs/spec_auto_report.md`](spec_auto_report.md) (DRAFT v0.2)
- 개선 논의 배경: [`docs/ideation_for_automation.md`](ideation_for_automation.md)
- 컨텍스트: [`CLAUDE.md`](../CLAUDE.md), [`reference/ToDo.md`](../reference/ToDo.md)

---

## 9. 변경 이력

| 날짜 | 변경 |
|------|------|
| 2026-07-28 | 초안 작성 (Plan `2026-07-28-confluence-migrator-revamp` 완료 후) |
| 2026-07-29 | §1·§3.2 감지 메커니즘 사실관계 정정("Confluence 자동 라벨" → audit 봇의 `last-parent` 스냅샷 폴링 + 감지 한계 명시), §2.2 notify Secret 4종 보완, §3.1 cron의 default-branch 기준 명시, §3.4·§7.5 함수명(`isProtectedLabel`)·로그 문자열 정정 |
| 2026-07-29 | **출력 채널 전환**: GitHub Auto-PR 제거(`peter-evans/create-pull-request` 삭제, `permissions: contents: read` 축소) → Confluence 일일 리포트(`scripts/report_aa_daily.js`)로 대체. `audit-aa`+`reorganize-aa` 2 job → `daily-report` 1 job 통합(심박 보장: 부분 실패에도 리포트 POST). 리포트 폴더 "자동화 리포트"·라벨 `bot-report`/`auto-report`·보관 31일(최근 7개 보존) 정책, `stampLastParent` stale 라벨 누적 버그 수정 반영. 테스트 9 → 36개 |
| 2026-07-29 | **홈페이지 보호**: dry-run 검증에서 스페이스 홈페이지(`parentId=null`)가 자동 이동 대상으로 분류(fallback → 미분류 폴더)되는 결함 발견 → `runReorganize`에 홈페이지 명시 제외 + 홈페이지 ID 미해결 시 이동 전체를 스킵하는 degraded 모드(리포트 §5 경고로 표면화) 추가. 회귀 테스트 3건(`tests/report/reorganize.test.js`). 테스트 36 → 39개 |
| 2026-07-29 | **LLM env 점검**: `npm run check:llm` 추가(`scripts/check_llm_env.js` — ping + 분류기 tool_use 스모크, Confluence 호출 없음). `.env` 점검 중 분류기 모델 하드코드 결함 발견 → `claude.js`가 `ANTHROPIC_MODEL`을 오버라이드로 수용(기본 `claude-haiku-4-5-20251001`). 사내 Alibaba MaaS 게이트웨이 + `qwen3.8-max-preview` 동작 확인. `.env.sample` 키 보강(MODEL/BASE_URL + Actions 전용 변수 경고) |
| 2026-07-29 | **Migrator 멱등 동기화**: `migrator.js`가 `createPage` 전 AA 동명 페이지를 조회(`findPageByTitleInAA`, CQL `title=`) → 존재하면 400 title-collision 대신 **제자리 덮어쓰기**(본문·배너·첨부·라벨 갱신, 폴더 이동 없음 — 재배치는 audit/reorganize 루프 책임). 룩백 윈도우 내 재수정된 페이지(월간 MPS 등)의 반복 충돌 해소. `require.main` 가드·export 추가로 단위 테스트 가능화, 테스트 7건(`tests/migrator/`) 포함 39 → 46개 |
