'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../..', '.env') });
const https = require('https');
const { confluenceRequest } = require('./confluence_api');

const BASE_URL = 'https://neobiotech.atlassian.net';
const EMAIL = process.env.CONFLUENCE_EMAIL;
const TOKEN = process.env.CONFLUENCE_TOKEN;
const AUTH_HEADER = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

// Rate Limit 딜레이
const ATTACH_DELAY_MS = 600;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 1. 페이지 세부 정보 조회 ────────────────────────────────────────────────
async function fetchPageDetail(pageId) {
  // v1 API 한 번 호출로 본문 + 작성자 + 원본 생성일을 모두 조회 (v2 + v1 두 번 호출 대비 50% 절감)
  const data = await confluenceRequest(
    'GET',
    `/wiki/rest/api/content/${pageId}?expand=body.storage,history,version`
  );

  const authorId = data.version?.by?.accountId;
  const authorName = data.version?.by?.displayName || data.history?.createdBy?.displayName || '(알 수 없음)';
  const originalCreatedAt = data.history?.createdDate || '';

  return {
    body: data.body?.storage?.value || '',
    authorDisplayName: authorName,
    createdAt: originalCreatedAt,  // 원본 최초 생성일
    title: data.title || '',
    url: `${BASE_URL}/wiki${data._links?.webui || ''}`
  };
}

// ─── 2. 페이지 생성 및 업데이트 ──────────────────────────────────────────────
async function createPage(spaceId, parentId, title, bodyHtml) {
  const result = await confluenceRequest('POST', '/wiki/api/v2/pages', {
    spaceId,
    parentId,
    status: 'current',
    title,
    body: { representation: 'storage', value: bodyHtml },
  });
  return {
    id: result.id,
    title: result.title,
    webUrl: `${BASE_URL}/wiki${result._links?.webui || ''}`,
  };
}

async function updatePageBody(pageId, title, bodyHtml) {
  const currentPage = await confluenceRequest('GET', `/wiki/api/v2/pages/${pageId}`);
  const currentVersion = currentPage.version?.number || 1;

  await confluenceRequest('PUT', `/wiki/api/v2/pages/${pageId}`, {
    id: pageId,
    status: 'current',
    title,
    body: { representation: 'storage', value: bodyHtml },
    version: { number: currentVersion + 1 },
  });
}

async function addLabels(pageId, labels) {
  if (!labels || labels.length === 0) return;
  const payload = labels.map(name => ({ prefix: 'global', name }));

  return new Promise((resolve) => {
    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/label`);
    const body = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

// ─── 레이블 및 페이지 이동 로직 추가 ──────────────────────────────────
async function getLabels(pageId) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/label`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve((parsed.results || []).map(l => l.name));
        } catch (_) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function deleteLabel(pageId, labelName) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/label/${encodeURIComponent(labelName)}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'DELETE',
      headers: { Authorization: AUTH_HEADER },
    };
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    req.on('error', () => resolve());
    req.end();
  });
}

const isProtectedLabel = (label) =>
  label === 'is-folder' ||
  label === 'human-classified' ||
  label.startsWith('last-parent-');

async function syncLabels(pageId, desiredLabels) {
  const currentLabels = await getLabels(pageId);
  const desired = new Set(desiredLabels);
  const current = new Set(currentLabels);

  const toAdd = desiredLabels.filter(l => !current.has(l));
  const toRemove = currentLabels.filter(l => !desired.has(l) && !isProtectedLabel(l));

  for (const label of toRemove) {
    await deleteLabel(pageId, label);
    await sleep(200);
  }
  if (toAdd.length > 0) {
    await addLabels(pageId, toAdd);
  }
  return { added: toAdd, removed: toRemove };
}

async function movePage(pageId, newParentId) {
  const currentPage = await confluenceRequest('GET', `/wiki/api/v2/pages/${pageId}`);
  const currentVersion = currentPage.version?.number || 1;

  await confluenceRequest('PUT', `/wiki/api/v2/pages/${pageId}`, {
    id: pageId,
    status: 'current',
    title: currentPage.title,
    parentId: newParentId,
    version: { number: currentVersion + 1 }
  });
}

/**
 * 페이지에 코멘트(inline comment) 추가 — v1 child/comment 엔드포인트.
 * 미분류 페이지에 LLM 분류 의견을 첨부해 사람 검토 루프의 입력으로 쓴다.
 */
async function addComment(pageId, htmlBody) {
  return confluenceRequest('POST', `/wiki/rest/api/content/${pageId}/child/comment`, {
    type: 'comment',
    container: { id: String(pageId) },
    body: { representation: 'storage', value: htmlBody },
  });
}

// ─── 3. 첨부파일 복사 관련 ──────────────────────────────────────────────────
async function fetchAttachments(pageId) {
  try {
    const data = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/child/attachment?limit=50&expand=version`);
    return (data.results || []).map(a => ({
      id: a.id,
      title: a.title,
      mediaType: a.metadata?.mediaType || 'application/octet-stream',
      downloadUrl: `${BASE_URL}/wiki/rest/api/content/${pageId}/child/attachment/${a.id.replace('att', '')}/download`,
    }));
  } catch (_) { return []; }
}

async function downloadAttachment(downloadUrl) {
  return new Promise((resolve) => {
    const url = new URL(downloadUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {},
    };

    if (url.hostname.includes('atlassian.net')) {
      options.headers.Authorization = AUTH_HEADER;
    }

    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, downloadUrl).href;
        downloadAttachment(redirectUrl).then(resolve).catch(() => resolve(null));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300 ? Buffer.concat(chunks) : null));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function uploadAttachment(pageId, filename, mediaType, buffer) {
  return new Promise((resolve) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`);
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/child/attachment`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: AUTH_HEADER,
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.results?.[0]?.id || null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function isImageType(mediaType) { return mediaType && mediaType.startsWith('image/'); }
function isVideoType(mediaType) { return mediaType && (mediaType.startsWith('video/') || mediaType.startsWith('audio/')); }

async function copyAttachments(srcPageId, destPageId) {
  const attachments = await fetchAttachments(srcPageId);
  if (attachments.length === 0) return { imageMapping: [], skippedVideos: [] };

  const images = attachments.filter(a => isImageType(a.mediaType));
  const videos = attachments.filter(a => isVideoType(a.mediaType));
  const others = attachments.filter(a => !isImageType(a.mediaType) && !isVideoType(a.mediaType));

  const imageMapping = [];
  
  if (images.length > 0) console.log(`      이미지 ${images.length}개 복사 중...`);
  for (const att of images.concat(others)) {
    const buffer = await downloadAttachment(att.downloadUrl);
    if (!buffer) continue;
    const newAttId = await uploadAttachment(destPageId, att.title, att.mediaType, buffer);
    if (newAttId) imageMapping.push({ oldId: att.id, newId: newAttId, filename: att.title });
    await sleep(ATTACH_DELAY_MS);
  }

  return { imageMapping, skippedVideos: videos };
}

// ─── 4. 본문 변환 관련 ──────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildBanner(meta, skippedVideos = []) {
  const migratedAt = new Date().toISOString().split('T')[0];
  const originalDate = meta.originalCreatedAt ? meta.originalCreatedAt.split('T')[0] : '(날짜 정보 없음)';
  const labelsStr = (meta.labels || []).join(', ');

  let videoSection = '';
  if (skippedVideos.length > 0) {
    const videoLinks = skippedVideos.map(v => `<li><a href="${v.downloadUrl}">${escapeHtml(v.title)}</a> <em>(${v.mediaType})</em></li>`).join('');
    videoSection = `<tr><td><strong>🎬 영상 원본</strong></td><td><ul>${videoLinks}</ul></td></tr>`;
  }

  return `
<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:rich-text-body>
    <p><strong>📌 [자동 이관 문서]</strong></p>
    <table>
      <tbody>
        <tr><td><strong>적용된 룰 버전</strong></td><td>${escapeHtml(meta.ruleVersion || '1.0')}</td></tr>
        <tr><td><strong>마지막 감사 버전(Page)</strong></td><td>${escapeHtml(meta.pageVersion || '1')}</td></tr>
        <tr><td><strong>원본 스페이스</strong></td><td>${escapeHtml(meta.sourceSpaceKey || '알 수 없음')}</td></tr>
        <tr><td><strong>원본 위치</strong></td><td><a href="${meta.sourcePageUrl}">${escapeHtml(meta.sourcePageTitle)}</a></td></tr>
        <tr><td><strong>원작성자</strong></td><td>${escapeHtml(meta.authorDisplayName)}</td></tr>
        <tr><td><strong>원본 작성일</strong></td><td>${originalDate}</td></tr>
        <tr><td><strong>이관/동기화일</strong></td><td>${migratedAt}</td></tr>
        <tr><td><strong>부여된 레이블</strong></td><td><code>${escapeHtml(labelsStr)}</code></td></tr>${videoSection}
      </tbody>
    </table>
    <p><em>※ 이 문서는 자동화 봇에 의해 원본을 복사해온 문서입니다.</em></p>
  </ac:rich-text-body>
</ac:structured-macro>
<hr />
`;
}

function fixBodyReferences(body, srcPageId, destPageId) {
  if (!body) return body;
  return body.replace(new RegExp(`/wiki/download/attachments/${srcPageId}/`, 'g'), `/wiki/download/attachments/${destPageId}/`);
}

module.exports = {
  fetchPageDetail,
  createPage,
  updatePageBody,
  getLabels,
  deleteLabel,
  syncLabels,
  movePage,
  addLabels,
  addComment,
  copyAttachments,
  buildBanner,
  fixBodyReferences,
  escapeHtml
};
