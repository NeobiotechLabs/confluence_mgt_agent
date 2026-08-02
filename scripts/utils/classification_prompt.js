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
    '## reason 작성 규칙 (중요)',
    '- reason은 **사람이 읽을 수 있는 한국어 자연어 한 문장** (예: "MPS 월간 보고 양식으로 팀 단위 계획 문서").',
    '- **시스템 내부 코드명 금지**: "no-llm-deps", "inline-llm", "llm-miss", "miss", "no-classifier-matched" 등 시스템 상태 코드를 reason에 쓰지 않는다.',
    '- **짧은 단답/노이즈 금지**: "ok", "ㅇㅇ", "yes", "1" 같은 한 단어 답변은 부적합. 본문/제목의 구체적 근거를 10~80자 한국어로 작성.',
    '- confidence: high로 응답하면서 reason을 비우거나 5자 미만으로 쓰지 않는다.',
    '',
    '## confidence 규칙',
    '- high: 본문(본문이 비어 있으면 제목)만으로 한 폴더에 명확히 부합할 때만. **반드시 reason을 10~80자 한국어로 작성**.',
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
