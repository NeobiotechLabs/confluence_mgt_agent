# 일일 자동 리포트(auto_report) 스펙 초안

- **상태**: DRAFT v0.2 (2026-07-29) — 1차 리뷰 반영(폴더명 "자동화 리포트", runId 확정, 보관 1개월, 잔존 후보 추적)
- **선행 문서**: `docs/ideation_for_automation.md` §4.1(리포트 체계) · §4.2(정책 루프) · §2.x(약점 분석)
- **대상 시스템**: GitHub Actions(self-hosted) → Confluence AA 스페이스에 작성하는 자동화 실행 리포트
- **합의된 운영 루프**: Actions가 매일 리포트 작성 → 관리자가 며칠 치 검토 → Claude와의 대화로 정책 파일 업데이트 → 커밋/머지 → 다음 cron 실행에 반영

---

## 1. 목적과 원칙

리포트는 자동화의 **유일한 사람-기계 인터페이스**다. Slack/Email 알림을 쓰지 않는 설계이므로, 이 페이지가 없으면 관리자는 자동화 상태를 알 수 없다.

| 원칙 | 의미 |
|------|------|
| **P1 심박(heartbeat)** | 리포트가 없는 날 = 장애. 아무 일도 없어도 "특이사항 없음" 리포트는 반드시 생성된다. |
| **P2 실행 가능(actionable)** | 모든 항목은 "그래서 사람이 뭘 해야 하나"로 끝난다. 단순 로그 나열 금지. |
| **P3 diff 기반** | 어제의 리포트와 비교해 **새로운 것/반복되는 것**만 강조. 매일 같은 내용 반복 = 노이즈. |
| **P4 자기 서술(self-describing)** | 사용된 정책 버전·모델·코드 버전을 리포트에 기록 → 리포트만으로 "왜 이렇게 분류됐나" 재현 가능. |
| **P5 기계 부록(machine appendix)** | 사람용 본문과 별도로, 다음 실행이 읽는 구조화 JSON 부록을 같은 페이지에 둔다(상태 저장소 = Confluence). |
| **P6 자기 배제(self-exclusion)** | 봇의 모든 루프(감사·정비·이관)는 리포트 페이지를 작업 대상으로 삼지 않는다. |

---

## 2. 페이지 배치와 명명

### 2.1 위치

```
AA 스페이스 홈 (426344771)
└── 자동화 리포트/                ← 폴더 페이지 (신설, 봇이 1회 생성)
    ├── auto_report_260730_0900
    ├── auto_report_260731_0900
    └── ...
```

- **`자동화 리포트` 폴더**: 라벨 `is-folder` + `bot-report`. 기존 `setup_aa_space` 흐름 또는 최초 리포트 생성 시 idempotent하게 생성.
- 폴더명은 1차 리뷰(2026-07-29)에서 "자동화 리포트"로 확정(초안 "이관 결과"는 루프 B 내부 정비까지 담기에 좁아 변경).

### 2.2 명명 규칙

- 형식: `auto_report_{YYMMDD}_{HHMM}` (KST 기준) — 예: `auto_report_260730_0900`
- 콜론(`:`) 미사용(Confluence 제목 파싱·검색 안전), 초 단위 미사용.
- **충돌 처리**: 동일 제목 존재 → `_2`, `_3` 순 접미 (동일 분 재실행/수동 실행 대응). cron은 매일 09:00 KST 고정이므로 정상 운영에서는 접미가 붙지 않아야 한다 — 접미 발생 자체가 재실행 신호로 §6에 기록.

### 2.3 라벨

| 대상 | 라벨 | 용도 |
|------|------|------|
| `이관 결과` 폴더 | `is-folder`, `bot-report` | 폴더 취급 + 봇 전 루프 스킵 |
| 리포트 페이지 | `bot-report`, `auto-report` | 봇 전 루프 스킵 / 리포트 목록 조회용 |

- `bot-report`: **재귀 방지 핵심**. audit·reorganize·migrator는 이 라벨이 붙은 페이지를 분류·이동·감사 대상에서 제외한다(P6).
- `auto-report`: CQL(`space="AA" and label="auto-report"`)로 리포트만 모아 조회/삭제 가능.

---

## 3. 트리거·작성 주체·멱등성

| 항목 | 정의 |
|------|--------|
| 작성 시점 | 매일 KST 09:00 cron(=UTC 00:00) + `workflow_dispatch` 수동. 루프 A(주간 이관)는 월요일 실행분에만 §2 섹션이 채워지고, 나머지 요일은 "미실행" 표시. |
| 작성 주체 | 새 스크립트 `scripts/report_aa_daily.js`(기존 audit → reorganize → migrate 각 스크립트가 실행 결과를 JSON으로 stdout/임시 파일에 남기고, 마지막 단계에서 리포트 스크립트가 이를 합쳐 Confluence에 1회 POST). |
| API | v2 `POST /wiki/api/v2/pages`(storage format) + 라벨은 v1 `POST /content/{id}/label`. 폴더 생성도 동일. |
| 멱등성 | 작성 전 CQL `title="auto_report_YYMMDD_HHMM" and space="AA"` 조회 → 존재하면 접미递增 새 제목으로 생성(덮어쓰기 금지: 이력 보존). |
| 실패 시 | 리포트를 못 쓰는 경우(인증 사망 등)는 **심박 정지**로 취급. 기존 notify-failure 이메일 유지. "오늘 리포트가 없다" 자체가 1차 장애 신호라는 사실을 AUTOMATION_GUIDE에 명시. |
| 보관 | **1개월** 초과 리포트를 실행 시작 시 봇이 자동 삭제(제목의 `YYMMDD`로 경과 판정, `auto-report` 라벨 페이지 = 자기 출력만 삭제하므로 안전). 관리자는 처리 완료된 리포트를 언제든 수동 삭제 가능. 기준 리포트(직전 것)가 삭제된 경우 delta·seenCount는 우아하게 퇴화("—", 재계산). |

---

## 4. 리포트 구조(섹션 정의)

빈 섹션도 생략하지 않고 "해당 없음"으로 표기(완결성 신뢰, P2). 전체 골격:

```
[헤더 메타 테이블]
§1 요약
§2 루프 A — 스페이스 간 이관 (주간)
§3 루프 B — AA 내부 정비 (일일)
§4 AI 권고판 (실행하지 않음)
§5 관리자 조치 체크리스트
§6 실행 메타
§7 기계 부록 (JSON 코드 블록)
```

### 4.0 헤더 메타

| 필드 | 예시 | 비고 |
|------|------|------|
| 실행 시각 | 2026-07-30 09:00 KST (시작) ~ 09:04 (종료) | |
| 모드 | cron / manual | |
| 정책 버전 | `pol:ab12cd34` | §4.2 — 정책 파일 내용 sha256 앞 8자리(§6에서 산출 방식 정의) |
| 분류 모델 | claude-sonnet / minimax / glm / none(키 없음) | 환경에 실제 주입된 모델명 |
| 코드 버전 | git SHA 앞 7자리 | Actions checkout 기준 |
| 종합 상태 | ✅ 정상 / ⚠️ 경고(n건) / ❌ 부분 실패 | 경고·실패가 0이 아니면 ⚠️/❌ |

### 4.1 §1 요약 (계수 테이블)

| 지표 | 오늘 | 어제 대비 |
|------|------|-----------|
| AA 전체 페이지 수 | 223 | +1 |
| 최상위 고아(top-level) 수 | 1 | 0 |
| 미분류 폴더 인구 | 12 | +2 |
| 내부 이동(루프B) | 3 | — |
| 이관(루프A) / 후보 / 탈락 | 0 / 5 / 2 | — (비주간이면 "미실행") |
| AI 권고 항목 | 4 | +1 |
| **조치 필요** | **Y (2건)** / N | §5에 신규+반복 건수 |

- "미분류 폴더 인구"와 그 delta가 **안정화 졸업 기준**의 1차 지표(ideation §4.7). 어제 값은 이전 리포트의 기계 부록에서 읽는다(§8).

### 4.2 §2 루프 A — 이관 (월요일 또는 수동 이관 실행 시만)

세 하위 테이블:

1. **이관 완료**: 페이지(링크) / 출처 스페이스·경로 / 도착 폴더(AA 내 경로) / 결정 source / 사유
2. **후보 발견·미이관**: 페이지 / 출처 / 분류 결과 / 미이관 사유(예산 초과·보류 라벨 등 — 예산제는 Phase 3). 매주 후보로만 남고 이관되지 않는 **잔존 후보**는 fingerprint(`kind=candidate-a`)로 `seenCount` 관리되어 "n주째 후보"로 표기 — 지속 잔존은 정책 업데이트가 필요하다는 강한 신호(1차 리뷰 요구). 정책 업데이트의 핵심 입력.
3. **탈락**: 페이지 / 출처 / 탈락 사유(규칙 제외: cutoff 이전, Archived 접두, Daily Scrum, 날짜 접두 제목 등 — `rule.js` 글로벌 exclude)

- 비주간 실행: "금일 미실행 (주간 루프: 월요일)" 1줄.

### 4.3 §3 루프 B — AA 내부 정비 (일일)

| 페이지 | 이동 전 → 후 (AA 내 경로) | 결정 source | 사유 |
|--------|---------------------------|-------------|------|
| [AA 운영 정책 가이드](link) | (top) → 미분류 | fallback | 분류기 미매칭 → needs-review |

- 이동 실패/스킵 항목은 별도 소테이블로 (사유: 폴더 페이지, 이미 정상 위치, API 오류).
- 사람이 수동으로 옮긴 페이지(audit가 감지한 human move)도 "참고: 사람의 수동 이동" 소테이블에 기록 — **학습 후보**(§5 rule-promotion 입력).

### 4.4 §4 AI 권고판 (Phase 2+, 실행하지 않음)

헤드에 고정 문구: *"아래 항목은 봇이 실행하지 않았습니다. 승인하려면 정책을 업데이트하세요."*

- **오배치 의심**: 페이지 / 현재 폴더 / 제안 폴더 / 근거(모델 요약 ≤200자) / 신뢰도
- **신규 폴더 제안**: 제안명 / 근거 페이지 목록 / 왜 기존 폴더로 부족한지
- **반복 애매 항목**: 제목 / 몇 회째 미결(§8 seenCount) / 마지막 분류 source

자가정화(Phase 3)에서도 **권고는 계속 표시**하되, 사람이 확정한 규칙만 결정적 이동에 사용 — 권고판과 실행 내역(§3)은 항상 분리 표기.

### 4.5 §5 관리자 조치 체크리스트 (diff)

- **신규**: 이번 리포트에서 처음 등장한 조치 필요 항목.
- **반복**: 이전 리포트 기계 부록과 fingerprint가 같은 항목 — `n회째 미해결 (최초 YYYY-MM-DD)` 표기.
- 각 행: `[ ]` 체크 박스(관리자가 Confluence UI에서 직접 체크) + 항목 요약 + 바로가기 링크.
- **규칙 승격 후보**(Phase 3): 동일 제목 패턴이 n회 이상 같은 폴더로 수동 이동됨 → `{제안 패턴, 대상 폴더, 근거 횟수, 최근 사례 링크}` 행으로 표시. "패턴을 categories.yaml/decisions.json에 추가할지 Claude와 검토"가 권장 액션.

### 4.6 §6 실행 메타

- 정책 해시 산출: `sha256(config/classification_decisions.json || config/analysis_rules.json || config/aa_policy.md*)` 앞 8자. (*존재하는 파일만 연결; Phase 2에서 aa_policy.md·categories.yaml 도입 시 대상으로 교체)
- 모델명·git SHA·러너명·API 호출 수(rate limit 소진 추정, 5000/h 대비 %).
- 경고/오류 전체 목록(스킵된 폴더 404 등 기존 warn 포함) — 성공 행로는 조용히, 문제만 나열.
- 재실행 여부(제목 접미 발생 시 기록).
- runId: `{GITHUB_RUN_ID}#{GITHUB_RUN_ATTEMPT}` (1차 리뷰 확정) — 재실행 구분 및 부록 추적용.

### 4.7 §7 기계 부록

사람은 읽지 않아도 된다. 마커가 달린 JSON 코드 블록 1개:

````
<!-- aa-report-appendix:v1 -->
```json
{ ...부록 JSON (§7장 스키마)... }
```
````

- storage format에서는 `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">json</ac:parameter>...` 로 렌더. 마커 주석은 파싱 앵커 — 부록 앞 첫 줄에 정확히 1회 등장해야 한다.
- 다음 실행은 "이전 리포트"를 부록 마커로 파싱해 §1의 delta·§5의 반복 카운트를 계산한다. 부록이 손상/삭제되면 delta를 "—"(계산 불가)로 표기하고 경고 1건 기록(크래시하지 않음).

---

## 5. 항목 필드 정의

모든 테이블 행의 공용 필드:

| 필드 | 타입 | 출처 | 비고 |
|------|------|------|------|
| `pageId` | string | API | 링크 생성: `{BASE_URL}/wiki/spaces/AA/pages/{pageId}` |
| `title` | string | API | |
| `source` | enum | 분류 체인 | `human` / `rule` / `claude`(모델명 치환) / `fallback` / `excluded`(rule 글로벌 제외) |
| `folderTitle` | string | 분류 체인 | 결정 폴더의 AA 내 전체 경로(`aaTree` 조상 조립) |
| `reason` | string | 소스별 템플릿 | 아래 표 |
| `actionRequired` | bool | 규칙 | §9 참조 |

**source별 reason 템플릿** (사람이 읽는 문장):

| source | 템플릿 | 예시 |
|--------|--------|------|
| human | `휴먼 결정 '{id}' 매칭` | `휴먼 결정 'HD-003' 매칭` |
| rule | `규칙 카테고리 '{id}' 매칭` | `규칙 카테고리 'meeting-notes' 매칭` |
| claude/모델 | 모델 rationale 요약(≤200자, 줄임표) | `제목·조상 경로가 회의록 패턴…` |
| fallback | `분류기 미매칭 → 미분류(needs-review)` | (고정) |
| excluded | `이관 제외: {사유}` | `이관 제외: cutoff(2024-01-01) 이전 생성` |

---

## 6. 기계 부록 JSON 스키마 (v1)

```json
{
  "v": 1,
  "runAt": "2026-07-30T00:00:12Z",
  "runId": "1234567890#1",
  "mode": "cron",
  "policyHash": "ab12cd34",
  "model": "claude-sonnet",
  "gitSha": "ae1b341",
  "metrics": {
    "aaPageCount": 223,
    "topLevelOrphans": 1,
    "unclassifiedCount": 12,
    "movesB": 3,
    "migratedA": 0, "candidatesA": 5, "rejectedA": 2,
    "advisories": 4,
    "actionRequiredCount": 2
  },
  "items": [
    {
      "kind": "move-b",
      "pageId": "479133745",
      "title": "AA 스페이스 운영 정책 가이드",
      "fromFolderId": null,
      "toFolderId": "426344999",
      "source": "fallback",
      "reason": "분류기 미매칭 → 미분류(needs-review)",
      "actionRequired": true,
      "fingerprint": "sha1:9f2c...",
      "firstSeen": "2026-07-29",
      "seenCount": 2
    }
  ],
  "advisories": [
    {
      "kind": "misplacement-suspect",
      "pageId": "...", "title": "...",
      "currentFolderId": "...", "suggestedFolderId": "...",
      "rationale": "...", "confidence": 0.82,
      "fingerprint": "sha1:...", "firstSeen": "2026-07-28", "seenCount": 3
    }
  ]
}
```

**fingerprint 산출**:
- 이동·권고 항목: `sha1(kind + pageId + (toFolderId ?? suggestedFolderId))` 앞 12자.
- 규칙 승격 후보: `sha1("promotion" + normalizedTitlePattern + targetFolderId)`.
- 동일한 현상이면 동일한 fingerprint → 다음 실행에서 `seenCount`를 승계(+1), `firstSeen` 보존.

---

## 7. diff·반복 계산 규칙

1. 리포트 작성 직전, CQL `space="AA" and label="auto-report"` → 제목 내림차순 정렬로 **직전 리포트 1건** 취득(본 리포트 제외).
2. 직전 리포트를 GET, 부록 마커 이후 JSON 파싱.
3. 이번 `items`+`advisories`의 각 fingerprint를 직전 부록과 대조:
   - 매칭 → `seenCount = prev + 1`, `firstSeen = prev.firstSeen` 승계.
   - 신규 → `seenCount = 1`, `firstSeen = today`.
4. 직전 부록에는 있고 이번에는 없는 항목 = **해소됨**(사람 조치 또는 상태 변화) → §5에서 자연스럽게 소멸. 별도 "해소됨" 섹션은 MVP에 두지 않음(노이즈).
5. §1의 "어제 대비" delta = `metrics` 필드 간 단순 차감. 직전 리포트 부재(최초 실행) 시 delta = "—".

---

## 8. 빈 실행·예외 케이스

| 케이스 | 동작 |
|--------|------|
| 이동 0·이관 0·권고 0 | 전 섹션 "해당 없음" + §1 계수만 채운 정상 리포트 생성 (심박 유지) |
| 이전 리포트 없음(최초) | delta·seenCount 생략, 부록만 작성 |
| 이전 부록 파싱 실패 | delta = "—", 경고 1건, 리포트는 정상 생성 |
| 리포트 POST 실패 | 재시도 1회 → 실패 시 notify-failure 이메일. 리포트 없음 = 장애 신호 |
| 정책 파일 미존재(aa_policy.md 등) | 존재하는 파일만으로 해시 산출, §6에 사용 파일 목록 명시 |
| 같은 날 재실행 | 접미 제목으로 신규 생성(덮어쓰지 않음), §6에 재실행 기록. 직전 리포트 = 방금 생성분 → diff는 직직전 것이 아닌 바로 이전 것과 비교(정상) |

---

## 9. 봇 자기 배제 (P6) 구현 요구

모든 AA 페이지 순회 루프에 동일 조건 추가:

```js
if (p.labels.includes('bot-report')) continue;   // 리포트·리포트 폴더 스킵
```

적용 대상: `audit_aa_space.js`, `reorganize_aa_space.js`, `migrator.js`(AA 수금 시), 향후 자가정화 이동 루프.

- 리포트 페이지에는 `is-folder`가 없으므로, 폴더 스킵(`is-folder` 체크)만으로는 부족하다 — `bot-report` 체크가 실질적 방어선.
- 사람이 리포트를 다른 폴더로 옮겨도 무해(감사·이동 대상에서 제외되므로 학습 대상이 아님).

---

## 10. Confluence 렌더링 규약

- 본문은 **storage format(HTML)** — v2 POST의 표준. 마크다운으로 초안을 작성하되 발행 시 변환(기존 `confluence_publish_doc` 계열 도구 참고).
- 허용 요소: `<h2>/<h3>`, `<table>`, `<ul>/<ol>`, `<strong>`, `<a>`, code 매크로(부록용). **화려한 매크로(status/expand/panel) 금지** — 렌더 의존성 최소화, 파싱 안정성.
- 링크는 항상 `/wiki/spaces/AA/pages/{id}` 정규 URL.
- 부록 code 매크로 바로 앞 줄에 마커 주석 `<!-- aa-report-appendix:v1 -->` 1회. 스키마 변경 시 `v2`로 증분(하위호환 파서).

---

## 11. 단계적 구현 (ideation 로드맵 대응)

| 단계 | 리포트 구현 범위 | 비고 |
|------|------------------|------|
| **Phase 1 (MVP)** | 폴더+라벨 신설, 헤더, §1 요약, §3 루프B 이동 로그, §6 메타(정책 해시·git SHA), §7 부록(최소 스키마), 심박, 자기 배제, 제목 멱등성, 보관(1개월 자동 삭제) | **현행 동작의 보고만**. 새 분류·이동 행동 없음 → 리스크 최소. Auto-PR 제거와 동시. |
| **Phase 2** | §2 루프A 섹션(migrator 출력 통합), §4 AI 권고판, §5 diff/반복 카운트, 모델 추상화 연동 | AI_PROVIDER=none이면 §4 "모델 미설정" |
| **Phase 3** | §5 규칙 승격 후보, 자가정화 실행 내역과 권고의 분리 표기, 졸업 지표 대시보드 행 | 자가정화 게이트(이동 예산·쿨다운) 값도 §6 메타에 기록 |

MVP验收 기준: dry-run으로 리포트 HTML을 stdout에 출력 → 사람이 눈으로 확인 → 그 다음 실제 POST.

---

## 12. 비목표 (Non-goals)

- 리포트의 실시간 대시보드화(Confluence 매크로 대시보드) — 정적 페이지로 충분.
- Slack/Email 정상 통보 — 기존은 **실패 전용** 유지(ideation 사용자 결정).
- 리포트 자체의 버전 관리/이력 diff UI — Confluence 페이지 이력 기능으로 대체.
- 부록 JSON의 외부 DB화 — 상태 저장소는 Confluence 페이지 자체(P5).

---

## 13. 오픈 이슈

1. ~~**폴더명**~~ → **해결** (1차 리뷰 2026-07-29): "자동화 리포트"로 확정.
2. ~~**리포트 보관 주기**~~ → **해결**: 1개월 자동 삭제 + 관리자의 처리 완료분 수동 삭제 허용 (§3 보관 행).
3. **부록 신뢰성**: 사람이 리포트를 편집하면 부록이 깨질 수 있다. "봇 생성 페이지 — 편집 금지" 문구를 헤더에 넣되, 파싱 실패를 정상 케이스로 처리(§8)하는 것으로 완화.
4. ~~**runId 소스**~~ → **해결**: `{GITHUB_RUN_ID}#{GITHUB_RUN_ATTEMPT}` (§6).
5. **§4 신뢰도 표시**: 모델이 confidence를 안 주면(현재 claude 분류기 미확인) "상/중/하" 또는 생략 — claude.js 응답 스키마 확정 후 결정.

---

## 부록 A — 마크다운 렌더 예시 (MVP, 빈 실행)

```markdown
# auto_report_260730_0900

| 실행 시각 | 모드 | 정책 버전 | 분류 모델 | 코드 버전 | 종합 상태 |
|---|---|---|---|---|---|
| 2026-07-30 09:00 → 09:02 KST | cron | pol:ab12cd34 | none | ae1b341 | ✅ 정상 |

## §1 요약
| 지표 | 오늘 | 어제 대비 |
|---|---|---|
| AA 전체 페이지 수 | 223 | +1 |
| 최상위 고아 수 | 1 | 0 |
| 미분류 폴더 인구 | 12 | 0 |
| 내부 이동(루프B) | 0 | — |
| 이관(루프A) | 미실행 (비주간) | — |
| 조치 필요 | N | — |

## §2 루프 A — 이관
금일 미실행 (주간 루프: 월요일)

## §3 루프 B — 내부 정비
해당 없음

## §4 AI 권고판
모델 미설정 (Phase 2)

## §5 관리자 조치 체크리스트
해당 없음

## §6 실행 메타
- 정책 해시 대상 파일: config/classification_decisions.json, config/analysis_rules.json
- API 호출: 48회 (rate limit 1.0%)
- 경고/오류: 0건

<!-- aa-report-appendix:v1 -->
```json
{ "v": 1, "runAt": "2026-07-30T00:00:12Z", ... }
```
```
