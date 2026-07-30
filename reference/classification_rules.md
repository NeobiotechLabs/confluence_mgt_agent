# AA 스페이스 분류 룰 (작성 중)

> 본 문서는 코드(`config/analysis_rules.json`, `scripts/utils/classification_provider.js`)의 **의도와 변경 절차**를 함께 관리하기 위한 문서입니다. 룰 패턴 자체는 JSON 파일이 단일 진실 원천(SSOT)이며, 본 문서는 사람이 읽는 해설입니다.

## 1. 배경

- 사내 Dify 토큰이 만료되어(2026-07-28) Dify 기반 분류 워크플로우 사용 불가.
- 정책 변경: **Dify 미사용, GitHub Actions 내에서 모든 분류/감사를 처리**. 외부 토큰 만료에 영향받지 않는 자급자족형 자동화.
- 모델: 공식 Anthropic SDK (`claude-haiku-4-5-20251001` 기본, env `ANTHROPIC_MODEL`로 override).
- 키: GitHub Actions Secrets `ANTHROPIC_API_KEY`. **절대 커밋 금지**.

## 2. 체인 정책

`scripts/utils/classification_provider.js`의 분류 체인은 단일 순서를 따릅니다.

```
rule → inline-llm(Anthropic) → fallback(unsortedFolderId, needs-review)
```

- **human 단계 제거**: 사내 휴먼 큐 기반 분류는 정책상 폐기. 룰 또는 LLM으로 자동 분류가 원칙.
- **claude 단계 제거**: 옛 `scripts/classifiers/claude.js`도 더 이상 호출되지 않음. `llm_api.js`(공식 SDK wrapper)로 일원화.
- **dify 단계 제거**: 토큰 만료와 무관하게 정책적으로 사용 안 함.
- **ANTHROPIC_API_KEY 미설정 시**: rule 단계만 수행, 미매치 시 fallback. 비용·보안 가드.

## 3. `config/analysis_rules.json` (SSOT)

- 카테고리별 `match.title_patterns`(정규식 문자열 배열), `match.ancestor_contains`, `exclude.title_patterns`, `fields.labels_template`, `fields.subCategory_*`로 구성.
- `description` 필드에 정책 의도(예: "포용적 수집이 원칙이며 제외는 명백한 noise만")가 들어 있음.
- **변경 절차**:
  1. PR로 변경. description의 의도와 일치하는지 본 문서(`reference/classification_rules.md`)와 함께 리뷰.
  2. 일별 cron(`daily-report`)이 자동으로 모든 페이지를 재감사하므로 버전 bump 없이도 적용됨. 단, 비용 최적화를 위해 룰 자체의 변경 이력은 PR 본문에 명시.
  3. 룰 추가/삭제 시 `tests/utils/classification_provider.test.js`의 mock 시나리오가 영향받지 않는지 확인.

## 4. 결과 스키마 (정규화)

모든 분류기는 동일한 형태로 반환합니다 — `migrator.js`, `audit_aa_space.js`의 호출자는 차이를 인식하지 않습니다.

```js
{
  ok: true,
  source: 'rule' | 'inline-llm' | 'fallback',
  folderId: string,           // AA 폴더 ID
  folderTitle: string?,        // 선택
  labels: string[],            // 부착할 라벨
  reason: string,              // 로그/감사용
}
```

실패 시 `{ ok: false, source: 'miss', reason: '...' }` — 예외를 throw하지 않고 흡수해 per-page try/catch와 호환됩니다.

## 5. 매칭 실패 추적 (작업 8)

일별 cron은 `unsorted` 폴더에 남아 있는 페이지가 KB(SSOT 룰)에 잡히지 않으면 **룰 추가 후보**로 표기합니다. 자동 분류는 fallback(`unsortedFolderId`로 이동)으로 끝나지만, 그 자체는 "룰이 모른다"는 신호이므로 가시화해 사람이 후속 룰을 추가할 수 있게 합니다.

- **추적 단위**: `kind: 'unmatched'` 부록 item. `fingerprint = sha1('unmatched', pageId, unsortedFolderId)[:12]` — 페이지가 폴더를 떠났다가 돌아와도 동일 fingerprint.
- **SSOT**: `reference/unmatched_pages.json` (append-only 머지). 원자적 쓰기(`.tmp` → rename).
- **머지 의미**:
  - 같은 fingerprint가 prev에 있으면 → `seenCount+1`, `lastSeen = today`, `firstSeen` 보존.
  - 없으면 → `seenCount=1`, `firstSeen = lastSeen = today`.
  - prev에만 있고 오늘은 없으면 → 부록엔 안 들어가지만 파일엔 남음(다음 비교 기준 보존). 만료/제거 정책은 Phase 2.
- **catch_all 흡수의 의미**: `catch_all_known`(있으면 모든 페이지 흡수)은 "매칭 성공"으로 간주되지만 "명시 카테고리 매칭 실패"의 신호이므로 **unmatched로 본다**. `sourceSpace`는 catch_all의 sourceSpace(보통 `*`)로 기록.
- **매칭 진짜 실패**: KB 자체에 catch_all도 없고 명시 룰도 매칭 안 됨 → `sourceSpace: 'unknown'`.
- **부록 items 머지**: `move-b`류(루프 B 이동 로그)와 `unmatched`류가 같은 `items[]` 안에 공존. 렌더 측은 `kind`로 분기.
- **dry-run**: 디스크 쓰기 없음, stdout에 `unmatchedItems` 카운트만 출력.
- **save 실패**: throw하지 않고 advisory 1줄로 부록에 기록(리포트 POST는 계속).

**누락 가시화 → 룰 추가 흐름**: 운영자가 매일 부록을 보고 `캘리브레이션 회의록` 류가 반복되면 → `config/analysis_rules.json`에 명시 룰 추가 → 다음 cron부터 자동 흡수 → `unmatched` 카운트 감소.

## 6. 비용·안전 가드

- **키 부재 시**: LLM 단계 skip → fallback. 의도된 동작입니다(테스트로 보호).
- **API 에러**: `callLLM` 내부에서 throw를 catch하여 `{ok:false, source:'miss'}` 반환. 호출자(분류 체인)는 fallback으로 이어짐.
- **tool_use 미사용**: 모델이 텍스트만 응답하면 `reason: 'no-tool-use'`로 miss. 호출자는 fallback.
- **folderId 누락**: 모델이 도구를 호출했지만 folderId를 비웠다면 `reason: 'no-folder-id'`로 miss.
- **rate limit / 모델 변경**: GitHub Actions Secrets의 키 회전 시 `.github/workflows/confluence_automation.yml`의 env로 일괄 주입. 모델은 `ANTHROPIC_MODEL` env로 override.

## 6. 변경 절차 요약

| 변경 종류 | 절차 |
|---|---|
| 룰 패턴 추가/수정 | `config/analysis_rules.json` PR + 본 문서 갱신 |
| 체인 단계 추가/제거 | `classification_provider.js` PR + `engine.js` 시그니처 갱신 + 테스트 갱신 |
| 모델 변경 | `ANTHROPIC_MODEL` env 주입(워크플로우) — 코드 변경 불필요 |
| 키 회전 | GitHub Secrets 갱신 — 코드 변경 불필요 |
| 룰 자동 재감사 | 일별 cron(`daily-report`)이 자동 수행. dry-run은 `npm run report:aa:dryrun` |
| 미매칭 룰 추가 | §5 흐름: 부록 `unmatched` 항목 → `config/analysis_rules.json`에 명시 룰 추가 → 다음 cron부터 자동 흡수 |

## 7. 향후 작업 (Phase 2 자리표시)

- 일별 cron이 자동으로 룰 변경을 흡수하지만, 비용 모니터링·샘셋 비교는 Phase 2.
- ~~사내 LLM 게이트웨이(`INTERNAL_LLM_URL`)가 도입되면 `llm_api.js`에 adapter 추가 — Dify 호환 불필요.~~ 사용자 명시 지시(2026-07-30)로 **폐기** — 사내 LLM 미도입 상태가 유지됨. 공식 Anthropic SDK 경로만 사용.

## 8. AI 권고판 (작업 9, Phase 2-A)

봇이 자동 실행하지 않고, **사람이 정책 결정을 내릴 수 있도록 권고만** 하는 채널. §4 섹션으로 매일 부록(`advisories`)에 등장한다.

### 8-1. 권고 항목 스키마

부록 `advisories[]` 항목은 다음 두 형태를 허용한다.

- **문자열 권고**(기존): `⚠️ 룰 변경 감지: ...`, `audit 실행 실패: ...` 등 1줄 텍스트.
- **구조화 권고**(Phase 2-A 추가):
  ```js
  {
    kind: 'misplacement-suspect',
    pageId: string,
    title: string,
    currentFolderId: string,
    currentFolderTitle: string?,  // 옵션 — 라벨 폴더 제목이 모호하면 생략 가능
    suggestedFolderId: string,
    suggestedFolderTitle: string?,
    confidence: number,           // 0~1
    confidenceReason: string,     // 'keywords: 일치, 정확히' 같은 트레이스
    seenCount: number,            // 1이면 신규 의심, ≥3이면 반복 권고
    firstSeen: string,            // 'YYYY-MM-DD'
    lastSeen: string,
  }
  ```

### 8-2. 신뢰도 산출 (사용자 결정 2026-07-30)

LLM `reason` 문자열에서 어휘 가중치로 점수를 매긴다. 결정적·테스트 가능·LLM이 일관된 어휘를 쓴다는 전제.

| 어휘 | 가중치 |
|---|---|
| `정확히` / `일치` / `정확` / `매칭됨` | +0.35 |
| `유사` / `probably` / `likely` | +0.20 |
| `maybe` / `could be` / `아마` / `모호` | +0.05 |
| `불확실` / `unknown` / `분류 불가` | -0.20 |
| 그 외 | 가산 없음 |

`confidence = clamp(0, 1, base 0.5 + Σ가중치)`. `base=0.5`(아무 키워드도 매칭되지 않으면 "중립 의심" 의미).

**임계치**:
- `confidence ≥ 0.5`: 부록 진입(`misplacement-suspect`).
- `confidence < 0.5`: 부록 진입 안 함. 내부적으로 잡음 제거 — LLM이 명확히 "잘 모르겠다"고 답한 경우는 권고하지 않는다.

### 8-3. 반복 애매 항목 임계치 (사용자 결정 2026-07-30)

seenCount = 오늘 부록 진입 횟수. **3회 이상**이면 "반복 권고" → §4 헤드 영역이 아닌 별도 강조(별도 강조는 Phase 3 이후 자리표시).

- 1~2회: 일시적 의심. 운영자가 참고만 함.
- **3회 이상**: 같은 페이지가 3일 연속 의심 폴더에 머무름 → 사람이 정책 결정 권고.
- "한 주 안에 결정 안 된 항목 = 진짜 애매" — 주 5일 cron 기준 3영업일 ≈ 3일.

### 8-4. 정책 합의

- 봇은 **자동 이동하지 않음** (사람이 결정).
- 추천 폴더는 SSOT 카테고리 룰에서 떨어지지 않는 경우만 — 즉, 이미 카테고리는 알고 있지만 부모 폴더가 다를 때만 의심. 카테고리 자체가 `unknown`이면 "폴더 생성 제안"으로 별도 처리(Phase 3 자리표시).
- 신뢰도는 부록에 그대로 노출 — 운영자가 LLM 어휘 변화를 추적할 수 있도록.

### 8-5. Phase 2-B 자리표시 (§2 루프 A 실데이터)

부록 `kind:'move-a'`(외부→AA 이관) 항목의 seenCount + 권고. 범위는 별도 작업.
