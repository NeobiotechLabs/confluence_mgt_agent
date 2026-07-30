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

## 5. 비용·안전 가드

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

## 7. 향후 작업 (Phase 2 자리표시)

- 일별 cron이 자동으로 룰 변경을 흡수하지만, 비용 모니터링·샘셋 비교는 Phase 2.
- 사내 LLM 게이트웨이(`INTERNAL_LLM_URL`)가 도입되면 `llm_api.js`에 adapter 추가 — Dify 호환 불필요.
