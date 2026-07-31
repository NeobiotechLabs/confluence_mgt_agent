# AA 스페이스 분류 지침 (LLM Classification Guidelines)

> 이 파일은 LLM 분류기의 **자연어 판단 기준 SSOT**입니다. `scripts/utils/classification_prompt.js`가
> system prompt에 주입합니다. 폴더를 신설·통폐합하거나 판단 기준을 바꾸려면 이 파일을 PR로 수정하세요.
> 변경 절차: [`reference/classification_rules.md`](classification_rules.md) §6.
> 동기화 가드: `tests/utils/classification_prompt.test.js`가 `config/analysis_rules.json`의 모든
> 카테고리 폴더명이 이 파일에 등장하는지 검사합니다.

## 일반 원칙

1. **본문 우선**: 제목은 보조 신호일 뿐이다. 본문 내용이 나타내는 실제 업무·프로젝트·문서 성격으로 판단한다.
2. **보수적 확신**: 아래 confidence 규칙에 따라, 확신이 서지 않으면 `confidence: "low"`로 응답한다. 틀린 폴더에 넣는 것보다 미분류로 보내는 것이 운영 비용이 낮다.
3. **트리 ID 사용**: `folderId`는 반드시 현재 폴더 트리에 제시된 ID 중 하나여야 한다. 존재하지 않는 폴더를 제안하지 않는다.
4. **이관 배너 무시**: 본문 앞머리의 "자동 이관 문서" 배너(원본 스페이스·작성자 정보)는 메타데이터다. 분류 근거로 쓰지 않는다.

## confidence 규칙

- `high`: 본문(또는 본문이 비어 있으면 제목)만으로 아래 폴더 중 하나의 기준에 명확히 부합한다.
- `low`: 다음 중 하나 — 본문이 비어 있거나 너무 짧다 / 두 개 이상 폴더의 기준에 동시에 부합한다 / 어느 폴더의 기준에도 명확히 부합하지 않는다.
- `low`일 때: 가장 그럴듯한 후보 폴더 ID를 `folderId`에 담되, 시스템이 미분류로 처리한다. `reason`에 왜 확신하지 못하는지 한 문장으로 쓴다.

## 폴더별 판단 기준

### MPS 이력 (전사)
전사·팀 단위 마스터 플랜(MPS, Master Planning Schedule) 문서. 월간·주간·연간 MPS, MPS Planning/Evaluation, 팀별 MPS(AI MPS, SW MPS, Device MPS, Solution MPS, R&D MPS).
- 예: "2026-03 월간 MPS", "Weekly MPS 2026 W12", "연간 MPS 2026", "AI MPS 2026"

### 주간·월간 보고 (전사, 보관)
디지털개발실(연구센터) 주간 업무 공유·주간 보고 문서. 2025년 이후 정기 보고 성격.
- 예: "디지털개발실 주간 업무 공유 (2026-W12)"
- 주의: 팀 MPS 계획 문서와 혼동하지 않는다. MPS 계획·평가는 "MPS 이력 (전사)"로.

### DN — Dynamic Navigation
Dynamic Navigation(덴탈 내비게이션) 제품 개발 산출물. 요구사항·기구/회로/PCB 설계, 기능 정의(Surgical/Planning Mode, Nerve, Curve, Implant Planning), 캘리브레이션·IOS/Splint 정합, IR 카메라·IR 마커·카메라 마운트, 설문·제품화 검토, 설정 페이지, 기능별 참고 영상.
- 예: "DN_Surgical Mode 정의서", "IR 카메라 캘리브레이션 절차", "Planning 화면 설계"

### SmileArch — Smile Design v2.0
SmileArch/Smile Design SW 알고리즘·딥러닝 연구. 치아 세그멘테이션, 신경관 추정(CBCT·STL), Diffusion 모델, 학습 데이터 구축, 성능 평가·비교 보고서.
- 예: "SmileArch 세그멘테이션 학습 계획", "STL 신경관 Diffusion 모델 평가 보고서"

### DYN — 의료기기 IEC 62304 산출물 (Wearable Navigation)
Wearable Navigation의 의료기기 규제(IEC 62304, MDR) 산출물. 위험관리(보고서·계획서, RMR, FMEA), System Requirements Specification(SysRS), 사용목적 정의서(Intended Use), 의료기기/MDR 분류 문서, 형상관리 계획서, 보안관리 계획서, 소프트웨어 개발·유지보수 계획서, (DYN-###) 티켓 참조 문서.
- 예: "위험관리 보고서 (DYN-100)", "Software Development and Maintenance Plan"
- 주의: DN 폴더와 겹쳐 보이면 규제 문서 양식(계획서·보고서·정의서, IEC/MDR 용어) 여부로 구별한다.

### Device — HW 부품/업체 조사
하드웨어 부품·업체·파트너 조사 문서. 가공/조립 업체, IR 카메라 마운트 부품 조사, HW 요구사항·기구설계 조사.
- 예: "IR 카메라 마운트 업체 조사", "DN_트레이 가공 업체 비교"
- 주의: DN 설계 산출물이 아니라 **조사(survey)** 성격일 때 이 폴더다.

### 전사 How-To / 개발 가이드
전사 공통 개발 가이드·프로세스. Git전략·브랜치 전략, CI/CD, PR 리뷰 가이드, 코딩 컨벤션, MPS작성 프로세스, 형상관리 가이드. 오래 써도 닳지 않는(evergreen) 안내문.
- 예: "Git Branch Strategy 가이드", "PR 리뷰 가이드"
- 주의: 특정 프로젝트의 설계 문서가 아니라 **방법론·규약 안내서**일 때 이 폴더다.

### 전사 AI 전략 / 로드맵
AI 전략·로드맵·Evangelist 활동. A2A(Agent2Agent), MCP 서버, RAG, Fine-tuning, sLM 등 AI 기술 전략·도입 검토.
- 예: "2026 AI 로드맵", "MCP 서버 도입 전략"
- 제외: 회의록·ToDo·WIP 성격 문서는 이 폴더에 넣지 않는다 (confidence low로 처리).

### 기술 조사 / 시장 분석
전시회·시장·기술 트렌드 조사. IDS/KDX/SIDEX 등 치과 전시회 분석, AI 의료 영상 분석 동향, 기술 스택 조사, 시장 조사.
- 예: "IDS 2025 전시회 분석", "AI 의료 영상 분석 기술 조사"

### 정부과제
정부지원과제 수행 문서. 강원지역혁신클러스터, 글로벌기업산업기술, 중기부 소부장 과제. 기획·구현·완료 단계 문서.
- 예: "2026 강원지역혁신클러스터 과제 기획서"

### 미분류
봇의 최종 fallback 폴더. LLM이 직접 이 폴더를 고를 필요는 없다 — 어느 폴더도 `high` 확신으로 고를 수 없으면 가장 그럴듯한 후보와 `confidence: "low"`를 응답한다.

## 라벨 사전 (labels 제안 풀)

`labels`에는 아래 풀에서 **2개 이상** 조합해 제안한다. 사전에 없는 라벨을 지어내지 않는다.

| 풀 | 값 |
|---|---|
| group | `group-center`, `group-ai`, `group-sw`, `group-device`, `group-rnd`, `group-solution` |
| doctype | `doctype-mps-annual`, `doctype-mps-monthly`, `doctype-mps-weekly`, `doctype-report`, `doctype-spec`, `doctype-plan`, `doctype-research`, `doctype-survey`, `doctype-guideline`, `doctype-strategy`, `doctype-market-survey`, `doctype-design`, `doctype-requirement`, `doctype-gov-project`, `doctype-rmr`, `doctype-rmp`, `doctype-syrs`, `doctype-iu`, `doctype-classification`, `doctype-cmp`, `doctype-smp`, `doctype-sdmp` |
| project | `project-mps`, `project-navigation`, `project-smilearch` |
| status | `status-active`, `status-completed`, `status-evergreen` |
| year | `year-YYYY` (문서의 연도) |
