'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  SELECT_MIGRATION_VALUE_TOOL,
  buildValueSystemPrompt,
  buildValueUserMessage,
} = require('../../scripts/utils/value_prompt');

test('SELECT_MIGRATION_VALUE_TOOL: name=select_migration_value', () => {
  assert.strictEqual(SELECT_MIGRATION_VALUE_TOOL.name, 'select_migration_value');
});

test('SELECT_MIGRATION_VALUE_TOOL: verdict enum = [create, unclassified, dropped]', () => {
  const props = SELECT_MIGRATION_VALUE_TOOL.input_schema.properties;
  assert.deepStrictEqual(props.verdict.enum, ['create', 'unclassified', 'dropped']);
});

test('SELECT_MIGRATION_VALUE_TOOL: verdict + reason 필수, suggestedFolderId 옵션', () => {
  const schema = SELECT_MIGRATION_VALUE_TOOL.input_schema;
  assert.ok(schema.required.includes('verdict'));
  assert.ok(schema.required.includes('reason'));
  assert.ok(!schema.required.includes('suggestedFolderId'));
});

test('buildValueSystemPrompt: treeText + guidelines 포함', () => {
  const out = buildValueSystemPrompt({ treeText: 'TREE', guidelines: 'GL' });
  assert.ok(out.includes('TREE'));
  assert.ok(out.includes('GL'));
  assert.ok(out.includes('select_migration_value'));
});

test('buildValueSystemPrompt: treeText/guidelines 비어도 안전', () => {
  const out = buildValueSystemPrompt({});
  assert.ok(typeof out === 'string');
  assert.ok(out.length > 0);
});

test('buildValueUserMessage: title + bodyText + classifyHint 포함', () => {
  const out = buildValueUserMessage({
    title: 'A',
    bodyText: 'B',
    classifyHint: { folderId: '100', labels: ['doctype-report'] },
  });
  assert.ok(out.includes('A'));
  assert.ok(out.includes('B'));
  assert.ok(out.includes('100'));
  assert.ok(out.includes('doctype-report'));
});

test('buildValueUserMessage: classifyHint 없으면 "(분류 없음)" placeholder', () => {
  const out = buildValueUserMessage({ title: 'A', bodyText: 'B' });
  assert.ok(out.includes('(분류 없음)'));
});
