# confluence_mgt_agent 사용 가이드

> **대상**: 이 자동화의 *운용자* — 매일 리포트를 확인하고, 분류 정책을 개선하고, 로컬에서 검증하는 사람.
> 초기 인프라 셋업(Secrets, self-hosted 러너)은 [`docs/AUTOMATION_GUIDE.md`](AUTOMATION_GUIDE.md) 참고.
> 진행 상황·다음 작업은 [`reference/ToDo.md`](../reference/ToDo.md), 분류 정책의 근거는 [`reference/classification_rules.md`](../reference/classification_rules.md).

| 기준 시점 | 2026-07-30 |
|---|---|
| 분류 체인 | `rule → inline-llm → fallback` (3단계, 단일화 완료) |
| 테스트 | `npm test` — node:test 137 PASS / fail 0 |
| 일일 리포트 | Phase 1 + 작업 5·8·9 반영 (심박 + 자동 이동 + AI 권고판 + 미매칭 추적) |
| LLM | 공식 Anthropic SDK, 모델 `claude-haiku-4-5-20251001` (env `ANTHROPIC_MODEL`로 override) |

---

## 0. 한 줄 요약

**매일 KST 09:00, GitHub Actions가 AA 스페이스를 감사·정리하고 그 결과를 Confluence "자동화 리포트" 폴더에 리포트 페이지 1장으로 남긴다. 이 페이지가 곧 시스템의 심박(heartbeat)이다 — 오늘 리포트가 없으면 장애다.**

```
                         ┌─────────────────────────────────────────────┐
   GitHub Actions        │  daily-report job  (node scripts/report_aa_daily.js)
   cron 0 0 * * * UTC ───┤   ├─ audit      (감사: 자리이탈·휴먼이동 감지)
   (= KST 09:00)         │   ├─ reorganize (자동 이동: rule/llm/fallback 체인)
   + 수동 dispatch       │   ├─ render     (§1~§7 리포트 HTML + JSON 부록)
                         │   └─ POST ──────► Confluence AA "자동화 리포트" 폴더
                         └──────────────┬──────────────────────────────┘
                                        │ needs
                         ┌──────────────▼──────────────┐
                         │  migrate job                 │  ← SD/WND/Device/SmileArch → AA
                         │  (node scripts/migrator.js)  │     멱등 동기화(제자리 업데이트)
                         └──────────────┬──────────────┘
                                        │ if: failure()
                         ┌──────────────▼──────────────┐
                         │  notify-failure              │  → Slack + Email
                         └─────────────────────────────┘
```

---

## 1. 전체 워크플로우

### 1.1 어떻게 트리거하나

| 방법 | 언제 | 명령/경로 |
|---|---|---|
| **정시 cron** (기본) | 매일 KST 09:00 (UTC 00:00) | GitHub Actions가 자동 실행. 사람이 할 일 없음 |
| **수동 디스패치** | 지금 당장 돌리고 싶을 때 | GitHub 저장소 → **Actions 탭 → "Confluence AA Space Automation" → Run workflow** |
| **로컬 실행** | 코드 변경 후 검증, 디버깅 | `npm run report:aa:dryrun` (안전) → `npm run report:aa` (실실행) |

cron이 도는 러너는 `self-hosted`이고, 워크플로우 전체 권한은 `contents: read`(읽기 전용)로 잠겨 있다 — 이 워크플로우는 PR을 만들지도, 코드를 푸시하지도 않는다.

### 1.2 하루 실행 파이프라인

`daily-report` → `migrate` → (실패 시에만) `notify-failure` 순서다.

1. **daily-report** — 한 프로세스 안에서 감사(audit) → 자동 정리(reorganize) → 리포트 렌더 → Confluence POST.
   감사나 정리 단계가 **크래시해도 리포트 POST는 무조건 실행**된다(부분 실패는 리포트 본문 경고로 기록).
   종료 코드는 오직 *리포트 POST 성공 여부*로만 결정된다. POST 실패 → exit 1 → 알림 발동.
2. **migrate** — daily-report 성공 후에만 실행. 레거시 스페이스 페이지를 AA로 멱등 이관(§1.5).
3. **notify-failure** — 위 둘 중 하나라도 실패해야만 동작. Slack 웹훅 + 이메일.

> rate limit 참고: Confluence Cloud 한도는 5000 req/h. 일일 리포트 1회는 페이지 목록 공유 캐시 덕분에 약 250–300 req. 여유 충분.

### 1.3 어디서 결과를 보나 — 일일 리포트

Confluence **AA 스페이스 → "자동화 리포트" 폴더** (왼쪽 트리). 폴더가 없으면 첫 실행 때 자동 생성된다.

| 속성 | 값 |
|---|---|
| 제목 | `auto_report_{YYMMDD}_{HHMM}` (예: `auto_report_260730_0900`) |
| 제목 충돌 | 같은 시각 제목이 이미 있으면 `_2` 접미 (같은 날 재실행은 정상 — 놀랄 필요 없음) |
| 라벨 | `bot-report` + `auto-report` (자기 배제·보관·조회에 사용) |
| 보관 | **31일 초과 자동 삭제**, 단 최근 7개는 무조건 보존 (삭제 전 제목 정규식 이중 확인) |
| 심판 규칙 | **오늘 날짜 리포트가 없다 = 장애**. Actions 탭과 알림부터 확인 |

### 1.4 리포트 읽는 법 (§1 ~ §7)

| 섹션 | 내용 | 보면 뭘 알 수 있나 |
|---|---|---|
| **§1 요약** | AA 페이지 수, 최상위 고아, 미분류 수, 자동 이동 수 + **전일 대비 delta** | 시스템 상태 한눈에. 수치가 튀면 이유 추적 |
| **§2 루프 A — 휴먼 결정 학습** | 사람이 UI에서 직접 옮긴 이동의 학습 기록 (Phase 2-B 자리표시) | 현재는 자리표시. 활성화되면 휴먼 의도 학습 데이터가 쌓임 |
| **§3 루프 B — 자동 이동 로그** | 이번 실행에 봇이 옮긴 페이지 표 + **실패한 이동 표** | 뭐가 왜 이동했는지, 실패 건은 없는지 |
| **§4 AI 권고판** | **사람이 결정할 안건**. 자리이탈 의심 표(페이지/현재 폴더/추천 폴더/신뢰도/근거/seen/기간) + KB-unknown 권고 (아무도 매칭 못한 항목) | 여기가 매일 봐야 할 핵심. 봇은 제안만 하고, 이동은 사람이 한다 |
| **§5 관리자 알림** | 조건부 — 최상위 고아 존재, 이동 실패, **룰 변경 감지(작업 5)**, 권고 누적 등 | 비어 있으면 "할 일 없음". 뭐가 있으면 우선 처리 |
| **§6 실행 메타** | runId, mode(ci/local), policyHash, gitSha, 모델 | 어떤 코드·어떤 룰 해시로 실행됐는지. 재현의 열쇠 |
| **§7 기계 부록** | JSON (CDATA, 마커 `<!-- aa-report-appendix:v1 -->`). 항목별 fingerprint·seenCount·firstSeen | 다음 날 실행이 이걸 읽어 delta와 seenCount를 계산. 사람이 편집하면 파싱 실패 → delta "—" 처리(크래시 없음) |

### 1.5 이관(migration)은 어떻게 처리되나

`scripts/migrator.js` (CI에서는 `migrate` job, 로컬에서는 `npm run migrate:all`)가 레거시 스페이스(**SD / WND / Device / SmileArch**)의 페이지를 AA로 옮긴다. **AA는 절대 건드리지 않는다.**

핵심은 **멱등성**이다:

- 이관 전에 `findPageByTitleInAA`로 AA에 동명 페이지가 이미 있는지 찾는다.
- 이미 있으면 새로 만들지 않고 **제자리 동기화** — 본문·배너·첨부·라벨만 업데이트.
- 그래서 몇 번을 다시 돌려도 중복 페이지가 생기지 않는다. 이관 후보는 `config/migration_candidates.json` 기준.
- 언제 쓰나: 레거시 스페이스 원문이 수정되어 AA 사본을 다시 동기화하고 싶을 때. 평일 cron이 매일 자동으로 한 번씩 돌린다.

### 1.6 분류가 어려우면 어떻게 되나 — 핵심 흐름

페이지 하나를 분류할 때 체인은 **`rule → inline-llm → fallback`** 순서로 시도한다 (`scripts/utils/classification_provider.js`).

```
페이지
  │
  ├─① rule: config/analysis_rules.json 정규칙/조상 매칭 → 확정 (빠름·무료)
  │    ↓ 실패
  ├─② inline-llm: Anthropic SDK, tool_use(select_folder)로 폴더 선택
  │    ├─ 성공 → {ok, folderId, labels, reason}
  │    └─ 실패/예외 → 흡수 후 {ok:false, source:'miss'}  (크래시 전파 안 함)
  │    (ANTHROPIC_API_KEY 없으면 이 단계 자체를 skip)
  │    ↓ 실패
  └─③ fallback: "미분류" 폴더로 이동 + `needs-review` 라벨 부착
       (미분류 폴더 = 제목이 '미분류'·'분류 보류'·'Unsorted' 중 하나인 is-folder)
```

**여기서 끝나지 않는다.** fallback된 페이지와 매칭 실패 항목은 두 줄의 추적망에 걸린다:

1. **미매칭 추적 (작업 8)** — 매칭에 실패한 페이지(폴백행 포함, `catch_all_known`도 포함)는 리포트 **§7 부록에 `kind:'unmatched'`** 로 기록되고, SSOT 파일 [`reference/unmatched_pages.json`](../reference/unmatched_pages.json)에 **append-only·원자 쓰기**로 누적된다. 항목마다 fingerprint(sha1 앞 12자)와 seenCount가 붙어 "며칠째 매칭 실패 중"인지가 보인다.
2. **AI 권고판 (작업 9)** — 다음 날 리포트 **§4** 에 두 종류의 권고가 뜬다:
   - **misplacement-suspect (자리이탈 의심)**: "이 페이지는 지금 A 폴더에 있는데 B 폴더가 맞아 보인다" — 표로 렌더(페이지/현재 폴더/추천 폴더/신뢰도/근거/seen/기간).
   - **kb-unknown**: 룰도 KB도 답을 못 낸 항목 → "정책 결정 필요" 권고.

**원칙: 봇은 자동 이동하지 않는다. §4는 어디까지나 권고판이고, 최종 결정은 사람이 한다.**
사람이 Confluence UI에서 페이지를 드래그해 옮기면, 다음 날 감사(audit)가 `last-parent-*` 라벨로 이동을 감지하고 **휴먼 의도를 우선**한다(사람이 옮긴 자리 = 정답으로 학습).

신뢰도(confidence)는 LLM이 내놓은 근거 문구의 어휘 가중치로 계산한다 (기준 0.5):

| 어휘 | 가중치 |
|---|---|
| 정확히 / 일치 / 정확 / 매칭됨 | **+0.35** |
| 유사 / probably / likely | +0.20 |
| maybe / could be / 아마 / 모호 | +0.05 |
| 불확실 / unknown / 분류불가 | **−0.20** |

결과는 0~1로 clamp, **≥ 0.5만 부록에 진입**하고 < 0.5는 억제된다. **seenCount ≥ 3회**(≈ 3영업일 연속 같은 권고)는 "진짜 애매하다"는 신호다 — 룰로 승격할 1순위 후보다 (§2.3).

### 1.7 운용자의 일상 시나리오

1. **아침에 리포트 확인** — "자동화 리포트" 폴더에 오늘 리포트가 있나? 없으면 장애 대응(§5.4).
2. **§5 비어 있나?** — 비어 있으면 통과. 알림이 있으면 해당 항목 처리.
3. **§4 권고판 훑기** — 신뢰도 높고 근거 타당한 권고는 UI에서 직접 이동(= 휴먼 결정, 자동 학습됨). 3일 이상 반복되는 항목은 룰 추가 검토(§2.3).
4. **§1 수치 이상?** — 미분류 수 급증 → 새 유형의 페이지 유입 신호. §7 부록의 unmatched에서 패턴 확인 → 룰 추가.

---

## 2. 정책 업데이트와 개선

### 2.1 규칙의 SSOT와 문서 역할

| 파일 | 역할 | 바꾸는 법 |
|---|---|---|
| [`config/analysis_rules.json`](../config/analysis_rules.json) | **분류 규칙 SSOT** — title_patterns(정규식), ancestor_contains, exclude, labels_template | PR + 리뷰. 버전 범프 불필요 |
| [`reference/classification_rules.md`](../reference/classification_rules.md) | 체인·룰 정책의 **해설서(체인지 매뉴얼)** — 의도·변경 절차·신뢰도 정책 | 룰 변경 PR에 함께 업데이트 |
| `reference/unmatched_pages.json` | 미매칭 누적 SSOT (작업 8) — **코드가 관리. 사람이 손편집 금지** | 자동 갱신 |
| `config/migration_candidates.json` | 이관 후보 | PR |

### 2.2 룰 변경 절차 (단계별)

1. **신호 포착** — §7 부록 / `unmatched_pages.json` / §4 권고판에서 반복 항목 발견 (seenCount ≥ 3이 기준선).
2. **룰 작성** — `config/analysis_rules.json`에 패턴 추가/수정. 기존 항목과 충돌하는지 `tests/utils/classification_provider.test.js` 기준으로 확인.
3. **테스트** — 새 패턴에 대한 node:test 케이스 추가 (TDD: 먼저 실패하는 테스트 → 구현 → 통과). `npm test` 전체 green 확인.
4. **문서 동기화** — `reference/classification_rules.md` 해당 섹션에 의도 기록.
5. **PR 머지** — **배포 절차가 따로 없다.** 머지되면 다음 날 KST 09:00 cron이 변경된 룰로 **AA 전체를 자동 재감사**한다.
6. **효과 확인** — 다음 날 리포트 §6의 `policyHash`가 바뀌었는지, §5에 "⚠️ 룰 변경 감지" 알림이 떴는지, 그리고 unmatched/미분류 수치가 줄었는지 확인.

> 다른 변경 유형의 절차 요약: 체인 단계 변경 → `classification_provider.js` + `classifiers/engine.js` + 테스트 / 모델 변경 → `ANTHROPIC_MODEL` env / 키 회전 → GitHub Secrets / 미매칭 신규 룰 추가 → 위 1~6.

### 2.3 데이터 기반 개선 사이클 (이 자동화의 본체)

```
   리포트 §7 부록 / §4 권고판 관찰
              │
   반복되는 매칭 실패·자리이탈 의심 발견 (seenCount ≥ 3)
              │
   analysis_rules.json 에 명시 룰 추가 (PR)
              │
   다음 날 cron 재감사 ──► rule 단계에서 즉시 확정 처리
              │
   unmatched 감소 / §4 권고 소멸 확인 ──► (안 줄면 패턴 재설계)
              └────────────────────────────┘
```

- 룰(①단계)은 무료·즉시·결정적이므로, **LLM(②단계)까지 갈 필요가 없는 패턴은 룰로 흡수하는 것이 정방향 개선**이다.
- 반대로 너무 좁은 룰은 오탐지를 낸다. `exclude` 조건과 ancestor 맥락을 함께 쓰는 것을 권장.
- **정책 승격**: 애매해서 §4에 떠 있던 권고가 사람 결정에 의해 한 폴더로 반복 정착되면, 그 결정 자체가 룰의 근거다. (이 "반복 항목 → 명시 룰 변환"의 반자동 워크플로우는 작업 10 후보로 미구현 — §4.1)

### 2.4 룰 변경 자동 감지 (작업 5)

`policyHash` = sha256(`analysis_rules.json` + `classification_decisions.json`) 앞 8자. 실행마다 §6에 찍히고, 직전 리포트와 다르면 **§5에 "⚠️ 룰 변경 감지" 알림**이 뜬다. 즉:

- 내가 머지한 룰 변경이 실제로 반영됐는지 **해시 하나로 검증** 가능.
- 의도치 않은 해시 변경이 보이면 누군가 config를 건드렸다는 신호.

### 2.5 지켜야 할 원칙 (변경 금지선)

- **봇의 자동 이동은 기존 자리이탈 교정(루프 B)에만 쓰고, §4 권고판 기반 자동 이동은 추가하지 않는다** — 판단은 사람 몫.
- **`.env`·API 키 커밋 절대 금지.** 키는 로컬 `.env`(개발 전용) 또는 GitHub Actions Secrets(`CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`, `ANTHROPIC_API_KEY`)으로만.
- **보호 라벨** 손편집 금지: `is-folder`(폴더 표시), `human-classified`(휴먼 결정), `last-parent-*`(이동 감지). 봇 전용 `bot-report`·`auto-report`도 사람이 붙이거나 떼지 말 것(자기 배제·보관이 깨짐).
- LLM 키가 없어도 시스템은 산다 — rule-only 후 fallback으로 격하될 뿐, 리포트 심박은 유지된다. 키 부재는 장애가 아니라 능력 축소다.

---

## 3. 로컬 테스트와 개선

### 3.1 개발 환경 준비

```bash
git pull && npm install
```

`.env` (로컬 전용, **커밋 금지**)에 값만 넣고 내용은 열어보지 않는 것을 원칙으로:

```
CONFLUENCE_EMAIL=<본인 Atlassian 이메일>
CONFLUENCE_TOKEN=<Atlassian API 토큰>
ANTHROPIC_API_KEY=<선택 — 없으면 LLM 단계 skip, rule+fallback만 동작>
```

LLM 연결만 따로 점검: `npm run check:llm`.

### 3.2 단위 테스트와 TDD 규약

```bash
npm test          # node --test "tests/**/*.test.js"  →  현재 137 PASS / fail 0
```

- 프레임워크: `node:test` + `node:assert`. **모든 외부 의존(Confluence/LLM 호출)은 deps 주입**이 원칙이라 네트워크 없이 달린다.
- 새 코드는 **TDD(RED → GREEN → REFACTOR)**: 실패하는 테스트를 먼저 보고(RED), 최소 구현으로 통과(GREEN), 리팩터. "실패하는 걸 눈으로 확인 못 한 테스트는 그 테스트가 맞는지 증명되지 않은 것"이라는 규약.
- 버그 수정도 먼저 재현 테스트부터.

### 3.3 dry-run으로 안전 확인 (쓰기 0건)

| 목적 | 명령 | 확인할 것 |
|---|---|---|
| 일일 리포트 예행 | `npm run report:aa:dryrun` | stdout HTML에 §1~§7 완전 렌더, §7 CDATA JSON 유효, **Confluence 쓰기·삭제 0건** |
| 자동 정리 예행 | `npm run reorganize:aa:dryrun` | "would move" 목록 — 의도한 폴더로 가는지 |
| 전체 파이프라인 예행 | `npm run ci:local:dryrun` | CI와 동일한 흐름을 쓰기 없이 |
| AA 청소 예행 | `npm run clean:aa:dryrun` | 삭제 후보 목록 |

> 규율: **새 변경은 언제나 `*:dryrun` 먼저.** dry-run은 이동·POST·DELETE·라벨 부착이 일체 금지되어 있다.

### 3.4 실실행 검증 (로컬 1회)

```bash
npm run report:aa
```

- Confluence AA → "자동화 리포트" 폴더에 `auto_report_{YYMMDD}_{HHMM}` 페이지 생성 + `bot-report`·`auto-report` 라벨 확인.
- **즉시 재실행** → `_2` 접미 제목으로 두 번째 리포트, §1에 첫 리포트 대비 delta와 seenCount 변화가 찍히는지 확인 (부록 라운드트립 검증).
- 하위호환 점검: `npm run audit:aa`, `npm run reorganize:aa:dryrun`이 여전히 정상인지.
- 실제 CI 경로 확인은 Actions 탭에서 **workflow_dispatch** 수동 트리거로.

### 3.5 테스트 결과를 개선으로 닫는 법

| 관찰 | 해석 | 조치 |
|---|---|---|
| dry-run §4에 같은 권고가 3일+ 반복 | 룰 공백 | §2.3 사이클로 룰 추가 |
| §3 실패 표에 이동 실패 | API/권한/rate 이슈 | 실패 행의 reason → 트러블슈팅(§5.4) |
| §1 미분류 수 급증 | 새 유형 페이지 유입 | §7 부록 unmatched 패턴 → 룰 또는 폴더 신설 |
| §5 "룰 변경 감지"가 내 PR이 아닌데 등장 | config 무단 변경 의심 | git log로 config 변경자 추적 |
| 로컬 테스트 실패 | 회귀 | RED 재현 → 원인 수정 → GREEN, 머지 전 반드시 전체 green |

---

## 4. 앞으로 개선할 포인트

### 4.1 단기 (작업 10 후보)

1. **§2 루프 A 실데이터 활성화** — 지금은 자리표시("미실행"). 휴먼 이동 학습 데이터를 부록에 `kind:'move-a'`로 적재하는 배선은 준비되어 있다(Phase 2-B). 활성화되면 "사람이 반복해서 고치는 이동"이 데이터로 쌓여 룰 승격의 근거가 된다.
2. **정책 승격 워크플로우** — 반복 권고(seenCount ≥ 3)를 명시 룰 초안으로 변환하는 반자동 단계. 현재는 사람이 §4를 눈으로 보고 손으로 룰을 쓴다.
3. **seenCount ≥ 3 별도 강조** — 3영업일 이상 반복 권고는 §4/§5에서 시각적으로 구분(분류 규칙서 §8-3의 Phase 3+ 자리표시).
4. **PR 머지** — 현재 작업물(작업 5·8·9, `feature/phase1`)은 커밋·푸시 상태. `feature/phase1 → main` 머지는 운용자 판단 대기 중. 머지 후 workflow_dispatch로 실경로 검증.

### 4.2 중장기

5. **unmatched 만료/제거 정책** — `unmatched_pages.json`은 append-only라 무한 성장. 페이지 삭제·이관 완료 항목의 소멸 규칙이 없다(작업 8 잔여).
6. **비용 모니터링 + 샘플셋 비교** — LLM 호출 비용 추적과, 모델/프롬프트 변경 전후 품질을 잴 고정 샘플셋(분류 규칙서 §7 자리표시).
7. **폴더 생성 제안** — §4에서 카테고리 자체가 unknown인 경우 "추천 폴더" 대신 "폴더 생성 제안"을 내는 분기. 구조 설계가 선행돼야 한다.

### 4.3 Non-goals (폐기됨 — 다시 제안하지 말 것)

| 항목 | 상태 |
|---|---|
| Dify 워크플로우 | **폐기** (사내 토큰 만료와 무관하게 정책상). `dify/` 잔여 파일 무시 |
| 사내 LLM 게이트웨이 (qwen 등) | **폐기** (2026-07-30 운용자 명시 지시). 공식 Anthropic SDK 경로만 유지. 필요하면 운용자가 다시 제기 |
| Auto-PR 학습 적재 (`peter-evans/create-pull-request`) | 제거됨. 출력 채널은 Confluence 리포트로 단일화 |
| `scripts/classifiers/claude.js`·`human.js` | 호출 경로 없음 (호환 시그니처만 `engine.js`에 잔존) |

---

## 5. 퀵 레퍼런스

### 5.1 명령어

| 목적 | 명령 |
|---|---|
| 테스트 | `npm test` |
| LLM 연결 점검 | `npm run check:llm` |
| **일일 리포트 (dry-run / 실실행)** | `npm run report:aa:dryrun` / `npm run report:aa` |
| 감사 | `npm run audit:aa` |
| 자동 정리 (dry-run / 실실행) | `npm run reorganize:aa:dryrun` / `npm run reorganize:aa` |
| **이관 전체 (멱등)** | `npm run migrate:all` |
| 로컬 CI 시뮬레이션 | `npm run ci:local:dryrun` / `npm run ci:local` |
| AA 폴더 셋업 | `npm run setup:aa:dryrun` / `setup:aa` / `setup:aa:update(:dryrun)` |
| AA 청소 | `npm run clean:aa:dryrun` / `clean:aa` |
| 소스 스페이스 스냅샷/후보 | `npm run refresh:snapshots(:sd/:wnd/:device/:smilearch)` / `analyze:candidates` |

> 옛 `npm run migrate:mps` 등 카테고리별 이관 스크립트와 `analyze:sd`는 **현 package.json에 없거나 폐기**됨. 이관은 `migrate:all`만 사용.

### 5.2 라벨

| 라벨 | 주인 | 의미 |
|---|---|---|
| `is-folder` | 봇/관리자 | 폴더 페이지 표시 (분류 대상 아님) |
| `human-classified` | 감사 자동 부여 | 사람이 결정한 분류 — 봇이 되돌리지 않음 |
| `last-parent-*` | 감사 자동 | 직전 부모 기록 — 휴먼 이동 감지용 |
| `bot-report`·`auto-report` | 봇 전용 | 리포트 페이지 — 감사·정리·분류에서 자기 배제, 보관 정책 대상 |
| `needs-review` | 봇 | fallback 처리됨 — 사람 검토 대기 |

### 5.3 Secrets (GitHub Actions)

| 이름 | 용도 |
|---|---|
| `CONFLUENCE_EMAIL` / `CONFLUENCE_TOKEN` | Confluence Basic Auth |
| `ANTHROPIC_API_KEY` | LLM 분류 (없으면 rule+fallback으로 격하) |
| `SLACK_WEBHOOK_URL` / `EMAIL_USERNAME` / `EMAIL_PASSWORD` / `NOTIFY_EMAIL_TO` | 실패 알림 전용 |

### 5.4 트러블슈팅 요약

| 증상 | 첫 확인 |
|---|---|
| 오늘 리포트가 없다 | Actions 탭 실패 여부 → Slack/이메일 알림 → 로컬 `report:aa:dryrun`으로 재현 |
| 401/403 | Secrets의 이메일·토큰 만료/오타 (로컬은 `.env`) |
| 429 rate limit | 시간당 5000 한도 — 대기 후 재실행 (일상 사용에선 도달 어려움) |
| §4가 통째로 "미실행" 자리표시 | 권고 대상이 없으면 정상. 단, `ANTHROPIC_API_KEY` 부재로 LLM 단계가 skip된 경우도 있으니 §6 메타 확인 |
| 룰을 바꿨는데 반영이 안 된 듯 | §6 `policyHash` 변경 여부 → 미변경 시 머지/경로 오류. 반영됐으면 §5 "룰 변경 감지" 확인 |
| 같은 날 리포트가 2장 (`_2`) | 재실행된 것뿐 — 정상 |
| §7 부록을 사람이 편집했다 | 다음 날 delta "—" + 경고 1건. 크래시하지는 않음. 부록은 편집 금지 |

---

*이 문서는 코드 사실(`scripts/report_aa_daily.js`, `scripts/report/render.js`, `scripts/utils/classification_provider.js`, `.github/workflows/confluence_automation.yml`, `package.json`)을 기준으로 작성됐다. 코드와 불일치하면 코드가 맞다 — 이 문서를 고칠 것.*
