// tests/report/render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderReportStorage, formatDelta } = require('../../scripts/report/render');
const { parseAppendix, diffMetrics, APPENDIX_MARKER } = require('../../scripts/report/report_lib');

function makeAppendix(over = {}) {
  return {
    v: 1,
    runAt: '2026-07-29 09:00',
    runId: '0#0',
    mode: 'local',
    policyHash: 'abcd1234',
    model: 'off(rule-only)',
    gitSha: 'deadbee',
    metrics: {
      aaPageCount: 10, topLevelOrphans: 2, unclassifiedCount: 3,
      movesB: 1, advisories: 0, actionRequiredCount: 1,
    },
    items: [],
    advisories: [],
    ...over,
  };
}

test('dynamic values are HTML-escaped (§3 table)', () => {
  const appendix = makeAppendix({
    items: [{
      kind: 'move-b', pageId: '1', title: '<script>alert(1)</script>',
      fromFolderId: 'a', toFolderId: 'b', source: 'rule', reason: 't<"regex">',
      seenCount: 1, fingerprint: 'fp',
    }],
  });
  const html = renderReportStorage({ appendix, deltas: diffMetrics(appendix.metrics, null) });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'title escaped');
  assert.ok(html.includes('t&lt;&quot;regex&quot;&gt;'), 'reason escaped');
});

test('marker + code macro CDATA present', () => {
  const appendix = makeAppendix();
  const html = renderReportStorage({ appendix, deltas: {} });
  assert.ok(html.includes(APPENDIX_MARKER));
  assert.ok(html.includes('<![CDATA['));
  assert.ok(html.includes(']]>'));
});

test('render → parseAppendix roundtrip', () => {
  const appendix = makeAppendix({
    items: [{ kind: 'move-b', pageId: '77', title: '문서 "가"', fromFolderId: 'f1', toFolderId: 'f2', source: 'human', reason: 'r', seenCount: 3, firstSeen: '2026-07-20', fingerprint: 'abc123' }],
    advisories: ['직전 리포트 부록 파싱 실패'],
  });
  const html = renderReportStorage({ appendix, deltas: diffMetrics(appendix.metrics, null) });
  const parsed = parseAppendix(html);
  assert.deepStrictEqual(parsed, appendix);
});

test('delta "—" when no previous report', () => {
  const appendix = makeAppendix();
  const html = renderReportStorage({ appendix, deltas: diffMetrics(appendix.metrics, null) });
  assert.ok(html.includes('<td>—</td>'));
  assert.strictEqual(formatDelta(null), '—');
  assert.strictEqual(formatDelta(3), '+3');
  assert.strictEqual(formatDelta(-2), '-2');
  assert.strictEqual(formatDelta(0), '0');
});

test('empty run: no-moves message, Phase 2 placeholders, no §5 without notices', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
  });
  const html = renderReportStorage({ appendix, deltas: {} });
  assert.ok(html.includes('오늘 자동 이동 없음'));
  assert.ok(html.includes('미실행 (Phase 2 예정)'));
  assert.ok(!html.includes('§5'), '§5 omitted when nothing to notify');
});

test('§5 appears with orphan notice / advisories / failed moves', () => {
  const appendix = makeAppendix({ advisories: ['감사 실행 실패: x'] });
  appendix.metrics.advisories = 1;
  const html = renderReportStorage({
    appendix, deltas: {},
    failedMoves: [{ title: '문서', error: 'API Error [500]' }],
    advisories: appendix.advisories,
  });
  assert.ok(html.includes('§5'));
  assert.ok(html.includes('최상위 고아 페이지 2개'));
  assert.ok(html.includes('감사 실행 실패: x'));
  assert.ok(html.includes('API Error [500]'));
});
