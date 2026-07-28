# 이 레포지토리에서 할일

## 목적

- 사내 Confluence 시스템의 재정비

## 배경

- 우리 회사에는 MPS라는 시스템이 있음. Mission/Performance objectives/ Strategy
- 기간의 초에 각 구성원은 그 기간에 해야 할 일들을 Planning 하고, 기간의 말경 Evaluation 해야 함.
- 사내의 대부분의 문서는 당사 confluence 페이지에 저장되고, 관리 됨
- 이 페이지들을 데이터의 원천으로 삼아 신규 MPS를 계획하고, Evaluation 하기를 원함.
- MPS의 계획은 연간 MPS와 지난 월간 MPS를 기준으로 계획 되어야 함.
- 사내 Dify 시스템을 통해 MPS를 생성하고 평가하는 LLM 기반의 Workflow를 구축하고 있음
- 사내 Dify의 MPS agent(workflow), 사내 confluence의 MPS 이력과 MPS 서버로 부터 이전 MPS들을 참고해서 작성하고,
- 필요한 원천데이터는 confluence에서 가져와야 함.
- 이게 잘 동작하도록 

## 문제점

- 하지만, 현재 우리 회사 confluence의 스페이스의 페이지는 잘 구조화 되어 있지 않아.
- RAG 기반으로 참고하기에는 계층화가 잘 되어 있지 않고, 어떤걸 LLM이 참조해야 할 지 알기 어려워
- 올드 페이지가 섞여 있어서, 나쁜 결과가 나와
- 한번 정리한다 해도 계속 좋은 상태를 유지하기 어려워.

## 해야 할 일

1. 그렇지만, 일단은 어쩔 수 없이 한번 정리해야 함.
    - 기존 스페이스의 문제점을 잘 검토해서, 신규 스페이스에 잘 계층화 된 구조를 만들고 싶어
        . 기존 스페이스 : https://neobiotech.atlassian.net/wiki/spaces/SD/overview?homepageId=98524
        . 신규 스페이스 : https://neobiotech.atlassian.net/wiki/spaces/AA/overview
    - 그리고, LLM에서 contex 참조가 용이할 수 있도록 레이블 혹은 태그 지정을 하도록 하고 싶어.
    - 정책을 정리해서 지속적인 유지가 될 수 있도록 해야 해.
    - 기존 스페이스의 페이지는 유지 하고, 위의 정책에 맞는 페이지만 신규 스페이스에 복사해야 해.
    - 신규 스페이스는 MPS 작성에 (planning / evaluation) 필요한 정보만 남기고, 완료 되지 않았거나, 단순 기록성이거나 한 정보는 기존 스페이스 혹은 별도 프로젝트 스페이스에 기록을 남기도록 해야 해.
2. 정리 이후, 지속 가능해야 해. 물론 기본적으로 사용자가 1번에서 만든 정책을 잘 따라야 하겠지만, 스페이스 관리지가 필요해
    - 하지만, 여기에 휴먼 리소스를 사용할 수는 없고, AI Agent 혹은 workflow 구축해서 자동화 하는게 목표야.
    - 사내 Dify 시스템이 있기 때문에 그걸 활용해서 confluence를 유지 보수 하는 자동화를 만들거야. 기능은 (러프하게)
        . 새로 생성된 페이지의 위치가 정책에 위배 되면, slack 혹은 email 로 이동 요청 시킬 수 있어야 함
        . 정책에 따라 레이블 혹은 태그가 없을 시, 페이지 내용 파악해서 자동 tagging 하고 글 작성자에게 알림
        . 일정 기간 (6개월) 지난 페이지는 신규 스페이스에서 이동필요한 지, 파악할 수 있도록 작성자에게 알림.
            * 내용의 성격에 따라 계속 참고해야 할 수 도 있어. 이런건 특정 레이블이 필요할거 같아.

## 현재 마이그레이션 이후 문제 및 해결 상태

- 이전 스크립트 기반으로 마이그레이션이 되었고, 이후 신규 계층구조로 업데이트 해서, update 옵션으로 정리 했으나 아래 문제들이 발견되어 **초기화 후 재마이그레이션**을 결정했습니다. (`npm run clean:aa` 후 `npm run migrate:all` 진행)

1. **[해결됨]** SD 에서 처음 마이그레이션 될 때는, 계층 구조를 알고 있었는데 (원래 설계가 flat 했음). 이후 업데이트 할때는 이미 flat 해져서 인지, 신규 계층 구조에 페이지 들이 이동하길 기대 했으나, 이동안됨.
    - **원인/해결**: Confluence Cloud의 '스페이스 내 동일 제목 불가' 제약으로 인해 2026년 하위 폴더 생성이 누락되었음. 폴더명에 연도를 포함(`25 연구소`, `26 연구소` 등)하여 고유 제목을 보장함으로써 `setup_aa_space.js`가 정상적으로 구조를 생성하도록 수정.
2. **[해결됨]** LABEL을 group-center / group-ai 등으로 바꿨으나, 여전희 team-center로 되어 있음
    - **원인/해결**: Confluence V2 API 및 레이블 정책 이슈. 마이그레이션 스크립트에서 레이블 텍스트 정규화(콜론 제외, 하이픈 사용) 로직을 개선하여 올바른 레이블을 부착하도록 수정.
3. **[해결됨]** 이동한 페이지는 원본 페이지에 붙어 있던 영상 정보나 이미지 정보가 미리보기 안됨. 참조 경로 문제 아닐까 함.
    - **원인/해결**: 첨부파일 복사 로직의 부재 및 다운로드 권한 문제(AWS S3 리다이렉트 400 오류, 구버전 링크 401 오류). 
    - **조치**: 최신 REST API 엔드포인트를 사용하여 이미지만 다운로드 및 새 페이지에 업로드하도록 구현. 영상은 다운로드하지 않고 페이지 상단에 원본 페이지 참조 배너를 추가하여 해결.

- **현재 상태**: 모든 문제를 해결한 `migrate_to_aa_space.js` (v2) 스크립트로 이관 작업을 재진행 중입니다.

---

## Dify 토큰 만료로 인한 작업 중단 및 복구 계획

### 현황 (2026-07-28)

- 사내 Dify의 MPS 분류 워크플로우 API 토큰이 만료되어, GitHub Actions 기반 자동 분류/감사 (`scripts/migrator.js`, `scripts/auditor.js`)가 장기간 동작 중지 상태.
- 그나마 마이그레이션 본체(`scripts/migrate_to_aa_space.js`)는 Dify 호출이 없으므로 영향이 없음 → 로컬에서 직접 `npm run migrate:all` 등으로 밀린 건을 처리 가능 (자세한 절차는 위 "현재 마이그레이션 이후 문제 및 해결 상태" 섹션의 v2 절차 참고).

### 즉시(Now): 로컬에서 밀린 마이그레이션 처리

1. `.env`에 `CONFLUENCE_EMAIL`, `CONFLUENCE_TOKEN`만 설정 (DIFY_* 키는 없어도 무관).
2. `npm install` 후 `npm run setup:aa` → `npm run migrate:all` 또는 카테고리별 명령(`migrate:mps`, `migrate:project`, `migrate:tech`, `migrate:guide`, `migrate:report`) 실행.
3. `utils/dify_api.js`의 mock 폴백은 분류 정확도가 없어서 마이그레이션 본체에는 사용하지 않음. mock은 워크플로우 재개 후 health-check 용도로만 사용.

### 다음 단계(Not Now): Dify에서 하던 분류/감사를 GitHub Actions로 이관

**목표**: 사내 Dify 토큰 의존을 끊고, GitHub Actions(self-hosted runner) + 자체 스크립트로 분류/감사를 수행. 결과적으로 외부 토큰 만료에 영향받지 않는 자급자족형 자동화.

**작업 항목**

1. **분류 룰 추출 및 버전화**
   - 현재 Dify 워크플로우의 system prompt / 룰 텍스트를 `reference/classification_rules.md`(가칭)로 추출하여 코드와 함께 버전 관리.
   - 룰 변경 시 PR 리뷰로 승인하는 흐름 수립.

2. **`utils/dify_api.js` 추상화 (`classification_provider.js`)**
   - `getPageClassificationFromDify`를 `classifyPage(provider, ...)` 형태로 리팩터.
   - 지원 provider: `dify` (기존), `mock` (개발/폴백), `inline-llm` (신규; OpenAI/Anthropic 직접 호출).
   - provider 선택은 `.env`의 `CLASSIFICATION_PROVIDER`로 분기.

3. **자체 LLM 호출 모듈 (`utils/llm_api.js`)**
   - 입력: 페이지 제목/본문/AA context tree/원본 스페이스/작성일.
   - 출력 스키마는 Dify와 동일한 JSON (`is_valid`, `target_folder_id`, `labels`, `needs_new_category`, `suggested_new_folder`, `reason`).
   - 모델은 GitHub Actions Secrets에 등록된 키 사용 (예: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

4. **워크플로우 재구성**
   - `.github/workflows/confluence_automation.yml`을 `migrator`(수집/이관)와 `auditor`(자가 정화) 두 job으로 분리하고 각각 `CLASSIFICATION_PROVIDER` env를 주입.
   - Dify 토큰 만료 시 자동으로 `inline-llm` provider로 fallback하도록 step 추가.
   - 실패 시 Slack/Email 알림은 기존 step 유지.

5. **룰 업데이트 자동화**
   - 룰 버전(`GLOBAL_RULE_VERSION`)이 올라가면 자동으로 모든 페이지를 재감사하는 batch 워크플로우 추가 (`.github/workflows/confluence_reclassify.yml`).
   - dry-run 모드 + 관리자 승인 후 실제 적용 2단계 구조.

6. **옵션: 사내 LLM 엔드포인트 연동**
   - Dify 복구가 늦어질 경우 사내 LLM 게이트웨이 URL을 `INTERNAL_LLM_URL`/`INTERNAL_LLM_KEY`로 받아 직접 호출하는 adapter 추가 (Dify 호환 모드).

**검토할 트레이드오프**

- LLM API 비용: 매 페이지 호출하므로 rate limit/비용 모니터링 필요. 룰 기반 휴리스틱을 우선 적용하고 모호한 페이지만 LLM에 보내는 2-tier 구조 검토.
- 토큰/키 회전: GitHub Secrets에 키를 두므로 사내 정책상 외부 LLM 사용이 허용되는지 사전 확인 필요.
- 결과 일관성: Dify 모델과 다른 모델로 옮길 경우 분류 결과가 달라질 수 있음 → 샘셋 비교 검증 절차 마련.

### 성공 기준

- Dify 토큰이 없어도 `npm run migrate:all`로 마이그레이션 가능.
- GitHub Actions에서 `migrator`/`auditor` job이 외부 토큰 없이도 동작.
- 룰 변경 → 버전 bump → 자동 재감사 → 0원 필터링(룰/페이지 버전 동일 시 skip)으로 비용 최적화. 