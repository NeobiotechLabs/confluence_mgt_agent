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
