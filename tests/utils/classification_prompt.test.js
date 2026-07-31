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
