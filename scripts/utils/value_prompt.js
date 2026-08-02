'use strict';
// LLM 가치 평가(v2) 프롬프트 조립. 도구 스키마 + system/user 빌더.
// 분류(작업 11)와 동일 패턴 — 책임 분리.

const SELECT_MIGRATION_VALUE_TOOL = {
  name: 'select_migration_value',
  description: '조직·과제 입장에서 이관 가치를 평가한다. 3종 verdict 중 하나만 응답한다.',
  input_schema: {
    type: 'object',
    required: ['verdict', 'reason'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['create', 'unclassified', 'dropped'],
        description: 'create: 이관 가치 있음. unclassified: 가치는 있으나 분류 애매. dropped: 가치 없음(끄적임/임시 스크랩).',
      },
      reason: {
        type: 'string',
        description: '판단 근거 1~2문장.',
      },
      suggestedFolderId: {
        type: 'string',
        description: 'verdict=unclassified일 때 추천 폴더 ID. 그 외는 생략 가능.',
      },
    },
  },
};

function buildValueSystemPrompt({ treeText, guidelines } = {}) {
  return [
    '당사는 사내 Confluence AA 스페이스(덴탈AI연구소 Archive)로 외부 스페이스 문서를 자동 이관하는 시스템이다.',
    '분류 체인(classifyWithChain)이 폴더 위치를 선정한 뒤, 당신은 두 번째 단계로 **이관 가치**를 평가한다.',
    '조직·과제 입장에서 AA에 보관할 가치가 있는지가 핵심 — 본문 의미 해석이 아니라 업무적 가치 판단이다.',
    '',
    '반드시 select_migration_value 도구를 정확히 한 번 호출해서 응답한다. 텍스트로만 답하지 않는다.',
    '',
    '## verdict 기준',
    '- create: 조직·과제 입장에서 업무 가치가 있어 AA에 보관할 만함.',
    '- unclassified: 가치는 있지만 현재 폴더 구조 어디에도 명확히 부합하지 않음. suggestedFolderId로 추천 폴더를 명시.',
    '- dropped: 개인 메모, 임시 캡처, 학습 노트, 외부 스페이스의 임시 스냅샷 등. AA 보관 가치 없음.',
    '',
    '## reason 작성 규칙 (중요)',
    '- reason은 **한국어 자연어 한 문장** (예: "팀 MPS 월간 보고 양식으로 업무 가치가 분명함", "학습 노트성 메모로 보관 가치 낮음").',
    '- **시스템 내부 코드명 금지**: "no-llm-deps", "inline-llm-value", "miss" 등 시스템 상태 코드를 reason에 쓰지 않는다.',
    '- **짧은 단답/노이즈 금지**: "ok", "ㅇㅇ", "yes" 같은 한 단어 답변 부적합. 본문/제목의 구체적 이유를 10~80자 한국어로 작성.',
    '',
    '## 참고 — 1차 분류 결과',
    '<classify_hint>',
    '(system 프롬프트에는 placeholder; buildValueUserMessage에서 채워짐)',
    '</classify_hint>',
    '',
    '## 현재 AA 폴더 트리 (참고)',
    '<folder_tree>',
    treeText || '(트리 없음)',
    '</folder_tree>',
    '',
    '## 분류 지침 (참고)',
    '<guidelines>',
    guidelines || '(지침 없음)',
    '</guidelines>',
    '',
    '## 주의',
    '- 본문 앞머리의 "자동 이관 문서" 배너는 메타데이터다. 분류/가치 판단 근거로 쓰지 않는다.',
    '- 빈 본문·짧은 본문이라도 verdict를 보류하지 말고 본문/제목으로 판단한다.',
  ].join('\n');
}

function buildValueUserMessage({ title, bodyText, classifyHint } = {}) {
  const hint = classifyHint
    ? `후보 폴더: ${classifyHint.folderId || '(없음)'}\n라벨: ${(classifyHint.labels || []).join(', ') || '(없음)'}`
    : '(분류 없음)';
  return [
    '# 대상 문서',
    `- 제목: ${title || '(없음)'}`,
    '',
    '# 1차 분류 결과 (참고)',
    hint,
    '',
    '# 본문 발췌 (앞부분)',
    bodyText || '(비어 있음)',
  ].join('\n');
}

module.exports = {
  SELECT_MIGRATION_VALUE_TOOL,
  buildValueSystemPrompt,
  buildValueUserMessage,
};
