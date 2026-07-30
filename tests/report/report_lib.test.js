// tests/report/report_lib.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  kstNow, kstStamp, kstYYMMDD, kstHHMM,
  generateTitle, parseReportTitle,
  fingerprint, policyHash,
  parseAppendix, computeDiff, diffMetrics,
  selectPruneCandidates, buildRunId, runMode, APPENDIX_MARKER,
  detectRuleChange,
} = require('../../scripts/report/report_lib');

// ── KST (UTC+9) ─────────────────────────────────────────────────────────────
test('KST boundary: UTC 15:00 → KST next day 00:00', () => {
  const utc = new Date('2026-07-29T15:00:00Z');
  const kst = kstNow(utc);
  assert.strictEqual(kstStamp(kst), '2026-07-30 00:00');
  assert.strictEqual(kstYYMMDD(kst), '260730');
  assert.strictEqual(kstHHMM(kst), '0000');
});

test('KST format: typical morning run', () => {
  const kst = kstNow(new Date('2026-07-29T00:00:00Z')); // = KST 09:00
  assert.strictEqual(kstStamp(kst), '2026-07-29 09:00');
  assert.strictEqual(kstYYMMDD(kst), '260729');
  assert.strictEqual(kstHHMM(kst), '0900');
});

// ── 제목 생성/파싱 ──────────────────────────────────────────────────────────
test('generateTitle with/without suffix', () => {
  assert.strictEqual(generateTitle('260729', '0900'), 'auto_report_260729_0900');
  assert.strictEqual(generateTitle('260729', '0900', 2), 'auto_report_260729_0900_2');
});

test('parseReportTitle: valid / suffixed / invalid date / garbage', () => {
  const a = parseReportTitle('auto_report_260729_0900');
  assert.strictEqual(a.suffix, null);
  assert.ok(a.date instanceof Date);
  assert.strictEqual(a.date.toISOString().slice(0, 10), '2026-07-29');

  assert.strictEqual(parseReportTitle('auto_report_260729_0900_3').suffix, 3);

  // 2월 31일 → 날짜 부정확 → date=null (prune 오폭 방지)
  assert.strictEqual(parseReportTitle('auto_report_260231_0900').date, null);

  assert.strictEqual(parseReportTitle('회의록 2026'), null);
  assert.strictEqual(parseReportTitle(''), null);
});

// ── 해시 ────────────────────────────────────────────────────────────────────
test('fingerprint: 12 hex chars, deterministic, folder-sensitive', () => {
  const fp1 = fingerprint('move-b', '12345', '999');
  assert.match(fp1, /^[0-9a-f]{12}$/);
  assert.strictEqual(fingerprint('move-b', '12345', '999'), fp1);
  assert.notStrictEqual(fingerprint('move-b', '12345', '888'), fp1);
  assert.notStrictEqual(fingerprint('move-a', '12345', '999'), fp1);
  // folderId null도 안정적
  assert.match(fingerprint('move-b', '12345', null), /^[0-9a-f]{12}$/);
});

test('policyHash: 8 hex chars, deterministic, tolerant to missing dir', () => {
  const h = policyHash();
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.strictEqual(policyHash(), h);
  // 존재하지 않는 디렉터리에서도 결정적 8자
  const hMissing = policyHash('/no/such/dir/__x__');
  assert.match(hMissing, /^[0-9a-f]{8}$/);
  assert.strictEqual(policyHash('/no/such/dir/__x__'), hMissing);
});

// ── 부록 파싱 ───────────────────────────────────────────────────────────────
const sampleAppendix = {
  v: 1, runAt: '2026-07-29 09:00', runId: '123#1', mode: 'ci',
  policyHash: 'abcd1234', model: 'claude', gitSha: 'deadbee',
  metrics: { aaPageCount: 10, movesB: 2 },
  items: [{ fingerprint: 'fp1', seenCount: 1 }], advisories: [],
};

function wrapHtml(appendix, { marker = true } = {}) {
  const json = JSON.stringify(appendix, null, 2);
  return `${marker ? APPENDIX_MARKER + '\n' : ''}<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${json}]]></ac:plain-text-body></ac:structured-macro>`;
}

test('parseAppendix: roundtrip with marker', () => {
  assert.deepStrictEqual(parseAppendix(wrapHtml(sampleAppendix)), sampleAppendix);
});

test('parseAppendix: fallback by schema shape when marker stripped', () => {
  assert.deepStrictEqual(parseAppendix(wrapHtml(sampleAppendix, { marker: false })), sampleAppendix);
});

test('parseAppendix: null on missing marker+schema / broken JSON / non-string', () => {
  assert.strictEqual(parseAppendix('<p>사람이 편집한 리포트</p>'), null);
  assert.strictEqual(parseAppendix(`${APPENDIX_MARKER}<![CDATA[{broken]]>`), null);
  assert.strictEqual(parseAppendix(null), null);
  assert.strictEqual(parseAppendix(undefined), null);
  // v:1 스키마가 아닌 JSON은 무시
  assert.strictEqual(parseAppendix('<![CDATA[{"hello":1}]]>'), null);
});

// ── diff ────────────────────────────────────────────────────────────────────
test('computeDiff: seenCount increment + firstSeen inheritance for repeat', () => {
  const prev = [{ fingerprint: 'fp1', seenCount: 3, firstSeen: '2026-07-20' }];
  const cur = [{ fingerprint: 'fp1', title: 'A' }, { fingerprint: 'fp2', title: 'B' }];
  const out = computeDiff(cur, prev, '2026-07-29');
  assert.strictEqual(out[0].seenCount, 4);
  assert.strictEqual(out[0].firstSeen, '2026-07-20');
  assert.strictEqual(out[1].seenCount, 1);
  assert.strictEqual(out[1].firstSeen, '2026-07-29');
  // 입력 비변형
  assert.strictEqual(cur[0].seenCount, undefined);
});

test('computeDiff: prev null → all seenCount 1', () => {
  const out = computeDiff([{ fingerprint: 'x' }], null, '2026-07-29');
  assert.strictEqual(out[0].seenCount, 1);
});

test('diffMetrics: deltas / all-null when no prev', () => {
  const cur = { aaPageCount: 10, movesB: 2 };
  assert.deepStrictEqual(diffMetrics(cur, { aaPageCount: 12, movesB: 2 }),
    { aaPageCount: -2, movesB: 0 });
  assert.deepStrictEqual(diffMetrics(cur, null), { aaPageCount: null, movesB: null });
});

// ── prune ───────────────────────────────────────────────────────────────────
function titleDaysAgo(now, days) {
  const d = new Date(now.getTime() - days * 86400000);
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `auto_report_${yy}${mm}${dd}_0900`;
}

test('selectPruneCandidates: 32d pruned, 31d/30d kept (age boundary), keepMin=7', () => {
  const now = new Date('2026-07-29T00:00:00Z');
  // 9개 → 최신 7개는 keepMin 보호. 40d·32d만 보호 밖이고 age>31 충족 → 삭제
  const ages = [
    ['old', 40], ['edge-prune', 32], ['boundary', 31], ['edge-keep', 30],
    ['f1', 29], ['f2', 28], ['f3', 27], ['f4', 26], ['fresh', 1],
  ];
  const reports = ages.map(([id, d]) => ({ id, title: titleDaysAgo(now, d) }));
  const { prune, keep } = selectPruneCandidates(reports, now);
  assert.deepStrictEqual(prune.map(r => r.id).sort(), ['edge-prune', 'old']);
  assert.strictEqual(keep.length, 7);
  assert.ok(keep.some(r => r.id === 'boundary'), '31d kept (not > maxAgeDays)');
  assert.ok(keep.some(r => r.id === 'edge-keep'), '30d kept');
});

test('selectPruneCandidates: keepMin=7 shields recent even if old', () => {
  const now = new Date('2026-07-29T00:00:00Z');
  // 모두 35~43일 전(삭제 조건 충족) 9개 → 최신 7개 보존, 최고령 2개만 삭제
  const reports = [];
  for (let i = 0; i < 9; i++) {
    reports.push({ id: `r${i}`, title: titleDaysAgo(now, 35 + i) });
  }
  const { prune } = selectPruneCandidates(reports, now);
  assert.strictEqual(prune.length, 2);
  assert.deepStrictEqual(prune.map(r => r.id).sort(), ['r7', 'r8']);
});

test('selectPruneCandidates: non-matching titles are never pruned', () => {
  const now = new Date('2026-07-29T00:00:00Z');
  const { prune, keep } = selectPruneCandidates([
    { id: 'x1', title: '주간 회의록' },
    { id: 'x2', title: 'auto_report_260231_0900' }, // 부정확한 날짜
  ], now);
  assert.strictEqual(prune.length, 0);
  assert.strictEqual(keep.length, 0); // 파싱 불가 → 후보 자체에서 제외
});

// ── 실행 메타 ───────────────────────────────────────────────────────────────
test('buildRunId / runMode: ci vs local', () => {
  assert.strictEqual(buildRunId({ GITHUB_RUN_ID: '555', GITHUB_RUN_ATTEMPT: '2' }), '555#2');
  assert.strictEqual(buildRunId({ GITHUB_RUN_ID: '555' }), '555#1');
  assert.strictEqual(buildRunId({}), '0#0');
  assert.strictEqual(runMode({ GITHUB_ACTIONS: 'true' }), 'ci');
  assert.strictEqual(runMode({}), 'local');
});

// ── 룰 변경 감지 (작업 5) ───────────────────────────────────────────────────
test('detectRuleChange: prev null → null (첫 리포트: 비교 대상 없음)', () => {
  assert.strictEqual(detectRuleChange(null, 'abcd1234', '2026-07-30'), null);
});

test('detectRuleChange: 해시 동일 → null (룰 변경 없음)', () => {
  assert.strictEqual(detectRuleChange('abcd1234', 'abcd1234', '2026-07-30'), null);
});

test('detectRuleChange: 해시 상이 → advisory 문자열 반환', () => {
  const advisory = detectRuleChange('abcd1234', 'deadbee0', '2026-07-30');
  assert.strictEqual(typeof advisory, 'string');
  // 두 해시 + 오늘 날짜 모두 포함
  assert.ok(advisory.includes('abcd1234'), 'prev hash 포함');
  assert.ok(advisory.includes('deadbee0'), 'curr hash 포함');
  assert.ok(advisory.includes('2026-07-30'), 'todayStr 포함');
});

test('detectRuleChange: curr null → null (방어 — 발생 불가 시나리오)', () => {
  assert.strictEqual(detectRuleChange('abcd1234', null, '2026-07-30'), null);
});

// ── Gap 2: computeRepeatedHumanDecisions ────────────────────────────────────
const { computeRepeatedHumanDecisions } = require('../../scripts/report/report_lib');

test('computeRepeatedHumanDecisions: 같은 폴더 3회 이상이면 추출', () => {
  const decisions = [
    { targetFolderId: 'f1', targetFolderTitle: '기술문서', match: { titleRegex: '^MPS_v1$' }, decidedAt: '2026-07-15' },
    { targetFolderId: 'f1', targetFolderTitle: '기술문서', match: { titleRegex: '^MPS_v2$' }, decidedAt: '2026-07-16' },
    { targetFolderId: 'f1', targetFolderTitle: '기술문서', match: { titleRegex: '^MPS_v3$' }, decidedAt: '2026-07-17' },
    { targetFolderId: 'f2', targetFolderTitle: '회의록', match: { titleRegex: '^회의1$' }, decidedAt: '2026-07-18' },
  ];
  const result = computeRepeatedHumanDecisions(decisions, { threshold: 3 });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].targetFolderId, 'f1');
  assert.strictEqual(result[0].targetFolderTitle, '기술문서');
  assert.strictEqual(result[0].count, 3);
  assert.deepStrictEqual(result[0].titles, ['MPS_v1', 'MPS_v2', 'MPS_v3']);
  assert.strictEqual(result[0].firstDecidedAt, '2026-07-15');
});

test('computeRepeatedHumanDecisions: threshold 미만이면 빈 배열', () => {
  const decisions = [
    { targetFolderId: 'f1', targetFolderTitle: '기술문서', match: { titleRegex: '^MPS_v1$' }, decidedAt: '2026-07-15' },
    { targetFolderId: 'f1', targetFolderTitle: '기술문서', match: { titleRegex: '^MPS_v2$' }, decidedAt: '2026-07-16' },
  ];
  assert.deepStrictEqual(computeRepeatedHumanDecisions(decisions, { threshold: 3 }), []);
});

test('computeRepeatedHumanDecisions: 빈 decisions → 빈 배열', () => {
  assert.deepStrictEqual(computeRepeatedHumanDecisions([], { threshold: 3 }), []);
  assert.deepStrictEqual(computeRepeatedHumanDecisions(null, { threshold: 3 }), []);
});

test('computeRepeatedHumanDecisions: titleRegex에서 제목 추출 (^$ 제거)', () => {
  const decisions = [
    { targetFolderId: 'f1', targetFolderTitle: 'X', match: { titleRegex: '^hello\\sworld$' }, decidedAt: '2026-07-20' },
    { targetFolderId: 'f1', targetFolderTitle: 'X', match: { titleRegex: '^foo$' }, decidedAt: '2026-07-21' },
    { targetFolderId: 'f1', targetFolderTitle: 'X', match: { titleRegex: '^bar$' }, decidedAt: '2026-07-22' },
  ];
  const result = computeRepeatedHumanDecisions(decisions, { threshold: 3 });
  assert.deepStrictEqual(result[0].titles, ['hello\\sworld', 'foo', 'bar']);
});
