// scripts/utils/aa_pages.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { confluenceRequest, nextPagePath } = require('./confluence_api');

/**
 * AA 스페이스의 전체 페이지를 {id, title, parentId, labels}로 목록화.
 * audit_aa_space.js / reorganize_aa_space.js / report_aa_daily.js가 공유한다.
 *
 * AA 스페이스로 한정하지 않으면 전 인스턴스 페이지를 순회하며,
 * 타 스페이스 페이지에 last-parent-* 라벨을 찍거나 타 스페이스 루트 페이지를
 * AA 폴더로 movePage 시도하는 부작용이 발생한다. v2 GET /pages는 space-id로만
 * space 필터를 받는다.
 */
async function listAAPages() {
  const sp = await confluenceRequest('GET', '/wiki/api/v2/spaces?keys=AA');
  const spaceId = sp?.results?.[0]?.id;
  if (!spaceId) {
    console.warn('⚠️ AA space id not found; listAAPages returns [] to avoid cross-space mutation.');
    return [];
  }
  const all = [];
  // v2 pagination: `_links.next`는 전체 경로+쿼리라 그 자체를 cursor 값으로 쓰면
  // 400(INVALID_REQUEST_PARAMETER)이 난다. next 링크를 다음 요청 endpoint로 그대로 사용.
  let next = `/wiki/api/v2/pages?space-id=${spaceId}&limit=100`;
  while (next) {
    const res = await confluenceRequest('GET', next);
    for (const p of (res.results || [])) {
      const labels = await fetchLabels(p.id);
      all.push({ id: p.id, title: p.title, parentId: p.parentId, labels });
    }
    next = nextPagePath(res);
  }
  return all;
}

/**
 * 페이지의 global 라벨 이름 목록을 반환 (v1 label 엔드포인트).
 * 실패 시 빈 배열(크래시 방지).
 */
async function fetchLabels(pageId) {
  try {
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/label?limit=50`);
    return (res.results || []).map(l => l.name);
  } catch { return []; }
}

module.exports = { listAAPages, fetchLabels };
