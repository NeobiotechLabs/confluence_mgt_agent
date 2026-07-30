# 스페이스별 문서 이관 및 판별 정책 (Space Rules Knowledge)

> **status: reference-only(코드 자동화 미참조)**
>
> 이 문서는 정책의 **의미론 출처**입니다. 자동화 코드는
> [`config/analysis_rules.json`](../config/analysis_rules.json)을 SSOT로 사용하며, 룰 추가·조정
> 시 본 문서를 출발점으로 삼습니다. 사람이 변경하고 → SSOT를 갱신하는 순서를 권장합니다.
>
> - 옛 위치: `dify/space_rules_knowledge.md` (Dify KB 컨테이너용, 정책상 폐기)
> - 적용 대상 스페이스: **SD · WND · Device · SmileArch** (총 4개)
> - 자동화 분류 체인: [`reference/classification_rules.md`](classification_rules.md) 참고

---

## §0 [전역(Global) Common Rule]

전 스페이스에 공통 적용되는 노이즈·라벨·워크플로우. **섹션 룰 평가 전 1차 필터**로 사용.

### §0.1 노이즈 필터링 (Drop Rule)
1. 문서 내용이 완전히 비어있거나 의미 없는 테스트용 페이지는 **무조건 Drop**.
2. '주간 보고(Weekly)' 또는 '월간 보고(Monthly)' 성격의 문서일 경우, 작성일(`page_date` 또는 본문)이 **2025년 1월 1일 이후**인 것만 유효. 그 이전 과거 보고서는 모두 Drop.
3. `archived` 상태 페이지는 Drop(SSOT `global.exclude_patterns.archived_prefix`에 매핑).

### §0.2 전역 레이블 사전
스페이스별 필수 태그 외, 문서 성격에 맞춰 **최소 2개 이상** 풀에서 조합. 없는 태그를 지어내면 안 됩니다.

| 풀 | 사용 가능 값 |
|---|---|
| **발생 월(Month)** [필수] | `month-YYYY-MM` 형식 1개. 페이지 작성 시점 기준. |
| **문서 타입(DocType)** | `doctype-mps-annual`, `doctype-mps-monthly`, `doctype-mps-weekly`, `doctype-project-status`, `doctype-tech-survey`, `doctype-market-survey`, `doctype-guideline`, `doctype-patent`, `doctype-gov-project`, `doctype-report`, `doctype-spec`, `doctype-plan`, `doctype-research`, `doctype-model`, `doctype-hw`, `doctype-survey`, `doctype-rule` |
| **그룹(Group)** | `group-center`, `group-ai`, `group-sw`, `group-device` |
| **진행 상태(Status)** | `status-active`, `status-completed`, `status-evergreen`, `status-verified`, `status-archived`, `status-needs-review` |
| **프로젝트(Project)** | `project-navigation`, `project-implant-robot`, `project-smilearch`, `project-smart-godig-achi`, `project-digital-twin`, `project-wnd` |

### §0.3 매칭 워크플로우
1. **Common Rule** 적용 → 통과 못 하면 Drop(보고서에 `common.noMatch` 카운트).
2. 통과 시, **`sourceSpace`에 해당하는 섹션 룰**만 평가. 다른 섹션 룰은 시도하지 않음.
3. 섹션 룰 통과 → 매칭 완료(카테고리 + 라벨). 실패 → `section.noMatch`로 보고 — 자동화 추가 작업 대상.
4. catch_all 흡수는 **Common Rule 통과 + 섹션 룰 일부라도 만족하는 경우**에만 적용. 둘 다 실패하면 명시적 보고.

---

## §1 [SD] 스페이스 룰

### §1.1 스페이스 성격
덴탈 AI 연구소 기본 업무 공간(주간 보고, 검증 규칙, 공통 파일 관리 등).

### §1.2 노이즈 필터링 (Drop Rule)
- "Daily Scrum", "개인 주간 업무 보고", 내용 없는 링크 스크랩 문서 Drop.

### §1.3 타겟 폴더 가이드
`context_tree` 내에서 `연구소 공통`, `업무 일지`, `검증/테스트` 성격 폴더를 찾아 매핑.

### §1.4 레이블링 가이드
공통 관리 문서이므로 본문 성격에 따라 **최소 1개 이상** 반드시 부착:
- `group-ai` (기본)
- `doctype-report` (보고서류)
- `doctype-rule` (검증 규칙 등)

### §1.5 SSOT 매핑
`config/analysis_rules.json` 카테고리: `mps_history`, `common_report`, `validation_rule` (및 공통 `catch_all_known`).

---

## §2 [WND] 스페이스 룰

### §2.1 스페이스 성격
Dynamic Navigation 프로젝트(SDP, 기능 요구사항, State Diagram, 마일스톤 등).

### §2.2 노이즈 필터링 (Drop Rule)
본문 없이 "Revision" 등 단순 이력만 있는 페이지, 알림성 글 Drop.

### §2.3 타겟 폴더 가이드
`context_tree` 내에서 반드시 `과제 관리` > `Dynamic Navigation` 하위 폴더 중 성격에 맞는 폴더(산출물, 기획, 회의록 등)를 매핑.

### §2.4 레이블링 가이드
이 스페이스 출신 문서는 **반드시** `project-wnd` 태그 부착. 추가로 성격에 따라:
- `doctype-spec` (명세서)
- `doctype-plan` (계획서)

### §2.5 SSOT 매핑
`config/analysis_rules.json` 카테고리: `wnd_deliverable`, `wnd_spec` (구현 시 추가 예정).

---

## §3 [Device] 스페이스 룰

### §3.1 스페이스 성격
덴탈 AI 연구소 개발PM팀 HW 관련 업무(환자용 트레이, 풋 스위치, IR 카메라 부품/업체 조사 등).

### §3.2 노이즈 필터링 (Drop Rule)
본문 텍스트 없이 제목만 "DN_XXX 업체" 식으로 적혀있고 내용이 텅 빈 문서 Drop.

### §3.3 타겟 폴더 가이드
`context_tree` 내에서 `개발PM팀`, `하드웨어`, `디바이스`, `기구설계`, `Dynamic Navigation`, `Implant Robot` 등의 키워드가 포함된 폴더 계층을 최우선으로 탐색하여 매핑.

### §3.4 레이블링 가이드
이 스페이스 출신 문서는 **반드시** 다음 중 하나 이상 부착:
- `group-device`
- `project-navigation`
- `project-implant-robot`

추가로:
- `doctype-survey` (업체/부품 조사)
- `doctype-hw` (도면/산출물)

### §3.5 SSOT 매핑
`config/analysis_rules.json` 카테고리: `device_hw`, `device_vendor` (구현 시 추가 예정).

---

## §4 [SmileArch] 스페이스 룰

### §4.1 스페이스 성격
SmileArch Design SW 알고리즘 및 딥러닝 연구(Diffusion 모델, STL 신경관 기반 추정, 기술 스택 조사 등).

### §4.2 노이즈 필터링 (Drop Rule)
의미론적 해석이 불가능한 파이썬 에러 로그 덤프, 해결되지 않은 이슈 초안 Drop.

### §4.3 타겟 폴더 가이드
`context_tree` 내에서 `과제 관리` > `SmileArch` 하위 폴더나, `AI 연구/알고리즘` 관련 폴더를 매핑.

### §4.4 레이블링 가이드
이 스페이스 출신 문서는 **반드시** `project-smilearch` 태그 부착. 추가로:
- `doctype-research` (논문/기술 스택 조사)
- `doctype-model` (모델 학습 결과)

### §4.5 SSOT 매핑
`config/analysis_rules.json` 카테고리: `smilearch_research`, `smilearch_model` (구현 시 추가 예정).

---

## 변경 절차

1. **정책 변경이 필요하면 본 문서부터 갱신**합니다(§N.NN 자유 텍스트).
2. 다음으로 [`config/analysis_rules.json`](../config/analysis_rules.json) SSOT를 갱신(카테고리 추가·수정).
3. (선택) `analysis_rules.json` 카테고리 `.description`에 본 문서 §N 인용 추가.
4. `npm test` + `npm run analyze:candidates`(정책 dry-run) 확인.
5. PR 생성 → 머지 → 다음 일일 리포트에 `policyHash` 변동으로 자동 advisory 발생(작업 5).

자세한 절차: [`reference/classification_rules.md`](classification_rules.md).
