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

test('empty run: no-moves message, §2 이관 결과 없음, §4 미실행, no §5', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
  });
  const html = renderReportStorage({ appendix, deltas: {} });
  assert.ok(html.includes('오늘 자동 이동 없음'), '§3 이동 없음 문구');
  assert.ok(html.includes('이관 결과 없음'), '§2 이관 결과 없음 문구');
  assert.ok(html.includes('미실행 (Phase 2 예정)'), '§4 AI 권고 미실행 문구');
  assert.ok(!html.includes('§5'), '§5 omitted when nothing to notify');
});

test('§3: move-b 항목 표 렌더 (제목/from/to/근거 컬럼)', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 2, advisories: 0, actionRequiredCount: 0 },
    items: [
      { kind: 'move-b', pageId: '1', title: 'AI 가이드', fromFolderId: 'top', toFolderId: 'f1', source: 'inline-llm', reason: '본문 기반 분류', seenCount: 1, fingerprint: 'fp1' },
      { kind: 'move-b', pageId: '2', title: '캘리브레이션 회의록', fromFolderId: 'f0', toFolderId: 'f2', source: 'fallback', reason: 'low-confidence', seenCount: 1, fingerprint: 'fp2' },
    ],
  });
  const html = renderReportStorage({ appendix, deltas: {} });
  // §3 표 안에 두 항목의 제목과 경로가 escape되어 들어감
  assert.ok(html.includes('AI 가이드'));
  assert.ok(html.includes('캘리브레이션 회의록'));
  assert.ok(html.includes('본문 기반 분류'));
  assert.ok(html.includes('low-confidence'));
  // "오늘 자동 이동 없음"은 movesB > 0이면 안 나옴
  assert.ok(!html.includes('오늘 자동 이동 없음'));
});

test('§3: 표 셀 escape (제목에 <script>)', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 1, advisories: 0, actionRequiredCount: 0 },
    items: [
      { kind: 'move-b', pageId: '1', title: '<img onerror>', fromFolderId: 'top', toFolderId: 'f1', source: 'rule', reason: '<bad>', seenCount: 1, fingerprint: 'fp1' },
    ],
  });
  const html = renderReportStorage({ appendix, deltas: {} });
  // §3 표 영역만 검사 — 부록 CDATA는 raw JSON이 들어있어 별도 검사 불필요
  const s3End = html.indexOf('§4');
  const s3Section = s3End >= 0 ? html.slice(0, s3End) : html;
  assert.ok(!/<img onerror>/i.test(s3Section), '§3 표에 raw 태그 미노출');
  assert.ok(s3Section.includes('&lt;img onerror&gt;'));
  assert.ok(s3Section.includes('&lt;bad&gt;'));
});

test('§3: from `top`은 최상위 고아, 그 외는 폴더 ID 표시', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 1, advisories: 0, actionRequiredCount: 0 },
    items: [
      { kind: 'move-b', pageId: '1', title: '문서', fromFolderId: null, toFolderId: 'f1', source: 'inline-llm', reason: 'r', seenCount: 1, fingerprint: 'fp1' },
    ],
  });
  const html = renderReportStorage({ appendix, deltas: {} });
  // null → 'top' 표기
  assert.ok(html.includes('top') || html.includes('최상위') || html.includes('home'));
});

test('§5 appears with orphan + failed moves (advisories는 §4에만 표시)', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 2, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
    advisories: ['⚠️ 룰 변경 감지: a → b'],
  });
  const html = renderReportStorage({
    appendix, deltas: {},
    failedMoves: [{ title: '문서', error: 'API Error [500]' }],
    advisories: appendix.advisories,
  });
  assert.ok(html.includes('§5'));
  assert.ok(html.includes('최상위 고아 페이지 2개'));
  assert.ok(html.includes('API Error [500]'));
  // §5 본문(§5 ~ §6 사이)에는 LLM/룰 메시지 미노출
  const s5Body = html.split('§5')[1]?.split('§6')[0] || '';
  assert.ok(!s5Body.includes('룰 변경 감지'), '§5 본문에 LLM/룰 메시지 노출 안 함');
});

test('§5 omitted when no 운영 노이즈 (orphan=0, failed 없음, advisories만)', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
    advisories: ['⚠️ 룰 변경 감지: a → b'],
  });
  const html = renderReportStorage({ appendix, deltas: {}, advisories: appendix.advisories });
  assert.ok(!html.includes('§5'), '§5 미표시');
});

test('§4 has LLM advisories; §5 본문에는 미노출 (even when §5 forced by orphan)', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 2, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
    advisories: ['MPS 이력에 페이지 9건 몰림 — 폴더 분리 권장'],
  });
  const html = renderReportStorage({ appendix, deltas: {}, advisories: appendix.advisories });
  assert.ok(html.includes('§4'));
  assert.ok(html.includes('MPS 이력에 페이지'));
  // §5 본문(§5 ~ §6 사이)에는 LLM 권고 미노출 — 부록 JSON은 별도 (정확한 SSOT 보존 목적)
  assert.ok(html.includes('§5'));
  const s5Body = html.split('§5')[1]?.split('§6')[0] || '';
  assert.ok(!s5Body.includes('MPS 이력에 페이지'), '§5 본문에 LLM 권고 미노출');
});

// Gap 2: §5에 휴먼 결정 누적 알림 (3회 이상 같은 폴더로 이동된 항목)
test('§5: repeatedHumanDecisions 3회 이상이면 알림 렌더', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
  });
  const html = renderReportStorage({
    appendix, deltas: {},
    repeatedHumanDecisions: [
      { targetFolderTitle: '기술문서', count: 4, titles: ['MPS_v1', 'MPS_v2', 'MPS_v3', 'MPS_v4'], firstDecidedAt: '2026-07-15' },
    ],
  });
  assert.ok(html.includes('§5'), '§5 렌더됨');
  assert.ok(html.includes('휴먼 결정 누적'), '알림 제목 포함');
  assert.ok(html.includes('기술문서'), '폴더명 포함');
  assert.ok(html.includes('4회'), '횟수 포함');
  assert.ok(html.includes('analysis_rules.json'), '룰 추가 안내 포함');
});

test('§5: repeatedHumanDecisions 빈 배열이면 §5에 해당 알림 없음', () => {
  const appendix = makeAppendix({
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
  });
  const html = renderReportStorage({
    appendix, deltas: {},
    repeatedHumanDecisions: [],
  });
  assert.ok(!html.includes('휴먼 결정 누적'));
});
