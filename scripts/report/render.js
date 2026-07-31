// scripts/report/render.js
'use strict';
const { escapeHtml } = require('../utils/migration_utils');
const { APPENDIX_MARKER } = require('./report_lib');

const METRIC_LABELS = {
  aaPageCount: 'AA 총 페이지',
  topLevelOrphans: '최상위 고아 페이지',
  unclassifiedCount: '미분류(미분류 폴더)',
  movesB: '자동 이동(루프 B)',
  advisories: '실행 경고',
  actionRequiredCount: '관리자 조치 필요',
};

/** delta 표시: null → "—"(직전 리포트 없음), 양수 → "+n", 그 외 그대로 */
function formatDelta(v) {
  if (v === null || v === undefined) return '—';
  return v > 0 ? `+${v}` : String(v);
}

function cell(v) {
  return escapeHtml(String(v ?? '—'));
}

function metricsSection(metrics, deltas) {
  const rows = Object.keys(METRIC_LABELS).map(k => {
    const label = METRIC_LABELS[k];
    const val = metrics[k];
    const d = deltas ? deltas[k] : null;
    return `<tr><td>${escapeHtml(label)}</td><td>${cell(val)}</td><td>${escapeHtml(formatDelta(d))}</td></tr>`;
  });
  return `<h2>§1 요약</h2>
<table><tbody>
<tr><th>지표</th><th>오늘</th><th>전일 대비</th></tr>
${rows.join('\n')}
</tbody></table>`;
}

function movesSection(items, failedMoves) {
  const parts = ['<h2>§3 루프 B — 자동 이동 로그</h2>'];
  const moves = (items || []).filter(it => it.kind === 'move-b');
  if (moves.length === 0) {
    parts.push('<p><em>오늘 자동 이동 없음.</em></p>');
  } else {
    const rows = moves.map(it => {
      const fromDisplay = it.fromFolderId ? cell(it.fromFolderId) : '<em>top (최상위 고아)</em>';
      return `<tr><td>${cell(it.title)}</td><td>${fromDisplay} → ${cell(it.toFolderId)}</td><td>${cell(it.source)}</td><td>${cell(it.reason)}</td><td>${cell(it.seenCount)}</td></tr>`;
    });
    parts.push(`<table><tbody>
<tr><th>페이지</th><th>이동(from → to)</th><th>판정 소스</th><th>사유</th><th>seen</th></tr>
${rows.join('\n')}
</tbody></table>`);
  }
  if (failedMoves && failedMoves.length > 0) {
    const rows = failedMoves.map(f => `<tr><td>${cell(f.title)}</td><td>${cell(f.error)}</td></tr>`);
    parts.push(`<p><strong>이동 실패 (${failedMoves.length}건)</strong></p>
<table><tbody>
<tr><th>페이지</th><th>오류</th></tr>
${rows.join('\n')}
</tbody></table>`);
  }
  return parts.join('\n');
}

/**
 * §4 AI 권고판 섹션 본문 렌더 (작업 9, Phase 2-A).
 * 정책: reference/classification_rules.md §8 (사용자 결정 2026-07-30).
 * - 문자열 권고 → <ul><li> escapeHtml
 * - kind:'misplacement-suspect' 객체 권고 → 표(table) 행
 * - 혼합 시 둘 다 렌더 (문자열 먼저, 그 뒤 표)
 * - 빈 데이터 / 자리표시 → "미실행 (Phase 2 예정)"
 * - 봇 자동 이동 없음 — 사람이 결정 (정책 합의 §8-4)
 */
function renderAdvisoriesSection(advisories) {
  const parts = ['<h2>§4 AI 권고판</h2>'];
  const items = Array.isArray(advisories) ? advisories : [];
  if (items.length === 0) {
    parts.push('<p><em>미실행 (Phase 2 예정)</em></p>');
    return parts.join('\n');
  }
  const strings = items.filter(a => typeof a === 'string');
  const structured = items.filter(a => a && typeof a === 'object' && a.kind === 'misplacement-suspect');
  if (strings.length > 0) {
    const lis = strings.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    parts.push(`<ul>${lis}</ul>`);
  }
  if (structured.length > 0) {
    const rows = structured.map(a => `<tr>
<td>${cell(a.title)}</td>
<td>${cell(a.currentFolderId)}</td>
<td>${cell(a.suggestedFolderId)}</td>
<td>${cell(a.confidence)}</td>
<td>${cell(a.confidenceReason)}</td>
<td>${cell(a.seenCount)}</td>
<td>${cell(a.firstSeen)} → ${cell(a.lastSeen)}</td>
</tr>`).join('\n');
    parts.push(`<table><tbody>
<tr><th>페이지</th><th>현재 폴더</th><th>추천 폴더</th><th>신뢰도</th><th>근거</th><th>seen</th><th>기간</th></tr>
${rows}
</tbody></table>`);
  }
  if (strings.length === 0 && structured.length === 0) {
    parts.push('<p><em>미실행 (Phase 2 예정)</em></p>');
  }
  return parts.join('\n');
}

/**
 * §2 루프 A — 외부 이관 결과 표 렌더 (작업 13).
 * kind:'migrate-a' items만 필터링하여 표로 표시.
 * 상태별 그룹: created → synced → skipped → failed.
 */
function migrateSection(items) {
  const migrateItems = (items || []).filter(it => it && it.kind === 'migrate-a');
  const parts = ['<h2>§2 루프 A — 외부 이관 결과</h2>'];
  if (migrateItems.length === 0) {
    parts.push('<p><em>이관 결과 없음 (실행 안 됨 또는 후보 0건)</em></p>');
    return parts.join('\n');
  }

  const STATUS_LABEL = { created: '신규 이관', synced: '동기화', skipped: '스킵', failed: '실패' };
  const rows = migrateItems.map(it => {
    const statusLabel = STATUS_LABEL[it.status] || it.status;
    const target = it.targetFolderTitle || it.targetFolderId || '—';
    const detail = it.error || it.reason || '—';
    return `<tr>
<td>${cell(it.title)}</td>
<td>${cell(it.sourceSpace)}</td>
<td>${cell(target)}</td>
<td>${cell(statusLabel)}</td>
<td>${cell(it.classifierSource || '—')}</td>
<td>${cell(detail)}</td>
</tr>`;
  }).join('\n');

  parts.push(`<p>총 ${migrateItems.length}건 처리</p>`);
  parts.push(`<table><tbody>
<tr><th>페이지</th><th>소스 스페이스</th><th>대상 폴더</th><th>상태</th><th>분류 소스</th><th>사유/오류</th></tr>
${rows}
</tbody></table>`);
  return parts.join('\n');
}

function noticeSection(appendix, failedMoves, advisories, repeatedHumanDecisions) {
  const notices = [];
  const orphans = appendix.metrics?.topLevelOrphans || 0;
  if (orphans > 0) notices.push(`최상위 고아 페이지 ${orphans}개가 홈페이지 직속에 남아 있습니다. 분류 정책을 확인하세요.`);
  if (failedMoves && failedMoves.length > 0) notices.push(`자동 이동 실패 ${failedMoves.length}건 — §3 실패 표를 확인하세요.`);
  // advisories는 운영 노이즈만 (§5의 목적). §4 LLM 권고는 §4 단독 표시 — 중복 방지.

  // Gap 2: 휴먼 결정 누적 — 같은 폴더로 3회 이상 휴먼 이동이 반복되면 룰 승격 권고
  const repeated = Array.isArray(repeatedHumanDecisions) ? repeatedHumanDecisions : [];
  for (const r of repeated) {
    const sampleTitles = (r.titles || []).slice(0, 3).join(', ');
    const suffix = (r.titles || []).length > 3 ? ` 외 ${(r.titles || []).length - 3}건` : '';
    notices.push(`⚠️ 휴먼 결정 누적: "${escapeHtml(r.targetFolderTitle)}" 폴더로 ${r.count}회 휴먼 이동 (${sampleTitles}${suffix}, 최초 ${r.firstDecidedAt}). analysis_rules.json에 명시 룰 추가를 검토하세요.`);
  }

  if (notices.length === 0) return '';
  const lis = notices.map(n => `<li>${n}</li>`).join('');
  return `<h2>§5 관리자 알림</h2>
<ac:structured-macro ac:name="warning" ac:schema-version="1"><ac:rich-text-body>
<ul>${lis}</ul>
</ac:rich-text-body></ac:structured-macro>`;
}

function metaTable(appendix) {
  const rows = [
    ['runId', appendix.runId],
    ['mode', appendix.mode],
    ['정책 해시', appendix.policyHash],
    ['코드 SHA', appendix.gitSha],
    ['분류 모델', appendix.model],
  ].map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td><code>${cell(v)}</code></td></tr>`);
  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

function appendixSection(appendix) {
  // CDATA 종료 시퀀스가 본문에 섞여도 안전하도록 표준 분할 기법 적용
  const json = JSON.stringify(appendix, null, 2).replace(/\]\]>/g, ']]]]><![CDATA[>');
  return `<h2>§7 기계 부록</h2>
${APPENDIX_MARKER}
<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">json</ac:parameter><ac:plain-text-body><![CDATA[${json}]]></ac:plain-text-body></ac:structured-macro>`;
}

/**
 * 일일 리포트의 Confluence storage format 본문을 렌더.
 * 모든 동적 값은 escapeHtml 처리. 부록 JSON은 코드 매크로 CDATA로 임베드.
 *
 * @param {Object} ctx
 * @param {Object} ctx.appendix - 부록 스키마 v1 객체 (runAt/runId/mode/policyHash/model/gitSha/metrics/items/advisories)
 * @param {Object} [ctx.deltas] - diffMetrics 결과 (null → "—")
 * @param {Array}  [ctx.failedMoves] - [{title, error}]
 * @param {Array}  [ctx.advisories] - 문자열 배열 (appendix.advisories와 동일해도 됨)
 * @returns {string} storage format HTML
 */
function renderReportStorage(ctx) {
  const { appendix, deltas = {}, failedMoves = [], advisories = [], repeatedHumanDecisions = [] } = ctx;
  const parts = [];

  parts.push(`<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body>
<p><strong>🤖 AA 스페이스 자동화 일일 리포트</strong> — 생성 시각(KST): ${cell(appendix.runAt)}</p>
</ac:rich-text-body></ac:structured-macro>`);

  parts.push(metricsSection(appendix.metrics || {}, deltas));

  parts.push(migrateSection(appendix.items || []));

  parts.push(movesSection(appendix.items || [], failedMoves));

  parts.push(renderAdvisoriesSection(advisories));

  const notice = noticeSection(appendix, failedMoves, advisories, repeatedHumanDecisions);
  if (notice) parts.push(notice);

  parts.push(`<h2>§6 실행 메타</h2>
${metaTable(appendix)}`);

  parts.push(appendixSection(appendix));

  return parts.join('\n');
}

module.exports = { renderReportStorage, renderAdvisoriesSection, formatDelta, METRIC_LABELS };
