# LLM 본문 기반 분류 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제목 정규식(rule) 중심 분류 체인을 폐기하고, 페이지 본문 기반 LLM 1차 판단 체인(`human → structural → inline-llm(본문) → fallback(미분류+LLM 의견)`)으로 교체한다.

**Architecture:** 분류 체인 오케스트레이터(`classification_provider.js`)의 rule 단계를 제거하고 structural check(이미 폴더에 있으면 유지)와 본문 기반 LLM 단계를 삽입한다. LLM은 `callLLMForClassification`이 조립한 system prompt(자연어 지침 파일 + 폴더 트리)와 user message(제목 + 본문 2000자)를 받고 `select_folder` tool_use로 `{folderId, labels, reason, confidence}`를 응답한다. confidence `low`는 폴더로 보내지 않고 `미분류` + Confluence 코멘트로 LLM 의견을 첨부해 사람 검토 루프의 입력으로 쓴다. `classifyWithChain(ctx, aaTree, deps)` 시그니처는 유지하므로 migrator/audit/reorganize/report 호출 코드는 최소 변경만 필요하다.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert`, `@anthropic-ai/sdk` ^0.115.0, Confluence Cloud REST v1/v2, 모델 `claude-haiku-4-5-20251001` (env `ANTHROPIC_MODEL` override).

## Global Constraints

- **테스트 규약**: `node:test` + `node:assert`, 모든 외부 의존(네트워크·디스크·LLM client)은 deps 주입으로 차단. 새 코드는 TDD(RED → GREEN → REFACTOR). (CLAUDE.md §5)
- **시그니처 호환**: `classifyWithChain(ctx, aaTree, deps)` 유지. `classifyPage(ctx, aaTree, deps)` 유지 — `report_aa_daily.js`가 `{ruleClassifier: null, llm: require('./utils/llm_api'), systemHasKey}` deps와 `{page: {id, title}, ancestors}` ctx로 직접 호출한다. 이 경로는 깨지면 안 된다.
- **LLM**: 공식 Anthropic SDK만 사용. 기본 모델 `claude-haiku-4-5-20251001`, env `ANTHROPIC_MODEL` override. `ANTHROPIC_API_KEY` 부재 시 LLM 단계 skip → fallback (비용·보안 가드, 테스트로 보호).
- **비밀 정보**: `.env` 절대 커밋 금지. API 키는 GitHub Actions Secrets.
- **Confluence API**: v2 우선, v1은 라벨·코멘트·`expand=body.storage` 전용. rate limit 5000 req/h — 본문 fetch는 재분류 후보 페이지만 (reorganize의 skip 필터 통과 후).
- **dry-run 우선**: 실서비스 변경 스크립트는 `*:dryrun`으로 검증 후 실실행.
- **문서 동기화**: 체인 변경 시 `reference/classification_rules.md` 갱신은 해당 문서 §6 변경 절차의 강제 요구사항.
- **Windows CRLF**: 가이드 문서 LF→CRLF 경고 무시 가능.

## Scope

**이 플랜 (핵심 재설계)** — HANDOFF.md §3-5의 1~5번:
1. 본문 추출 유틸 → Task 1
2. 자연어 지침 파일 + 프롬프트 빌더 → Task 2
3. LLM 분류 프롬프트/호출 재설계 → Task 3
4. 분류 체인 재편 → Task 4
5. 엔진 와이어링(실 client + 본문 전달) → Task 5
6. 미분류 의견 첨부(reorganize + 코멘트 API) → Task 6
7. 문서 동기화 + 검증 → Task 7

**뒤따르는 별도 플랜 (이번 범위 아님)**:
- §4 advisory LLM 키워드-가중치 대체 (HANDOFF §3-5의 6번) — `report_aa_daily.js`/`recommend_misplacements.js`의 confidence 산출. 현재 `classifyPage` 직접 호출 경로는 이 플랜 이후에도 `{ok:false, reason:'no-client'}` miss로 기존과 동일 동작한다(회귀 없음).
- 지침 학습 루프 (HANDOFF §3-5의 7번) — 사람 이동 → 지침 파일 업데이트 워크플로우, `classification_decisions.json` 역할 재정의.
- 워크플로우 순서 변경(`migrate → daily-report`), §2 루프 A 실데이터 (HANDOFF §3-6).

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `scripts/utils/content_extractor.js` | 생성 | Confluence storage HTML → 평문 본문 텍스트 (`stripHtml`, `truncateContent`, `extractBodyText`). 순수 함수, 외부 의존 없음. |
| `tests/utils/content_extractor.test.js` | 생성 | 위 모듈 단위 테스트. |
| `reference/classification_guidelines.md` | 생성 | 폴더별 판단 기준·예시·라벨 사전·confidence 규칙. LLM system prompt에 주입되는 자연어 지침 SSOT. |
| `scripts/utils/classification_prompt.js` | 생성 | `loadGuidelines()`, `SELECT_FOLDER_TOOL` 스키마, `buildSystemPrompt`, `buildUserMessage`. |
| `tests/utils/classification_prompt.test.js` | 생성 | 프롬프트 조립 + 지침↔카테고리 동기화 가드 테스트. |
| `scripts/utils/llm_api.js` | 수정 | 기존 `callLLM` 정규화에 `confidence`/`opinion` 필드 추가(하위호환), `callLLMForClassification` 추가. |
| `tests/utils/llm_api.test.js` | 수정 | 신규 함수 + 확장 필드 테스트 추가. |
| `scripts/utils/classification_provider.js` | 재작성 | 체인 `human → structural → llm → fallback(+의견)`. rule 단계 제거. |
| `tests/utils/classification_provider.test.js` | 재작성 | 새 체인 테스트로 교체. |
| `scripts/classifiers/engine.js` | 재작성 | 실 Anthropic client 지연 생성(기존 dead-LLM 버그 수정), guidelines 로딩, 본문 전달 어댑터. |
| `tests/classifiers/engine.test.js` | 재작성 | 어댑터 와이어링 테스트로 교체. |
| `scripts/utils/migration_utils.js` | 수정 | `addComment(pageId, htmlBody)` 추가 (v1 child/comment). |
| `scripts/reorganize_aa_space.js` | 수정 | 후보 페이지 본문 fetch(`deps.fetchBody`), fallback 시 의견 코멘트 첨부(`deps.comment`), `formatOpinionComment`. |
| `tests/report/reorganize.test.js` | 수정 | 본문 fetch·코멘트 첨부 테스트 추가. |
| `reference/classification_rules.md` | 수정 | §2 체인 정책, §4 결과 스키마, §3 SSOT 역할 변경, 변경 절차 테이블. |
| `docs/USER_GUIDE.md` | 수정 | §1.6 분류 체인 다이어그램. |
| `CLAUDE.md` | 수정 | §2 아키텍처 체인 설명 + "사용하지 않음" 목록의 human.js 오기 정정. |

**전제 조건**: 시작 시점에 미커밋 상태인 유틸 스크립트 변경(HANDOFF §2)이 커밋되어 작업 트리가 깨끗해야 한다 (실행 시점에 확인).

---

## Task 1: 본문 추출 유틸 (`content_extractor.js`)

**Files:**
- Create: `scripts/utils/content_extractor.js`
- Test: `tests/utils/content_extractor.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `stripHtml(html: string|null|undefined): string` — HTML 태그·주석·script/style 제거, 엔티티 디코드, 공백 collapse.
  - `truncateContent(text: string|null|undefined, maxChars?: number): string` — 앞 N자 절단 (기본 2000).
  - `extractBodyText(storageHtml: string|null|undefined, maxChars?: number): string` — info 매크로(이관 배너) 제거 → stripHtml → truncate 합성.
  - `DEFAULT_MAX_CHARS = 2000`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/utils/content_extractor.test.js`:

```javascript
'use strict';
// content_extractor 단위 테스트. 순수 함수 — deps 불필요.
const test = require('node:test');
const assert = require('node:assert');

const {
  stripHtml, truncateContent, extractBodyText, DEFAULT_MAX_CHARS,
} = require('../../scripts/utils/content_extractor');

test('stripHtml: 태그 제거 + 공백 collapse', () => {
  assert.strictEqual(stripHtml('<p>hello</p><p>world</p>'), 'hello world');
  assert.strictEqual(stripHtml('<div><span>a</span>\n\n  <b>b</b></div>'), 'a b');
});

test('stripHtml: 엔티티 디코드', () => {
  assert.strictEqual(stripHtml('A &amp; B &lt;C&gt; &quot;D&quot; E&#39;s&nbsp;F'), 'A & B <C> "D" E\'s F');
});

test('stripHtml: script/style 내용은 통째 제거', () => {
  assert.strictEqual(stripHtml('a<script>alert(1)</script>b<style>.x{}</style>c'), 'a b c');
});

test('stripHtml: HTML 주석 제거', () => {
  assert.strictEqual(stripHtml('a<!-- comment -->b'), 'a b');
});

test('stripHtml: null/empty/비문자열 → 빈 문자열', () => {
  assert.strictEqual(stripHtml(null), '');
  assert.strictEqual(stripHtml(undefined), '');
  assert.strictEqual(stripHtml(''), '');
  assert.strictEqual(stripHtml(42), '');
});

test('truncateContent: maxChars 초과분 절단', () => {
  assert.strictEqual(truncateContent('abcdefghij', 4), 'abcd');
});

test('truncateContent: 짧으면 원본 유지', () => {
  assert.strictEqual(truncateContent('abc', 2000), 'abc');
});

test('truncateContent: 기본값 2000', () => {
  assert.strictEqual(DEFAULT_MAX_CHARS, 2000);
  assert.strictEqual(truncateContent('x'.repeat(3000)).length, 2000);
});

test('truncateContent: null/empty → 빈 문자열', () => {
  assert.strictEqual(truncateContent(null), '');
  assert.strictEqual(truncateContent(''), '');
});

test('extractBodyText: info 매크로(이관 배너) 제거 후 평문 추출', () => {
  const html = '<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body>'
    + '<p>📌 [자동 이관 문서]</p><table><tr><td>원본 스페이스</td><td>SD</td></tr></table>'
    + '</ac:rich-text-body></ac:structured-macro><hr /><p>실제 본문 내용</p>';
  const out = extractBodyText(html);
  assert.ok(out.includes('실제 본문 내용'));
  assert.ok(!out.includes('자동 이관 문서'), '배너 텍스트는 제거되어야 함');
  assert.ok(!out.includes('원본 스페이스'), '배너 테이블도 제거되어야 함');
});

test('extractBodyText: code 매크로는 제거하지 않음 (본문 내용의 일부)', () => {
  const html = '<ac:structured-macro ac:name="code"><ac:plain-text-body>const x = 1;</ac:plain-text-body></ac:structured-macro>';
  assert.ok(extractBodyText(html).includes('const x = 1;'));
});

test('extractBodyText: 절단 + null 안전', () => {
  assert.strictEqual(extractBodyText('<p>' + '가'.repeat(5000) + '</p>', 100).length, 100);
  assert.strictEqual(extractBodyText(null), '');
  assert.strictEqual(extractBodyText(''), '');
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/utils/content_extractor.test.js`
Expected: FAIL — `Cannot find module '../../scripts/utils/content_extractor'`

- [ ] **Step 3: 최소 구현 작성**

`scripts/utils/content_extractor.js`:

```javascript
'use strict';
// Confluence storage format HTML → LLM 분류 입력용 평문 본문.
// 순수 함수 — 네트워크/디스크 의존 없음.
// info 매크로(이관 배너)는 메타데이터 잡음이므로 본문에서 제외한다.
// code 등 그 외 매크로의 텍스트 내용(CDATA 포함)은 본문 신호로 보존한다.

const DEFAULT_MAX_CHARS = 2000;

const INFO_MACRO_RE = /<ac:structured-macro\b[^>]*\bac:name="info"[^>]*>[\s\S]*?<\/ac:structured-macro>/gi;

const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};
const ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g;

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY_RE, (m) => ENTITY_MAP[m])
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateContent(text, maxChars = DEFAULT_MAX_CHARS) {
  if (!text || typeof text !== 'string') return '';
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function extractBodyText(storageHtml, maxChars = DEFAULT_MAX_CHARS) {
  if (!storageHtml || typeof storageHtml !== 'string') return '';
  return truncateContent(stripHtml(storageHtml.replace(INFO_MACRO_RE, ' ')), maxChars);
}

module.exports = { stripHtml, truncateContent, extractBodyText, DEFAULT_MAX_CHARS };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/utils/content_extractor.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add scripts/utils/content_extractor.js tests/utils/content_extractor.test.js
git commit -m "feat(classify): add content_extractor — storage HTML → plain body text

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 자연어 지침 파일 + 프롬프트 빌더

**Files:**
- Create: `reference/classification_guidelines.md`
- Create: `scripts/utils/classification_prompt.js`
- Test: `tests/utils/classification_prompt.test.js`

**Interfaces:**
- Consumes: Task 1 없음(독립). `config/analysis_rules.json`은 동기화 테스트에서만 읽는다.
- Produces:
  - `GUIDELINES_PATH: string`
  - `loadGuidelines(guidelinesPath?: string): string` — 파일 읽기(기본 경로 mtime 캐시). 실패 시 경고 후 `''` 반환.
  - `SELECT_FOLDER_TOOL: object` — Anthropic tool 정의. `input_schema.required = ['folderId', 'confidence']`, `confidence`는 `enum ['high','low']`.
  - `buildSystemPrompt({ treeText, guidelines }): string`
  - `buildUserMessage({ title, bodyText }): string`

- [ ] **Step 1: 지침 파일 작성**

`reference/classification_guidelines.md` (아래 내용 그대로 생성):

````markdown
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
전사 공통 개발 가이드·프로세스. Git 전략·브랜치 전략, CI/CD, PR 리뷰 가이드, 코딩 컨벤션, MPS 작성 프로세스, 형상관리 가이드. 오래 써도 닳지 않는(evergreen) 안내문.
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
````

- [ ] **Step 2: 프롬프트 빌더의 실패하는 테스트 작성**

`tests/utils/classification_prompt.test.js`:

```javascript
'use strict';
// classification_prompt 단위 테스트.
// loadGuidelines는 path 주입으로 디스크 의존을 제어하고, 기본 경로 동기화는 가드 테스트로 검증.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  loadGuidelines, SELECT_FOLDER_TOOL, buildSystemPrompt, buildUserMessage, GUIDELINES_PATH,
} = require('../../scripts/utils/classification_prompt');

test('loadGuidelines: 주입 경로에서 파일 내용을 읽어온다', () => {
  const tmp = path.join(__dirname, 'tmp_guidelines_test.md');
  fs.writeFileSync(tmp, '# 지침\n테스트 내용', 'utf8');
  try {
    assert.strictEqual(loadGuidelines(tmp), '# 지침\n테스트 내용');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('loadGuidelines: 파일 없으면 경고 후 빈 문자열 (throw 금지)', () => {
  assert.strictEqual(loadGuidelines(path.join(__dirname, 'no_such_file_xyz.md')), '');
});

test('SELECT_FOLDER_TOOL: folderId·confidence 필수, confidence는 high/low enum', () => {
  assert.strictEqual(SELECT_FOLDER_TOOL.name, 'select_folder');
  const schema = SELECT_FOLDER_TOOL.input_schema;
  assert.ok(schema.required.includes('folderId'));
  assert.ok(schema.required.includes('confidence'));
  assert.deepStrictEqual(schema.properties.confidence.enum, ['high', 'low']);
  assert.ok(schema.properties.labels);
  assert.ok(schema.properties.reason);
});

test('buildSystemPrompt: 트리 + 지침 + confidence 규칙을 모두 포함', () => {
  const sys = buildSystemPrompt({ treeText: '- 폴더A (id: f-1)', guidelines: 'GUIDELINE_MARKER' });
  assert.ok(sys.includes('- 폴더A (id: f-1)'));
  assert.ok(sys.includes('GUIDELINE_MARKER'));
  assert.ok(sys.includes('confidence'));
  assert.ok(sys.includes('select_folder'));
});

test('buildUserMessage: 제목 + 본문을 포함', () => {
  const msg = buildUserMessage({ title: '월간 MPS 3월', bodyText: '본문텍스트' });
  assert.ok(msg.includes('월간 MPS 3월'));
  assert.ok(msg.includes('본문텍스트'));
});

test('buildUserMessage: 빈 본문/제목도 안전', () => {
  const msg = buildUserMessage({ title: '', bodyText: '' });
  assert.ok(typeof msg === 'string' && msg.length > 0);
});

// 동기화 가드: analysis_rules.json의 명시 카테고리(비 catch-all) 폴더명은
// 지침 파일에 모두 등장해야 한다 — 한쪽만 수정되는 사고 방지.
test('동기화 가드: guidelines ⊇ analysis_rules.json 카테고리 폴더명', () => {
  const rules = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'config', 'analysis_rules.json'), 'utf8'));
  const guidelines = loadGuidelines(GUIDELINES_PATH);
  const names = rules.categories.filter(c => !c.is_catch_all).map(c => c.name);
  assert.ok(names.length >= 10, '카테고리 수가 비정상적으로 적음');
  for (const name of names) {
    assert.ok(guidelines.includes(name), `지침 파일에 카테고리 "${name}" 섹션이 없음`);
  }
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run: `node --test tests/utils/classification_prompt.test.js`
Expected: FAIL — `Cannot find module '../../scripts/utils/classification_prompt'`

- [ ] **Step 4: 구현 작성**

`scripts/utils/classification_prompt.js`:

```javascript
'use strict';
// LLM 분류 프롬프트 조립. 지침 파일(reference/classification_guidelines.md)을
// system prompt에 주입하고 select_folder tool 스키마를 정의한다.
const fs = require('fs');
const path = require('path');

const GUIDELINES_PATH = path.join(__dirname, '..', '..', 'reference', 'classification_guidelines.md');

let cache = null;
let cacheMtime = 0;

function loadGuidelines(guidelinesPath = GUIDELINES_PATH) {
  try {
    const stat = fs.statSync(guidelinesPath);
    if (guidelinesPath === GUIDELINES_PATH && cache !== null && stat.mtimeMs === cacheMtime) return cache;
    const txt = fs.readFileSync(guidelinesPath, 'utf8');
    if (guidelinesPath === GUIDELINES_PATH) { cache = txt; cacheMtime = stat.mtimeMs; }
    return txt;
  } catch (e) {
    console.warn(`⚠️ guidelines 로드 실패 (${e.message}) — 빈 지침으로 계속합니다.`);
    return '';
  }
}

const SELECT_FOLDER_TOOL = {
  name: 'select_folder',
  description: 'AA 스페이스 폴더 트리에서 문서가 속할 폴더를 정확히 하나 골라 응답한다.',
  input_schema: {
    type: 'object',
    required: ['folderId', 'confidence'],
    properties: {
      folderId: { type: 'string', description: '제시된 폴더 트리의 폴더 ID' },
      labels: { type: 'array', items: { type: 'string' }, description: '라벨 사전에서 고른 라벨 목록' },
      reason: { type: 'string', description: '판단 근거 1~2문장' },
      confidence: {
        type: 'string',
        enum: ['high', 'low'],
        description: 'high: 명확히 부합. low: 확신 부족(시스템이 미분류로 처리)',
      },
    },
  },
};

function buildSystemPrompt({ treeText, guidelines }) {
  return [
    '당사는 사내 Confluence AA 스페이스(덴탈AI연구소 Archive)의 문서를 폴더로 자동 분류하는 시스템이다.',
    '당신의 임무는 주어진 문서(제목 + 본문 발췌)를 아래 폴더 트리 중 가장 적합한 폴더 하나에 배정하는 것이다.',
    '',
    '반드시 select_folder 도구를 정확히 한 번 호출해서 응답한다. 텍스트로만 답하지 않는다.',
    'folderId는 아래 트리에 나열된 ID 중 하나여야 한다. 존재하지 않는 ID를 만들지 않는다.',
    'labels는 지침의 라벨 사전에서 2개 이상 골라 제안한다. 사전에 없는 라벨은 사용하지 않는다.',
    '',
    '## confidence 규칙',
    '- high: 본문(본문이 비어 있으면 제목)만으로 한 폴더에 명확히 부합할 때만.',
    '- low: 본문이 비어 있거나 너무 짧을 때, 둘 이상 폴더가 경합할 때, 어느 기준에도 명확히 맞지 않을 때.',
    '- low여도 가장 그럴듯한 후보 folderId와 reason을 담는다. 최종 배치는 시스템이 결정한다.',
    '',
    '## 현재 AA 폴더 트리',
    '<folder_tree>',
    treeText || '(트리 없음)',
    '</folder_tree>',
    '',
    '## 분류 지침',
    '<guidelines>',
    guidelines || '(지침 없음)',
    '</guidelines>',
  ].join('\n');
}

function buildUserMessage({ title, bodyText }) {
  return [
    '# 대상 문서',
    `- 제목: ${title || '(없음)'}`,
    '',
    '# 본문 발췌 (앞부분)',
    bodyText || '(비어 있음)',
  ].join('\n');
}

module.exports = { GUIDELINES_PATH, loadGuidelines, SELECT_FOLDER_TOOL, buildSystemPrompt, buildUserMessage };
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/utils/classification_prompt.test.js`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
git add reference/classification_guidelines.md scripts/utils/classification_prompt.js tests/utils/classification_prompt.test.js
git commit -m "feat(classify): add natural-language guidelines + prompt builder

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: `callLLMForClassification` + 정규화 확장 (`llm_api.js`)

**Files:**
- Modify: `scripts/utils/llm_api.js`
- Modify: `tests/utils/llm_api.test.js` (기존 테스트 유지 + 신규 추가)

**Interfaces:**
- Consumes: Task 2의 `buildSystemPrompt`, `buildUserMessage`, `SELECT_FOLDER_TOOL`; Task 1의 `extractBodyText`.
- Produces:
  - `callLLM` 정규화 결과에 선택 필드 추가 (하위호환): 성공 시 `confidence`(원본 값 passthrough, 미상이면 `undefined`), `no-folder-id` miss 시 `opinion: string|null` (모델의 reason 텍스트).
  - `callLLMForClassification({ client, title, body, treeText, guidelines, model, max_tokens, callFn }): Promise<Result>`
    - 내부: `extractBodyText(body)` → `buildUserMessage` → `buildSystemPrompt` → `callFn({client, system, user, tools:[SELECT_FOLDER_TOOL], model, max_tokens})` (`callFn` 기본값 = `callLLM`).
    - 고신뢰 성공: `{ ok: true, source: 'inline-llm', folderId, labels, reason, confidence: 'high' }`
    - 저신뢰: `{ ok: false, source: 'miss', reason: 'low-confidence', opinion, suggestedFolderId }`
    - 그 외 miss: `{ ok: false, source: 'miss', reason, opinion: null }`

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/utils/llm_api.test.js` 파일 끝에 추가:

```javascript
// ── Task 3: callLLMForClassification + 확장 정규화 ──────────────────────────
const { callLLMForClassification } = require('../../scripts/utils/llm_api');

test('callLLM: 성공 결과에 confidence passthrough', async () => {
  const client = fakeClient([
    { type: 'tool_use', name: 'select_folder', input: { folderId: 'F-1', confidence: 'high', reason: 'r' } },
  ]);
  const out = await callLLM({ client, system: 's', user: 'u', tools: [], model: 'm' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.confidence, 'high');
});

test('callLLM: no-folder-id miss는 모델 reason을 opinion에 담는다', async () => {
  const client = fakeClient([
    { type: 'tool_use', name: 'select_folder', input: { reason: '본문이 MPS처럼 보임' } },
  ]);
  const out = await callLLM({ client, system: 's', user: 'u', tools: [], model: 'm' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'no-folder-id');
  assert.strictEqual(out.opinion, '본문이 MPS처럼 보임');
});

test('callLLMForClassification: system/user/tools를 조립해서 callFn에 전달', async () => {
  let received = null;
  const callFn = async (arg) => { received = arg; return { ok: true, source: 'inline-llm', folderId: 'F-9', labels: ['group-ai'], reason: '명확', confidence: 'high' }; };
  const out = await callLLMForClassification({
    client: {}, title: '월간 MPS', body: '<p>MPS 본문</p>',
    treeText: '- MPS 이력 (id: F-9)', guidelines: 'GUIDE', callFn,
  });
  assert.ok(received.system.includes('GUIDE'));
  assert.ok(received.system.includes('- MPS 이력 (id: F-9)'));
  assert.ok(received.user.includes('월간 MPS'));
  assert.ok(received.user.includes('MPS 본문'), 'HTML이 추출된 평문이 들어가야 함');
  assert.ok(!received.user.includes('<p>'), '태그는 들어가면 안 됨');
  assert.strictEqual(received.tools.length, 1);
  assert.strictEqual(received.tools[0].name, 'select_folder');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.folderId, 'F-9');
  assert.strictEqual(out.confidence, 'high');
});

test('callLLMForClassification: confidence low → miss + opinion + suggestedFolderId', async () => {
  const callFn = async () => ({ ok: true, source: 'inline-llm', folderId: 'F-3', labels: [], reason: '둘 다 비슷', confidence: 'low' });
  const out = await callLLMForClassification({ client: {}, title: 't', body: '', treeText: '', guidelines: '', callFn });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'low-confidence');
  assert.strictEqual(out.opinion, '둘 다 비슷');
  assert.strictEqual(out.suggestedFolderId, 'F-3');
});

test('callLLMForClassification: confidence 미상(undefined)은 low로 취급', async () => {
  const callFn = async () => ({ ok: true, source: 'inline-llm', folderId: 'F-3', labels: [], reason: 'r' });
  const out = await callLLMForClassification({ client: {}, title: 't', body: '', treeText: '', guidelines: '', callFn });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'low-confidence');
});

test('callLLMForClassification: callFn miss는 reason/opinion 통과', async () => {
  const callFn = async () => ({ ok: false, source: 'miss', reason: 'no-tool-use', opinion: null });
  const out = await callLLMForClassification({ client: {}, title: 't', body: '', treeText: '', guidelines: '', callFn });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'no-tool-use');
  assert.strictEqual(out.opinion, null);
});

test('callLLMForClassification: 기본 callFn은 callLLM — client 없으면 no-client miss', async () => {
  const out = await callLLMForClassification({ client: null, title: 't', body: '', treeText: '', guidelines: '' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'no-client');
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/utils/llm_api.test.js`
Expected: FAIL — `callLLMForClassification is not exported` / `confidence`·`opinion` 필드 없음

- [ ] **Step 3: `llm_api.js` 수정**

`scripts/utils/llm_api.js` 전체를 아래로 교체 (기존 `callLLM` 동작 유지 + 필드 2개 추가, 신규 함수 추가):

```javascript
'use strict';
// Anthropic SDK 1회 호출 wrapper. tool_use(select_folder) 결과를 정규화.
// deps.client 주입 가능(테스트에서 네트워크 차단). 실패는 throw하지 않고 {ok:false}로 흡수해
// per-page try/catch와 호환되게 한다.
// callLLMForClassification: 본문 기반 분류 전용 — prompt 조립 + confidence 해석을 추가한다.
const { buildSystemPrompt, buildUserMessage, SELECT_FOLDER_TOOL } = require('./classification_prompt');
const { extractBodyText } = require('./content_extractor');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

async function callLLM({ client, system, user, tools, model, max_tokens = 1024 } = {}) {
  const useModel = model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  if (!client) return { ok: false, source: 'miss', reason: 'no-client' };
  try {
    const msg = await client.messages.create({
      model: useModel,
      max_tokens,
      system,
      tools,
      messages: [{ role: 'user', content: user }],
    });
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolUse = blocks.find(b => b && b.type === 'tool_use' && b.name === 'select_folder');
    if (!toolUse) return { ok: false, source: 'miss', reason: 'no-tool-use' };
    const { folderId, labels, reason, confidence } = toolUse.input || {};
    if (!folderId) {
      // 모델이 폴더는 비웠지만 reason을 남겼을 수 있다 — 의견으로 보존.
      return { ok: false, source: 'miss', reason: 'no-folder-id', opinion: reason || null };
    }
    return {
      ok: true,
      source: 'inline-llm',
      folderId: String(folderId),
      labels: Array.isArray(labels) ? labels.filter(Boolean) : [],
      reason: reason || 'inline-llm',
      confidence, // passthrough — 미상이면 undefined
    };
  } catch (e) {
    return { ok: false, source: 'miss', reason: `api-error:${e.message}` };
  }
}

/**
 * 본문 기반 분류 전용 LLM 호출. body(storage HTML 가능)는 extractBodyText로 평문 추출·절단된다.
 * confidence 'high'만 분류 성공으로 인정하고, 'low'/미상은 미분류행 miss로 정규화하되
 * 모델의 의견(reason)과 잠정 후보(suggestedFolderId)는 보존한다.
 */
async function callLLMForClassification({
  client, title, body, treeText, guidelines, model, max_tokens = 1024, callFn = callLLM,
} = {}) {
  const system = buildSystemPrompt({ treeText, guidelines });
  const user = buildUserMessage({ title, bodyText: extractBodyText(body) });
  const r = await callFn({ client, system, user, tools: [SELECT_FOLDER_TOOL], model, max_tokens });
  if (!r || !r.ok) {
    return { ok: false, source: 'miss', reason: r?.reason || 'miss', opinion: r?.opinion || null };
  }
  if (r.confidence !== 'high') {
    return {
      ok: false, source: 'miss', reason: 'low-confidence',
      opinion: r.reason || null, suggestedFolderId: r.folderId || null,
    };
  }
  return {
    ok: true, source: 'inline-llm', folderId: r.folderId,
    labels: r.labels || [], reason: r.reason || 'inline-llm', confidence: 'high',
  };
}

module.exports = { callLLM, callLLMForClassification, DEFAULT_MODEL };
```

- [ ] **Step 4: llm_api 테스트 전체 통과 확인**

Run: `node --test tests/utils/llm_api.test.js`
Expected: PASS (기존 4 + 신규 7 = 11 tests)

- [ ] **Step 5: 커밋**

```bash
git add scripts/utils/llm_api.js tests/utils/llm_api.test.js
git commit -m "feat(classify): add callLLMForClassification with confidence-aware normalization

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 분류 체인 재편 (`classification_provider.js`)

**Files:**
- Rewrite: `scripts/utils/classification_provider.js`
- Rewrite: `tests/utils/classification_provider.test.js`

**Interfaces:**
- Consumes: deps `{ humanClassifier?, llm? }`. `deps.llm.callLLM({ctx, aaTree})`는 Task 5의 엔진 어댑터가 구현 — 반환 형태: `{ok, source?, folderId?, labels?, reason?, confidence?, opinion?, suggestedFolderId?}`.
- Produces:
  - `classifyPage(ctx, aaTree, deps)` — 체인 `human → structural → inline-llm → fallback(+의견)`. rule 단계 없음(`deps.ruleClassifier`는 무시 — `report_aa_daily.js`가 `ruleClassifier: null`을 계속 넘겨도 무해).
  - `structuralCheck(ctx, aaTree): object|null` — `ctx.currentFolderId`가 유효 폴더(`aaTree.hasFolder` true)이고 `unsortedFolderId`가 아니면 현재 위치 유지 결정 반환. `aaTree.hasFolder`가 함수가 아니거나(리포트 스텁) 폴더가 아니면 `null`.
  - `fallback(aaTree, info?)` — 결과에 `llmOpinion`, `suggestedFolderId` 필드 추가.
  - 분류 성공 결과: `{ok:true, source:'inline-llm', folderId, folderTitle?, labels, reason, confidence:'high'}`. `folderTitle`은 `aaTree.flat`에서 best-effort 해석.
  - LLM이 알 수 없는 folderId를 주면(`hasFolder` false) → `fallback({reason:'llm-unknown-folder', opinion})`.
  - 키 부재 시 skip → `fallback({reason:'llm-skipped-no-key'})`.

- [ ] **Step 1: 체인 테스트 교체 작성**

`tests/utils/classification_provider.test.js` 전체를 아래로 교체:

```javascript
'use strict';
// classification_provider 체인 테스트.
// 체인: human → structural → inline-llm(본문) → fallback(미분류+의견). rule 단계 제거됨.
// deps 주입으로 네트워크·디스크 완전 차단.
const test = require('node:test');
const assert = require('node:assert');

const { classifyPage, fallback, structuralCheck } = require('../../scripts/utils/classification_provider');

const aaTree = {
  unsortedFolderId: 'u-1',
  flat: [{ id: 'f-42', title: 'AI 관련' }, { id: 'f-7', title: 'MPS 이력 (전사)' }],
  tree: {},
  toText: () => '<tree>',
  hasFolder: (id) => ['f-42', 'f-7', 'u-1'].includes(id),
};

const baseCtx = { title: 'AI 회의록', body: '본문', sourceSpace: 'SD', ancestors: [], existingLabels: [] };

const HAS_KEY = 'test-anthropic-key';
process.env.ANTHROPIC_API_KEY = HAS_KEY;

test('chain: humanClassifier hit이면 즉시 반환 (structural/llm 미호출)', async () => {
  const calls = [];
  const humanClassifier = {
    classify: async () => { calls.push('human'); return { ok: true, source: 'human', folderId: 'f-human', labels: ['human-classified'], reason: 'dec-001' }; },
  };
  const llm = { callLLM: async () => { calls.push('llm'); return { ok: true, folderId: 'x', confidence: 'high' }; } };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'f-42' }, aaTree, { humanClassifier, llm });
  assert.strictEqual(out.source, 'human');
  assert.deepStrictEqual(calls, ['human']);
});

test('chain: human throw 시 structural로 안전하게 진행', async () => {
  const humanClassifier = { classify: async () => { throw new Error('human-boom'); } };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'f-42' }, aaTree, { humanClassifier });
  assert.strictEqual(out.source, 'structural');
  assert.strictEqual(out.folderId, 'f-42');
});

test('structural: 유효 폴더에 이미 있으면 유지 — llm 호출 없음', async () => {
  let llmCalled = false;
  const llm = { callLLM: async () => { llmCalled = true; return { ok: true, folderId: 'f-7', confidence: 'high' }; } };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'f-42' }, aaTree, { llm });
  assert.strictEqual(out.source, 'structural');
  assert.strictEqual(out.folderId, 'f-42');
  assert.strictEqual(out.folderTitle, 'AI 관련');
  assert.strictEqual(llmCalled, false);
});

test('structural: 현재 폴더가 미분류(u-1)면 유지하지 않고 llm으로', async () => {
  const llm = { callLLM: async () => ({ ok: true, source: 'inline-llm', folderId: 'f-7', labels: [], reason: 'r', confidence: 'high' }) };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'u-1' }, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
});

test('structural: hasFolder가 없는 스텁 트리(report 경로)에서는 발동 안 함', () => {
  const stub = { unsortedFolderId: 'u-1' };
  assert.strictEqual(structuralCheck({ currentFolderId: 'f-42' }, stub), null);
});

test('structural: currentFolderId가 트리 미지 폴더면 null → 체인 계속', async () => {
  const llm = { callLLM: async () => ({ ok: true, folderId: 'f-7', labels: [], reason: 'r', confidence: 'high' }) };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'ghost' }, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
});

test('chain: llm high-confidence hit → 정규화 결과 + confidence + folderTitle 해석', async () => {
  let received = null;
  const llm = {
    callLLM: async (arg) => { received = arg; return { ok: true, source: 'inline-llm', folderId: 'f-7', labels: ['group-rnd'], reason: 'MPS 본문', confidence: 'high' }; },
  };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
  assert.strictEqual(out.folderTitle, 'MPS 이력 (전사)');
  assert.strictEqual(out.confidence, 'high');
  assert.deepStrictEqual(out.labels, ['group-rnd']);
  assert.ok(received.ctx === baseCtx && received.aaTree === aaTree, 'deps.llm은 {ctx, aaTree}로 호출');
});

test('chain: llm이 트리 미지 folderId를 주면 fallback + 의견 보존', async () => {
  const llm = { callLLM: async () => ({ ok: true, folderId: 'not-in-tree', reason: '환상의 폴더', confidence: 'high' }) };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.strictEqual(out.reason, 'llm-unknown-folder');
  assert.strictEqual(out.llmOpinion, '환상의 폴더');
});

test('chain: llm low-confidence miss → fallback + opinion + suggestedFolderId', async () => {
  const llm = { callLLM: async () => ({ ok: false, source: 'miss', reason: 'low-confidence', opinion: 'DN과 Device 경합', suggestedFolderId: 'f-42' }) };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.deepStrictEqual(out.labels, ['needs-review']);
  assert.strictEqual(out.reason, 'low-confidence');
  assert.strictEqual(out.llmOpinion, 'DN과 Device 경합');
  assert.strictEqual(out.suggestedFolderId, 'f-42');
});

test('chain: 기계적 miss(no-tool-use) → fallback, 의견은 null', async () => {
  const llm = { callLLM: async () => ({ ok: false, source: 'miss', reason: 'no-tool-use', opinion: null }) };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.reason, 'no-tool-use');
  assert.strictEqual(out.llmOpinion, null);
});

test('chain: ANTHROPIC_API_KEY 없으면 llm skip → fallback(llm-skipped-no-key)', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    let llmCalled = false;
    const llm = { callLLM: async () => { llmCalled = true; return { ok: false }; } };
    const out = await classifyPage(baseCtx, aaTree, { llm });
    assert.strictEqual(out.source, 'fallback');
    assert.strictEqual(out.reason, 'llm-skipped-no-key');
    assert.strictEqual(llmCalled, false, '키 없으면 LLM 호출 금지');
  } finally {
    process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('chain: llm throw 시 fallback으로 흡수', async () => {
  const llm = { callLLM: async () => { throw new Error('llm-boom'); } };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
});

test('chain: ruleClassifier를 deps에 넘겨도 무시된다 (rule 단계 제거)', async () => {
  let ruleCalled = false;
  const ruleClassifier = { classify: async () => { ruleCalled = true; return { ok: true, folderId: 'f-42' }; } };
  const llm = { callLLM: async () => ({ ok: true, folderId: 'f-7', labels: [], reason: 'r', confidence: 'high' }) };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  assert.strictEqual(ruleCalled, false);
  assert.strictEqual(out.source, 'inline-llm');
});

test('fallback: info 없으면 기본 reason, labels는 needs-review', () => {
  const out = fallback(aaTree);
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.strictEqual(out.folderTitle, '미분류');
  assert.deepStrictEqual(out.labels, ['needs-review']);
  assert.strictEqual(out.reason, 'no-classifier-matched');
  assert.strictEqual(out.llmOpinion, null);
  assert.strictEqual(out.suggestedFolderId, null);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/utils/classification_provider.test.js`
Expected: FAIL (structural 단계 없음, `confidence` 미처리, `llmOpinion` 없음 등)

- [ ] **Step 3: `classification_provider.js` 재작성**

`scripts/utils/classification_provider.js` 전체 교체:

```javascript
'use strict';
// 분류 체인 오케스트레이터: human → structural → inline-llm(본문) → fallback(미분류+의견).
// rule 단계 제거(2026-07-31 재설계) — 제목 regex 대신 자연어 지침 + 본문 기반 LLM 판단.
// deps.humanClassifier / deps.llm.callLLM 주입으로 테스트 격리.
// ANTHROPIC_API_KEY 없으면 llm 단계 skip (비용/안전 가드).

function fallback(aaTree, info = {}) {
  return {
    ok: true,
    source: 'fallback',
    folderId: aaTree.unsortedFolderId,
    folderTitle: '미분류',
    labels: ['needs-review'],
    reason: info.reason || 'no-classifier-matched',
    llmOpinion: info.opinion || null,
    suggestedFolderId: info.suggestedFolderId || null,
  };
}

/**
 * 구조적 검증: 이미 유효 폴더에 있으면 LLM 호출 없이 현 위치 유지.
 * 미분류 폴더에 있거나, 트리 미지 폴더거나, hasFolder가 없는 스텁 트리면 null(체인 계속).
 */
function structuralCheck(ctx, aaTree) {
  const cur = ctx && ctx.currentFolderId;
  if (!cur) return null;
  if (cur === aaTree.unsortedFolderId) return null;
  if (typeof aaTree.hasFolder === 'function' && !aaTree.hasFolder(cur)) return null;
  const folderTitle = Array.isArray(aaTree.flat)
    ? aaTree.flat.find(f => f.id === cur)?.title
    : undefined;
  return {
    ok: true,
    source: 'structural',
    folderId: cur,
    folderTitle,
    labels: [],
    reason: 'already-in-folder',
  };
}

async function classifyPage(ctx, aaTree, deps) {
  const { humanClassifier, llm } = deps || {};
  const systemHasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  // 0) human decision (classification_decisions.json, prior human UI moves)
  if (humanClassifier && typeof humanClassifier.classify === 'function') {
    let humanResult = null;
    try {
      humanResult = await humanClassifier.classify(ctx, aaTree);
    } catch (_) {
      humanResult = null;
    }
    if (humanResult && humanResult.ok && humanResult.folderId) return humanResult;
  }

  // 1) structural check (이미 폴더에 있으면 LLM 호출 절감)
  const structural = structuralCheck(ctx, aaTree);
  if (structural) return structural;

  // 2) inline-llm — 본문 기반 1차 판단자 (키 없으면 skip)
  if (systemHasKey && llm && typeof llm.callLLM === 'function') {
    let llmResult = null;
    try {
      llmResult = await llm.callLLM({ ctx, aaTree });
    } catch (_) {
      llmResult = null;
    }
    if (llmResult && llmResult.ok && llmResult.folderId) {
      const folderId = String(llmResult.folderId);
      if (typeof aaTree.hasFolder === 'function' && !aaTree.hasFolder(folderId)) {
        return fallback(aaTree, { reason: 'llm-unknown-folder', opinion: llmResult.reason || null });
      }
      const folderTitle = Array.isArray(aaTree.flat)
        ? aaTree.flat.find(f => f.id === folderId)?.title
        : undefined;
      return {
        ok: true,
        source: 'inline-llm',
        folderId,
        folderTitle,
        labels: Array.isArray(llmResult.labels) ? llmResult.labels.filter(Boolean) : [],
        reason: llmResult.reason || 'inline-llm',
        confidence: 'high',
      };
    }
    // low-confidence / miss — 의견은 fallback에 실어 코멘트 첨부 등에 쓴다.
    return fallback(aaTree, {
      reason: (llmResult && llmResult.reason) || 'llm-miss',
      opinion: (llmResult && llmResult.opinion) || null,
      suggestedFolderId: (llmResult && llmResult.suggestedFolderId) || null,
    });
  }

  // 3) fallback (키 부재 또는 llm deps 없음)
  return fallback(aaTree, { reason: systemHasKey ? 'no-llm-deps' : 'llm-skipped-no-key' });
}

module.exports = { classifyPage, fallback, structuralCheck };
```

- [ ] **Step 4: provider 테스트 통과 확인**

Run: `node --test tests/utils/classification_provider.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: 전체 스위트 실행 — report 오케스트레이터 회귀 확인**

Run: `npm test`
Expected: 185 + 신규 전체 PASS.
`tests/report/orchestrator_misplacement.test.js`·`orchestrator_llm_wire.test.js`는 `classifyPage`를 mock deps로 호출한다 — 새 fallback reason 문자열(`'no-client'` 등)을 단정하지 않으므로 통과해야 한다. 만약 reason 텍스트를 단정하는 테스트가 실패하면, 그 단정을 새 스키마(`source === 'fallback'` + `folderId === unsortedFolderId`)에 맞춰 갱신한다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/utils/classification_provider.js tests/utils/classification_provider.test.js tests/report/
git commit -m "refactor(classify): chain human → structural → llm(content) → fallback(+opinion)

rule 단계 제거. fallback은 LLM 의견·잠정 후보를 보존한다.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(Step 5에서 report 테스트를 수정했다면 그 파일도 함께 add)

---

## Task 5: 엔진 와이어링 — 실 client + 본문 전달 (`engine.js`)

**Files:**
- Rewrite: `scripts/classifiers/engine.js`
- Rewrite: `tests/classifiers/engine.test.js`

**배경 (코드 사실):** 기존 `engine.js`는 `client: deps?.anthropicClient || null`을 기본으로 주어, **프로덕션에서 LLM 단계가 실제로는 절대 호출되지 않는 dead-LLM 상태**였다(migrator·reorganize는 `anthropicClient`를 주입하지 않음). 이 태스크에서 키가 있으면 실 client를 지연 생성해 체인을 실제로 살린다.

**Interfaces:**
- Consumes: Task 3 `callLLMForClassification`, Task 2 `loadGuidelines`, 기존 `humanClassifier`.
- Produces: `classifyWithChain(ctx, aaTree, deps)` — 시그니처 동일. 기본 llm 어댑터가 `ctx.body`(storage HTML 가능)를 `callLLMForClassification({body})`에 그대로 전달(추출·절단은 그 내부에서). `deps` 오버라이드: `llm`, `anthropicClient`, `guidelines`, `model` (테스트 주입용).

- [ ] **Step 1: 엔진 테스트 교체 작성**

`tests/classifiers/engine.test.js` 전체 교체:

```javascript
// tests/classifiers/engine.test.js
// engine.js 와이어링 검증: 실 client 지연 생성 + 본문 전달 + guidelines 주입.
// anthropicClient 가짜 주입으로 네트워크 완전 차단.
'use strict';
process.env.ANTHROPIC_API_KEY = 'test-key-for-engine';
const test = require('node:test');
const assert = require('node:assert');
const { classifyWithChain } = require('../../scripts/classifiers/engine');

const aaTree = {
  unsortedFolderId: 'u-1',
  flat: [{ id: 'f-7', title: 'MPS 이력 (전사)' }],
  tree: {},
  toText: () => '- MPS 이력 (전사) (id: f-7)',
  hasFolder: (id) => ['f-7', 'u-1'].includes(id),
};

function fakeAnthropicClient(captured, contentBlocks) {
  return {
    messages: {
      create: async (req) => { captured.push(req); return { content: contentBlocks }; },
    },
  };
}

test('engine: 본문이 user message에 평문으로 들어가 LLM hit', async () => {
  const captured = [];
  const client = fakeAnthropicClient(captured, [
    { type: 'tool_use', name: 'select_folder', input: { folderId: 'f-7', labels: ['group-rnd'], reason: 'MPS 본문 확인', confidence: 'high' } },
  ]);
  const ctx = { title: '3월 계획', body: '<p>월간 MPS 작성 내용</p>', sourceSpace: 'SD', ancestors: [], existingLabels: [] };
  const out = await classifyWithChain(ctx, aaTree, { anthropicClient: client, guidelines: 'GUIDE_MARKER' });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
  assert.strictEqual(captured.length, 1);
  assert.ok(captured[0].messages[0].content.includes('월간 MPS 작성 내용'));
  assert.ok(!captured[0].messages[0].content.includes('<p>'), 'HTML 태그는 추출되어야 함');
  assert.ok(captured[0].system.includes('GUIDE_MARKER'), 'guidelines 주입');
  assert.ok(captured[0].system.includes('- MPS 이력 (전사) (id: f-7)'), 'aaTree.toText 주입');
});

test('engine: confidence low → fallback + 의견 보존', async () => {
  const captured = [];
  const client = fakeAnthropicClient(captured, [
    { type: 'tool_use', name: 'select_folder', input: { folderId: 'f-7', reason: '제목만으로는 모호', confidence: 'low' } },
  ]);
  const out = await classifyWithChain({ title: '회의록', body: '', sourceSpace: 'SD', ancestors: [], existingLabels: [] }, aaTree, { anthropicClient: client });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.llmOpinion, '제목만으로는 모호');
  assert.strictEqual(out.suggestedFolderId, 'f-7');
});

test('engine: human-classified 결정이 있으면 human 단계가 우선', async () => {
  // classification_decisions.json에 매칭이 없어도 체인은 정상 완주해야 함.
  const captured = [];
  const client = fakeAnthropicClient(captured, [{ type: 'text', text: 'no tool' }]);
  const out = await classifyWithChain({ title: '완전 미지 제목 zzz', body: '', sourceSpace: '?', ancestors: [], existingLabels: [] }, aaTree, { anthropicClient: client });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
});

test('engine: deps.llm 전체 주입 시 내장 어댑터 미사용 (호환 경로)', async () => {
  const llm = { callLLM: async () => ({ ok: true, source: 'inline-llm', folderId: 'f-7', labels: [], reason: 'stub', confidence: 'high' }) };
  const out = await classifyWithChain({ title: 't', body: '', ancestors: [], existingLabels: [] }, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/classifiers/engine.test.js`
Expected: FAIL (기존 engine은 body 미전달·guidelines 미주입 → captured user에 본문 없음 / system에 GUIDE_MARKER 없음)

- [ ] **Step 3: `engine.js` 재작성**

`scripts/classifiers/engine.js` 전체 교체:

```javascript
// scripts/classifiers/engine.js
// 분류 체인 호환 엔트리포인트. classifyWithChain(ctx, aaTree, deps) 시그니처 유지.
// 내부 체인: human → structural → inline-llm(본문) → fallback(미분류+의견).
// 2026-07-31 재설계: ANTHROPIC_API_KEY가 있으면 실 client를 지연 생성해 LLM 단계를 실제로 구동.
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { classifyPage } = require('../utils/classification_provider');
const { humanClassifier } = require('./human');
const { callLLMForClassification } = require('../utils/llm_api');
const { loadGuidelines } = require('../utils/classification_prompt');

let sharedClient;
let sharedClientInit = false;

// 프로세스당 1회만 SDK 로딩·생성. 키 없으면 null (provider가 단계 자체를 skip).
function defaultClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!sharedClientInit) {
    sharedClientInit = true;
    try {
      const { Anthropic } = require('@anthropic-ai/sdk');
      sharedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch (e) {
      console.warn(`⚠️ Anthropic SDK 생성 실패 (${e.message}) — LLM 단계 skip`);
      sharedClient = null;
    }
  }
  return sharedClient;
}

async function classifyWithChain(ctx, aaTree, deps) {
  const llm = deps?.llm || {
    callLLM: async ({ ctx: c, aaTree: t }) =>
      callLLMForClassification({
        client: deps?.anthropicClient !== undefined ? deps.anthropicClient : defaultClient(),
        title: c?.title || '',
        body: c?.body || '', // storage HTML 가능 — 추출·절단은 callLLMForClassification 내부
        treeText: t && typeof t.toText === 'function' ? t.toText() : '',
        guidelines: deps?.guidelines !== undefined ? deps.guidelines : loadGuidelines(),
        ...(deps?.model ? { model: deps.model } : {}),
      }),
  };
  return classifyPage(ctx, aaTree, { humanClassifier, llm });
}

module.exports = { classifyWithChain };
```

- [ ] **Step 4: 엔진 테스트 통과 확인**

Run: `node --test tests/classifiers/engine.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 전체 스위트 실행**

Run: `npm test`
Expected: 전체 PASS (기존 + 신규).

- [ ] **Step 6: 커밋**

```bash
git add scripts/classifiers/engine.js tests/classifiers/engine.test.js
git commit -m "fix(classify): engine wires real Anthropic client + body + guidelines

기존 dead-LLM 기본(client=null)을 지연 생성으로 교체.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: reorganize — 본문 fetch + 미분류 의견 코멘트 첨부

**Files:**
- Modify: `scripts/utils/migration_utils.js` (`addComment` 추가 + export)
- Modify: `scripts/reorganize_aa_space.js`
- Modify: `tests/report/reorganize.test.js` (기존 유지 + 신규 추가)

**Interfaces:**
- Consumes: Task 4 fallback 결과의 `llmOpinion`·`suggestedFolderId`; `migration_utils.fetchPageDetail`(기존), `escapeHtml`(기존).
- Produces:
  - `addComment(pageId, htmlBody): Promise` — v1 `POST /wiki/rest/api/content/{id}/child/comment`. 실패 시 throw (reorganize에서 `.catch`로 흡수).
  - `runReorganize` 신규 deps: `fetchBody(pageId) → string` (기본: `fetchPageDetail(id).body`, 실패 시 `''`), `comment(pageId, html)` (기본: `addComment`).
  - `formatOpinionComment(decision): string` — export (테스트 가능).
  - 동작: skip 필터 통과 후보만 `fetchBody` 호출 → `ctx.body` 채움 + `ctx.currentFolderId = p.parentId || undefined`. `!dryRun`이고 `decision.source === 'fallback' && decision.llmOpinion`이면 이동 후 코멘트 첨부. `moved[]` 항목에 `llmOpinion` 추가.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/report/reorganize.test.js` 끝에 추가:

```javascript
// ── Task 6: 본문 fetch + fallback 의견 코멘트 ────────────────────────────────
test('reorganize: fetchBody는 분류 후보(고아)에만 호출된다', async () => {
  const fetched = [];
  await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => decision,
      move: async () => {},
      fetchBody: async (id) => { fetched.push(id); return 'BODY'; },
    },
  });
  assert.deepStrictEqual(fetched, ['o1'], '고아 o1만 본문 fetch — 폴더/보고서/폴더안 페이지는 안 됨');
});

test('reorganize: ctx.body에 fetch 결과가 담겨 classify에 전달된다', async () => {
  let receivedCtx = null;
  await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async (ctx) => { receivedCtx = ctx; return decision; },
      move: async () => {},
      fetchBody: async () => '<p>본문HTML</p>',
    },
  });
  assert.strictEqual(receivedCtx.body, '<p>본문HTML</p>');
  assert.strictEqual(receivedCtx.currentFolderId, 'home');
});

test('reorganize: fallback+의견 이동 시 코멘트 첨부 (exec), dry-run에서는 안 함', async () => {
  const comments = [];
  const fallbackDecision = {
    ok: true, source: 'fallback', folderId: 'unsorted', folderTitle: '미분류',
    labels: ['needs-review'], reason: 'low-confidence', llmOpinion: 'DN과 Device 경합', suggestedFolderId: 'f-dn',
  };
  const opts = (dryRun) => ({
    dryRun,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => fallbackDecision,
      move: async () => {},
      fetchBody: async () => 'b',
      comment: async (pid, html) => { comments.push([pid, html]); },
    },
  });
  await runReorganize(opts(false));
  assert.strictEqual(comments.length, 1);
  assert.strictEqual(comments[0][0], 'o1');
  assert.ok(comments[0][1].includes('DN과 Device 경합'), '의견 본문 포함');
  assert.ok(comments[0][1].includes('f-dn'), '잠정 후보 포함');

  comments.length = 0;
  await runReorganize(opts(true));
  assert.strictEqual(comments.length, 0, 'dry-run에서는 코멘트 금지');
});

test('reorganize: fallback이어도 의견이 null이면 코멘트 없음', async () => {
  const comments = [];
  await runReorganize({
    dryRun: false,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => ({ ok: true, source: 'fallback', folderId: 'unsorted', labels: ['needs-review'], reason: 'llm-skipped-no-key', llmOpinion: null }),
      move: async () => {},
      fetchBody: async () => '',
      comment: async (pid, html) => { comments.push([pid, html]); },
    },
  });
  assert.strictEqual(comments.length, 0);
});

test('reorganize: fetchBody throw → 해당 페이지 failed[] 기록, 진행 계속', async () => {
  const result = await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => decision,
      move: async () => {},
      fetchBody: async () => { throw new Error('fetch-boom'); },
    },
  });
  assert.strictEqual(result.failed.length, 1);
  assert.match(result.failed[0].error, /fetch-boom/);
});

// formatOpinionComment 단위 검증
const { formatOpinionComment } = require(path.join(__dirname, '..', '..', 'scripts', 'reorganize_aa_space.js'));
test('formatOpinionComment: 의견·후보를 이스케이프해 포함', () => {
  const html = formatOpinionComment({ llmOpinion: '<b>위험</b> & 경합', suggestedFolderId: 'f-1', reason: 'low-confidence' });
  assert.ok(html.includes('&lt;b&gt;위험&lt;/b&gt; &amp; 경합'), 'HTML 이스케이프');
  assert.ok(html.includes('f-1'));
  assert.ok(html.includes('자동 분류 보류'));
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/report/reorganize.test.js`
Expected: FAIL — `fetchBody` 미지원, `formatOpinionComment` 미export

- [ ] **Step 3: `migration_utils.js`에 `addComment` 추가**

`scripts/utils/migration_utils.js`의 `movePage` 함수 바로 뒤에 삽입:

```javascript
/**
 * 페이지에 코멘트(inline comment) 추가 — v1 child/comment 엔드포인트.
 * 미분류 페이지에 LLM 분류 의견을 첨부해 사람 검토 루프의 입력으로 쓴다.
 */
async function addComment(pageId, htmlBody) {
  return confluenceRequest('POST', `/wiki/rest/api/content/${pageId}/child/comment`, {
    type: 'comment',
    container: { id: String(pageId) },
    body: { representation: 'storage', value: htmlBody },
  });
}
```

그리고 파일 끝 `module.exports` 블록에 `addComment` 추가:

```javascript
module.exports = {
  fetchPageDetail,
  createPage,
  updatePageBody,
  getLabels,
  deleteLabel,
  syncLabels,
  movePage,
  addLabels,
  addComment,
  copyAttachments,
  buildBanner,
  fixBodyReferences,
  escapeHtml
};
```

- [ ] **Step 4: `reorganize_aa_space.js` 수정**

4-a. 상단 require 수정 — `scripts/reorganize_aa_space.js` line 7 교체:

```javascript
const { movePage, fetchPageDetail, addComment, escapeHtml } = require('./utils/migration_utils');
```

4-b. `runReorganize` 함수 본문 시작부(`const move = deps?.move || movePage;` 다음 줄)에 deps 2종 추가:

```javascript
  const fetchBody = deps?.fetchBody || (async (id) => {
    try {
      const d = await fetchPageDetail(id);
      return d.body || '';
    } catch (_) { return ''; }
  });
  const comment = deps?.comment || addComment;
```

4-c. per-page try 블록 내부의 ctx 조립 + 이동 로직 교체 — 기존:

```javascript
      const ancestors = fetchAncestors(p.id, byId);
      const ctx = {
        pageId: p.id, title: p.title, body: '',
        ancestors, sourceSpace: 'AA', sourceUrl: '',
        pageDate: '', existingLabels: p.labels,
      };
      const decision = await classify(ctx, aaTree);
      if (!decision.ok || decision.folderId === p.parentId) { skippedCount++; continue; }

      if (!dryRun) await move(p.id, decision.folderId);
      moved.push({
        page: p,
        from: p.parentId,
        to: decision.folderId,
        source: decision.source,
        reason: decision.reason,
        folderTitle: decision.folderTitle,
        dryRun,
      });
```

교체:

```javascript
      const ancestors = fetchAncestors(p.id, byId);
      // 본문은 재분류 후보(여기까지 도달한 페이지)만 fetch — rate limit 절약.
      const body = await fetchBody(p.id);
      const ctx = {
        pageId: p.id, title: p.title, body,
        ancestors, sourceSpace: 'AA', sourceUrl: '',
        pageDate: '', existingLabels: p.labels,
        currentFolderId: p.parentId || undefined,
      };
      const decision = await classify(ctx, aaTree);
      if (!decision.ok || decision.folderId === p.parentId) { skippedCount++; continue; }

      if (!dryRun) {
        await move(p.id, decision.folderId);
        // 미분류행 + LLM 의견이 있으면 검토용 코멘트 첨부 (실패해도 이동은 유지)
        if (decision.source === 'fallback' && decision.llmOpinion) {
          await comment(p.id, formatOpinionComment(decision)).catch(() => {});
        }
      }
      moved.push({
        page: p,
        from: p.parentId,
        to: decision.folderId,
        source: decision.source,
        reason: decision.reason,
        folderTitle: decision.folderTitle,
        llmOpinion: decision.llmOpinion || null,
        dryRun,
      });
```

4-d. `isAtTopLevel` 함수 뒤에 `formatOpinionComment` 추가, export에 포함:

```javascript
/**
 * 미분류 이동 시 페이지에 첨부할 LLM 의견 코멘트 HTML.
 * 사람이 Confluence에서 페이지를 검토할 때 봇의 판단 근거를 본다.
 */
function formatOpinionComment(decision) {
  const date = new Date().toISOString().slice(0, 10);
  const suggestion = decision.suggestedFolderId
    ? `<p>잠정 후보 폴더 ID: <code>${escapeHtml(String(decision.suggestedFolderId))}</code></p>`
    : '';
  return [
    '<ac:structured-macro ac:name="note" ac:schema-version="1"><ac:rich-text-body>',
    `<p><strong>🤖 자동 분류 보류</strong> (${escapeHtml(date)}, 사유: ${escapeHtml(decision.reason || 'fallback')})</p>`,
    `<p>LLM 의견: ${escapeHtml(decision.llmOpinion || '')}</p>`,
    suggestion,
    '<p><em>검토 후 알맞은 폴더로 이동해 주세요. 이동 결정은 분류 지침(reference/classification_guidelines.md) 개선에 반영됩니다.</em></p>',
    '</ac:rich-text-body></ac:structured-macro>',
  ].join('');
}
```

파일 끝 export 교체:

```javascript
module.exports = { runReorganize, fetchAncestors, isAtTopLevel, formatOpinionComment };
```

- [ ] **Step 5: reorganize 테스트 통과 확인**

Run: `node --test tests/report/reorganize.test.js`
Expected: PASS (기존 4 + 신규 6 = 10 tests)

- [ ] **Step 6: 전체 스위트 실행**

Run: `npm test`
Expected: 전체 PASS.

- [ ] **Step 7: dry-run 스모크 (Confluence 자격증명 있는 환경에서만, 없으면 skip)**

Run: `npm run reorganize:aa:dryrun`
Expected: 크래시 없음. stdout에 `[DRY] would move: N pages`. LLM 단계는 `ANTHROPIC_API_KEY` 로컬 보유 시에만 실호출되며 dry-run이므로 코멘트/이동은 발생하지 않는다. 키·자격증명 없는 환경에서는 `llm-skipped-no-key` fallback 경로로 동일하게 완주해야 한다.

- [ ] **Step 8: 커밋**

```bash
git add scripts/utils/migration_utils.js scripts/reorganize_aa_space.js tests/report/reorganize.test.js
git commit -m "feat(classify): reorganize fetches body for candidates, comments LLM opinion on fallback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 문서 동기화 + 최종 검증

**Files:**
- Modify: `reference/classification_rules.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `CLAUDE.md`
- Modify: `reference/ToDo.md` (진행 상황 갱신 — 해당 파일 포맷 준수)

- [ ] **Step 1: `reference/classification_rules.md` §2 체인 정책 교체**

§2의 체인 블록과 불릿 목록을 아래로 교체 (본문 중 "체인 정책" 섹션 전체):

```markdown
## 2. 체인 정책

`scripts/utils/classification_provider.js`의 분류 체인은 단일 순서를 따릅니다.

```
human → structural → inline-llm(본문 기반) → fallback(미분류 + LLM 의견)
```

- **rule 단계 제거 (2026-07-31 재설계)**: 제목 정규식 분류는 "작성자가 제목을 어떻게 달지 예측 불가 → 룰 무한 추가" 문제가 있어 폐기. 판단 기준은 자연어 지침 파일 `reference/classification_guidelines.md`가 대신하며 LLM이 페이지 본문(앞 2000자)을 읽고 1차 판단한다. `scripts/classifiers/rule.js`는 모듈로 남아 `audit_aa_space.js`의 휴먼 결정 휴리스틱과 리포트 unmatched 추적에만 사용된다.
- **structural 단계**: 이미 유효 폴더에 있는 페이지는 LLM 호출 없이 현 위치 유지 (비용 절감).
- **confidence**: LLM이 `select_folder` 응답에 `confidence: high|low`를 포함. `low`는 폴더에 넣지 않고 미분류로 보내며, LLM 의견(reason)을 페이지 코멘트로 첨부해 사람 검토의 입력으로 쓴다.
- **fallback**: `unsortedFolderId`(미분류 폴더) + `needs-review` 라벨 + `llmOpinion`/`suggestedFolderId` 보존.
- **human 단계**: `classification_decisions.json`의 과거 휴먼 결정 우선 — 체인 최상단 유지.
- **ANTHROPIC_API_KEY 미설정 시**: human + structural만 수행, 미매치 시 fallback(`reason: 'llm-skipped-no-key'`). 비용·보안 가드.
```

- [ ] **Step 2: `reference/classification_rules.md` §4 결과 스키마 갱신**

§4 "결과 스키마 (정규화)"의 js 코드 블록(`{` … `}`)과 그 아래 "실패 시" 문단을 아래로 교체 (source 열거형에 `human`·`structural` 추가, `rule` 제거 + 신규 필드 3종):

```markdown
```js
{
  ok: true,
  source: 'human' | 'structural' | 'inline-llm' | 'fallback',
  folderId: string,           // AA 폴더 ID
  folderTitle: string?,        // 선택
  labels: string[],            // 부착할 라벨
  reason: string,              // 로그/감사용
  confidence?: 'high',         // inline-llm 성공 시에만
  llmOpinion?: string|null,    // fallback 전용 — LLM 판단 근거 (코멘트 첨부용)
  suggestedFolderId?: string|null, // fallback 전용 — LLM 잠정 후보 폴더
}
```

실패 시 `{ ok: false, source: 'miss', reason: '...' }` — 예외를 throw하지 않고 흡수해 per-page try/catch와 호환됩니다.
```

- [ ] **Step 3: `reference/classification_rules.md` §3 역할 변경 노트 추가**

§3 "`config/analysis_rules.json` (SSOT)" 제목 아래 첫 줄에 아래 노트 삽입:

```markdown
> **역할 변경 (2026-07-31)**: 이 JSON은 더 이상 분류 체인의 1차 구동 룰이 아닙니다.
> (1) `audit_aa_space.js`의 휴먼 결정 커밋 휴리스틱, (2) 일일 리포트 unmatched 추적,
> (3) `reference/classification_guidelines.md`와의 동기화 가드 테스트가 참조합니다.
> 분류 판단 기준의 SSOT는 `reference/classification_guidelines.md`입니다.
```

- [ ] **Step 4: `reference/classification_rules.md` 변경 절차 테이블 행 갱신**

`## 6. 변경 절차 요약` 테이블에서 "룰 패턴 추가/수정" 행과 "체인 단계 추가/제거" 행을 아래로 교체 (주의: 이 문서에는 `## 6.` 제목이 두 개 있음 — 대상은 뒤쪽 "변경 절차 요약" 섹션의 테이블):

```markdown
| 분류 기준 추가/수정 | `reference/classification_guidelines.md` PR + 본 문서 갱신. 카테고리 폴더 신설·통폐합 시 `config/analysis_rules.json` 카테고리명도 동기화(가드 테스트 존재) |
| 체인 단계 추가/제거 | `classification_provider.js` PR + `engine.js` 시그니처 갱신 + 테스트 갱신 + 본 문서 §2 갱신 |
```

- [ ] **Step 5: `docs/USER_GUIDE.md` 체인 설명 갱신 (헤더 테이블 + §1.6)**

5-a. 문서 상단 메타데이터 테이블의 "분류 체인" 행 교체 — 기존:

```
| 분류 체인 | `human → rule → inline-llm → fallback` (4단계, 휴먼 결정 재삽입) |
```

교체:

```
| 분류 체인 | `human → structural → inline-llm(본문) → fallback` (4단계, 2026-07-31 재설계 — rule 단계 폐기, 판단 기준: `reference/classification_guidelines.md`) |
```

5-b. §1.6 본문 첫 줄의 체인 서술 교체 — 기존:

```
페이지 하나를 분류할 때 체인은 **`human → rule → inline-llm → fallback`** 순서로 시도한다 (`scripts/utils/classification_provider.js`).
```

교체:

```
페이지 하나를 분류할 때 체인은 **`human → structural → inline-llm → fallback`** 순서로 시도한다 (`scripts/utils/classification_provider.js`).
```

5-c. §1.6의 ①–④ 다이어그램 코드 블록(② rule 단계 포함 블록) 전체를 아래로 교체:

```
```
페이지
  │
  ├─① human: config/classification_decisions.json (과거 휴먼 UI 이동 기록)
  │    ├─ 매칭 → 즉시 확정 (titleRegex로 매칭, targetFolderId로 이동)
  │    └─ 매칭 실패 → 다음 단계
  │    ↓
  ├─② structural: 이미 유효 폴더 안에 있으면 현 위치 유지 (LLM 호출 생략)
  │    ↓ 실패
  ├─③ inline-llm: Anthropic SDK, 페이지 본문 앞 2000자 + 분류 지침을 읽어
  │    tool_use(select_folder) + confidence(high/low) 판정으로 폴더 선택
  │    ├─ confidence: high → 확정 {ok, folderId, labels, reason, confidence}
  │    └─ confidence: low / 미응답 → miss (크래시 전파 안 함)
  │    (ANTHROPIC_API_KEY 없으면 이 단계 자체를 skip)
  │    ↓ 실패
  └─④ fallback: "미분류" 폴더로 이동 + `needs-review` 라벨 + LLM 의견 코멘트 첨부
       (미분류 폴더 = 제목이 '미분류'·'분류 보류'·'Unsorted' 중 하나인 is-folder)
```

- LLM 판단 기준 SSOT: `reference/classification_guidelines.md` (system prompt에 주입).
- `confidence: low` 또는 LLM 미응답 → 미분류로 이동하고 판단 근거를 페이지 코멘트로 남깁니다. 검토 후 옮기면 그 결정이 지침 개선의 근거가 됩니다.
- `ANTHROPIC_API_KEY` 미설정 환경에서는 LLM 단계가 생략되고 human + structural + fallback만 동작합니다.
```

5-d. **건드리지 말 것** (이 플랜 범위 밖): §1.6의 "**여기서 끝나지 않는다**" 추적망 문단(미매칭 추적·AI 권고판), 어휘 가중치 신뢰도 표(§4 advisory 메커니즘 — 체인과 별개 작업), §1.7 운용자 시나리오. 교체 대상은 5-a~5-c뿐이다.

- [ ] **Step 6: `CLAUDE.md` §2 아키텍처 설명 갱신**

6-a. §2 아키텍처 다이어그램 블록의 분류 체인 행 교체 — 기존:

```
(Pages) → rule → inline-llm(Anthropic SDK) → fallback(unsortedFolderId, needs-review)
```

교체:

```
(Pages) → human → structural → inline-llm(본문, Anthropic SDK) → fallback(미분류 + LLM 의견 코멘트)
```

6-b. §2 "**분류 체인**" 불릿 교체 — 기존:

```
- **분류 체인**: [`scripts/utils/classification_provider.js`](scripts/utils/classification_provider.js) 단일 흐름. `rule → inline-llm → fallback`. 호출자(`migrator.js`, `audit_aa_space.js`, `reorganize_aa_space.js`)는 `classifyWithChain(ctx, aaTree)`로만 접근 → 호환성 보존.
```

교체:

```
- **분류 체인**: [`scripts/utils/classification_provider.js`](scripts/utils/classification_provider.js) 단일 흐름. `human → structural → inline-llm(본문) → fallback(미분류+의견)` (2026-07-31 재설계 — rule 단계 폐기, 판단 기준 SSOT: `reference/classification_guidelines.md`). 호출자(`migrator.js`, `audit_aa_space.js`, `reorganize_aa_space.js`)는 `classifyWithChain(ctx, aaTree)`로만 접근 → 호환성 보존.
```

6-c. §2 "**사용하지 않음**" 행에서 "`scripts/classifiers/human.js` (호출 경로 없음)" 구절 삭제 — human.js는 체인 0단계에서 호출 중이다. 교체 후 예:

```
- **사용하지 않음**: Dify 워크플로우, human queue, Auto-PR(`peter-evans/create-pull-request` 제거됨), `scripts/classifiers/claude.js` (호출 경로 없음).
```

- [ ] **Step 7: `reference/ToDo.md` 갱신**

`reference/ToDo.md`를 열어 §0 "한 줄 요약"과 §4 "진행 중 / 다음 작업"을 기존 포맷에 맞게 갱신: 핵심 재설계(본문 기반 LLM 분류 체인) 구현 완료 표시, 남은 작업으로 "§4 advisory LLM화", "지침 학습 루프", "워크플로우 순서 변경" 명시.

- [ ] **Step 8: 최종 전체 테스트 + LLM 환경 점검**

Run: `npm test`
Expected: 전체 PASS (목표 ≈ 220+ tests, 0 fail).

Run (로컬에 `ANTHROPIC_API_KEY` 있는 경우만): `npm run check:llm`
Expected: classifier-actual 모델 응답 정상. 없으면 skip — CI는 Secrets로 동작.

- [ ] **Step 9: 커밋**

```bash
git add reference/classification_rules.md docs/USER_GUIDE.md CLAUDE.md reference/ToDo.md
git commit -m "docs: sync classification chain redesign across guides

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 10: 후속 조치 기록 (이 플랜 범위 외)**

사용자에게 보고: 핵심 재설계 완료. 다음 플랜 후보 — (1) §4 advisory 키워드-가중치 → LLM 분석 대체, (2) 사람 검토 이동 → 지침 업데이트 학습 루프, (3) 워크플로우 순서 변경(`migrate → daily-report`).
