/**
 * migrate_to_aa_space.js  (v2 - 재이관 개선판)
 *
 * SD 스페이스의 이관 후보 페이지들을 AA 스페이스로 복사합니다.
 *
 * [v2 개선사항]
 * - 레이블 형식 통일: team:X → group-X, rag:X → rag-X, doctype:X → doctype-X 등
 * - 첨부파일(이미지 포함) 자동 복사
 * - 본문 내 SD 페이지 ID 참조를 AA 페이지 ID로 자동 치환
 * - 계층 구조 보장: parentId를 항상 정확히 지정
 *
 * 실행:
 *   node scripts/migrate_to_aa_space.js --dry-run        # 검증만 (실제 생성 없음)
 *   node scripts/migrate_to_aa_space.js                  # 실제 이관
 *   node scripts/migrate_to_aa_space.js --skip-attachments  # 첨부파일 건너뜀
 *   node scripts/migrate_to_aa_space.js --category="MPS 이력"  # 특정 카테고리만
 *
 * 필수 환경변수 (.env):
 *   CONFLUENCE_EMAIL=your@email.com
 *   CONFLUENCE_TOKEN=your_api_token
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── 설정 ─────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://neobiotech.atlassian.net';
const AA_SPACE_KEY = 'AA';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_ATTACHMENTS = process.argv.includes('--skip-attachments');
const CATEGORY_FILTER = (() => {
  const arg = process.argv.find(a => a.startsWith('--category='));
  return arg ? arg.split('=').slice(1).join('=') : null;
})();

const EMAIL = process.env.CONFLUENCE_EMAIL;
const TOKEN = process.env.CONFLUENCE_TOKEN;

if (!DRY_RUN && (!EMAIL || !TOKEN)) {
  console.error('오류: .env 파일에 CONFLUENCE_EMAIL, CONFLUENCE_TOKEN을 설정하세요.');
  process.exit(1);
}

const AUTH_HEADER = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;
const MIGRATION_LOG_PATH = path.join(__dirname, '..', 'reference', 'migration_log.json');

// API 호출 딜레이 (Rate Limit 방지)
const PAGE_DELAY_MS = 800;
const ATTACH_DELAY_MS = 600;

// ─── 레이블 형식 변환 규칙 ────────────────────────────────────────────────────
// Confluence Cloud는 레이블에 콜론(:) 사용 불가 → 하이픈(-)으로 치환
// team:X → group-X (prefix 변경), 나머지는 콜론만 하이픈으로

const LABEL_PREFIX_MAP = {
  'team': 'group',  // team:ai → group-ai
};

/**
 * 레이블 문자열을 Confluence 호환 형식으로 변환합니다.
 * @param {string} label  예: "team:ai", "doctype:mps-annual", "year:2025"
 * @returns {string}      예: "group-ai", "doctype-mps-annual", "year-2025"
 */
function normalizeLabel(label) {
  const colonIdx = label.indexOf(':');
  if (colonIdx === -1) return label.toLowerCase().replace(/\s+/g, '-');

  const prefix = label.slice(0, colonIdx);
  const value = label.slice(colonIdx + 1);
  const mappedPrefix = LABEL_PREFIX_MAP[prefix] || prefix;
  return `${mappedPrefix}-${value}`.toLowerCase().replace(/\s+/g, '-');
}

// ─── v2 카테고리 → AA 부모 페이지 매핑 (flat) ─────────────────────────────
// analysis_rules.json v2의 categories[].name (= migration_candidates.md의 ### 헤더)
// → AA 스페이스의 부모 페이지 제목. 1:1 flat 매핑.
// 매핑에 없는 카테고리는 AA 스페이스 루트(홈페이지) 아래에 생성됩니다.

const CATEGORY_TO_AA_PARENT = {
  // 과제 NAVIGATION
  'DYN — 의료기기 IEC 62304 산출물 (Wearable Navigation)': 'DYN — 의료기기 IEC 62304 산출물',
  'DN — Dynamic Navigation': 'DN — Dynamic Navigation',
  // 과제 SMILEARCH
  'SmileArch — Smile Design v2.0': 'SmileArch — Smile Design v2.0',
  // 과제 MPS (전사)
  'MPS 이력 (전사)': 'MPS 이력',
  // 과제 UNSORTED / 기타
  '전사 How-To / 개발 가이드': '전사 How-To / 개발 가이드',
  '전사 AI 전략 / 로드맵': '전사 AI 전략 / 로드맵',
  '기술 조사 / 시장 분석': '기술 조사 / 시장 분석',
  'Device — HW 부품/업체 조사': 'Device — HW 부품/업체 조사',
  '주간·월간 보고 (전사, 보관)': '주간·월간 보고',
  '정부과제': '정부과제',
  '기타 (분류 보류 — 휴먼 큐 대상)': '분류 보류',
};

// ─── 이관 로그 관리 ───────────────────────────────────────────────────────────

function loadMigrationLog() {
  if (!fs.existsSync(MIGRATION_LOG_PATH)) {
    return { migratedIds: new Set(), log: [] };
  }
  const data = JSON.parse(fs.readFileSync(MIGRATION_LOG_PATH, 'utf8'));
  const successEntries = (data.log || []).filter(e => !e.failed);
  return {
    migratedIds: new Set(successEntries.map(e => e.sourcePageId)),
    log: data.log || [],
  };
}

function saveMigrationLog(log) {
  fs.writeFileSync(MIGRATION_LOG_PATH, JSON.stringify({
    lastRun: new Date().toISOString(),
    totalMigrated: log.filter(e => !e.failed).length,
    log,
  }, null, 2), 'utf8');
}

// ─── Confluence API 클라이언트 ────────────────────────────────────────────────

/**
 * Confluence REST API 호출
 * @param {string} method
 * @param {string} fullUrl  - 완전한 URL 또는 경로 (/wiki/api/v2/...)
 * @param {object|null} body
 */
function confluenceRequest(method, fullUrl, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl.startsWith('http') ? fullUrl : `${BASE_URL}${fullUrl}`);
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); }
          catch (e) { resolve({}); }
        } else {
          reject(new Error(`HTTP ${res.statusCode} [${method} ${url.pathname}]: ${data.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Confluence 페이지 서비스 ─────────────────────────────────────────────────

/** AA 스페이스 정보 조회 */
async function getAASpaceInfo() {
  const data = await confluenceRequest('GET', `/wiki/api/v2/spaces?keys=${AA_SPACE_KEY}`);
  if (!data.results || data.results.length === 0) throw new Error('AA 스페이스를 찾을 수 없습니다.');
  return { spaceId: data.results[0].id, homepageId: data.results[0].homepageId };
}

/** 제목으로 AA 스페이스 내 페이지 ID 조회 */
async function findPageIdByTitle(title) {
  try {
    const encoded = encodeURIComponent(title);
    const data = await confluenceRequest('GET', `/wiki/api/v2/pages?space-key=${AA_SPACE_KEY}&title=${encoded}&limit=5`);
    const results = data.results || [];
    return results.length > 0 ? results[0].id : null;
  } catch (_) {
    return null;
  }
}

/**
 * SD 원본 페이지 상세 정보 조회
 * @returns {{ body: string, authorDisplayName: string, createdAt: string }}
 */
async function fetchPageDetail(pageId) {
  const data = await confluenceRequest('GET', `/wiki/api/v2/pages/${pageId}?body-format=storage&include-version=true`);
  const authorId = data.version?.authorId;
  let authorName = authorId || '(알 수 없음)';

  try {
    const userInfo = await confluenceRequest('GET', `/wiki/rest/api/user?accountId=${authorId}`);
    authorName = userInfo.displayName || authorName;
  } catch (_) {}

  return {
    body: data.body?.storage?.value || '',
    authorDisplayName: authorName,
    createdAt: data.version?.createdAt || '',
  };
}

/**
 * AA 스페이스에 새 페이지 생성
 */
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

/**
 * 레이블 부착 (v1 API 사용 - v2는 POST 미지원)
 */
async function addLabels(pageId, labels) {
  if (!labels || labels.length === 0) return;
  const normalizedLabels = labels.map(normalizeLabel);
  const payload = normalizedLabels.map(name => ({ prefix: 'global', name }));

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
    req.on('error', () => resolve()); // 레이블 실패는 무시
    req.write(body);
    req.end();
  });
}

// ─── 첨부파일 서비스 ──────────────────────────────────────────────────────────

/**
 * SD 원본 페이지의 첨부파일 목록 조회
 * @returns {{ id: string, title: string, mediaType: string, downloadUrl: string }[]}
 */
async function fetchAttachments(pageId) {
  try {
    const data = await confluenceRequest(
      'GET',
      `/wiki/rest/api/content/${pageId}/child/attachment?limit=50&expand=version`
    );
    return (data.results || []).map(a => ({
      id: a.id,
      title: a.title,
      mediaType: a.metadata?.mediaType || 'application/octet-stream',
      downloadUrl: `${BASE_URL}/wiki/rest/api/content/${pageId}/child/attachment/${a.id.replace('att', '')}/download`,
    }));
  } catch (_) {
    return [];
  }
}

/**
 * 첨부파일 바이너리 다운로드
 * @returns {Buffer|null}
 */
async function downloadAttachment(downloadUrl) {
  return new Promise((resolve) => {
    const url = new URL(downloadUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {},
    };

    // Atlassian 도메인에만 인증 헤더 추가 (AWS S3 등으로 리다이렉트 될 때 400 에러 방지)
    if (url.hostname.includes('atlassian.net')) {
      options.headers.Authorization = AUTH_HEADER;
    }

    const req = https.request(options, (res) => {
      // 리다이렉트 처리
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers.location;
        if (location) {
          // 상대 경로 리다이렉트 처리
          const redirectUrl = new URL(location, downloadUrl).href;
          downloadAttachment(redirectUrl).then(resolve).catch(() => resolve(null));
          return;
        }
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks));
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * 새 페이지에 첨부파일 업로드
 * @returns {string|null} 업로드된 첨부파일 ID
 */
async function uploadAttachment(pageId, filename, mediaType, buffer) {
  return new Promise((resolve) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`
    );
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.results?.[0]?.id || null);
          } catch (_) { resolve(null); }
        } else {
          console.warn(`      첨부파일 업로드 실패 (${filename}): HTTP ${res.statusCode}`);
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

/**
 * 미디어 타입이 이미지인지 판별합니다.
 * @param {string} mediaType
 */
function isImageType(mediaType) {
  return mediaType && mediaType.startsWith('image/');
}

/**
 * 미디어 타입이 영상인지 판별합니다.
 * @param {string} mediaType
 */
function isVideoType(mediaType) {
  return mediaType && (mediaType.startsWith('video/') || mediaType.startsWith('audio/'));
}

/**
 * SD 원본 페이지의 첨부파일 중 이미지만 새 AA 페이지에 복사합니다.
 * 영상/오디오는 복사하지 않고 원본 링크 목록으로 반환합니다.
 *
 * @param {string} srcPageId
 * @param {string} destPageId
 * @returns {{
 *   imageMapping: { oldId: string, newId: string, filename: string }[],
 *   skippedVideos: { title: string, downloadUrl: string, mediaType: string }[]
 * }}
 */
async function copyAttachments(srcPageId, destPageId) {
  const attachments = await fetchAttachments(srcPageId);
  if (attachments.length === 0) return { imageMapping: [], skippedVideos: [] };

  const images = attachments.filter(a => isImageType(a.mediaType));
  const videos = attachments.filter(a => isVideoType(a.mediaType));
  const others = attachments.filter(a => !isImageType(a.mediaType) && !isVideoType(a.mediaType));

  if (images.length > 0) {
    console.log(`      이미지 ${images.length}개 복사 중 (영상 ${videos.length}개는 원본 링크 유지)...`);
  }

  const imageMapping = [];

  for (const att of images) {
    const buffer = await downloadAttachment(att.downloadUrl);
    if (!buffer) {
      console.warn(`      ⚠️  다운로드 실패: ${att.title}`);
      continue;
    }

    const newAttId = await uploadAttachment(destPageId, att.title, att.mediaType, buffer);
    if (newAttId) {
      imageMapping.push({ oldId: att.id, newId: newAttId, filename: att.title });
      console.log(`      ✅ 이미지: ${att.title}`);
    }
    await sleep(ATTACH_DELAY_MS);
  }

  // 기타 파일(PDF, docx 등)도 이미지처럼 복사 시도
  for (const att of others) {
    const buffer = await downloadAttachment(att.downloadUrl);
    if (!buffer) continue;
    const newAttId = await uploadAttachment(destPageId, att.title, att.mediaType, buffer);
    if (newAttId) {
      imageMapping.push({ oldId: att.id, newId: newAttId, filename: att.title });
      console.log(`      ✅ 파일: ${att.title}`);
    }
    await sleep(ATTACH_DELAY_MS);
  }

  return { imageMapping, skippedVideos: videos };
}

// ─── 본문 변환 서비스 ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 이관 배너 생성
 * @param {object} meta
 * @param {{ title: string, downloadUrl: string }[]} skippedVideos  복사 안 된 영상 목록
 */
function buildBanner(meta, skippedVideos = []) {
  const migratedAt = new Date().toISOString().split('T')[0];
  const originalDate = meta.originalCreatedAt ? meta.originalCreatedAt.split('T')[0] : '(날짜 정보 없음)';
  const labelsStr = (meta.labels || []).map(normalizeLabel).join(', ');

  // 영상 원본 링크 목록 (있을 때만)
  let videoSection = '';
  if (skippedVideos.length > 0) {
    const videoLinks = skippedVideos
      .map(v => `<li><a href="${v.downloadUrl}">${escapeHtml(v.title)}</a> <em>(${v.mediaType})</em></li>`)
      .join('');
    videoSection = `
        <tr>
          <td><strong>🎬 영상/미디어 원본</strong></td>
          <td>
            <ul>${videoLinks}</ul>
            <em>※ 영상 파일은 용량 문제로 복사되지 않았습니다. 위 링크를 클릭하면 원본을 볼 수 있습니다.</em>
          </td>
        </tr>`;
  }

  return `
<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:rich-text-body>
    <p><strong>📌 [AA 스페이스 이관 정보]</strong></p>
    <table>
      <tbody>
        <tr><td><strong>원본 스페이스</strong></td><td>SD (Digital R&amp;D Center)</td></tr>
        <tr><td><strong>원본 페이지</strong></td><td><a href="${meta.sourcePageUrl}">${escapeHtml(meta.sourcePageTitle)}</a></td></tr>
        <tr><td><strong>원작성자</strong></td><td>${escapeHtml(meta.authorDisplayName)}</td></tr>
        <tr><td><strong>원본 최종수정일</strong></td><td>${originalDate}</td></tr>
        <tr><td><strong>이관일</strong></td><td>${migratedAt}</td></tr>
        <tr><td><strong>분류</strong></td><td>${escapeHtml(meta.category)} &gt; ${escapeHtml(meta.subCategory)}</td></tr>
        <tr><td><strong>레이블</strong></td><td><code>${escapeHtml(labelsStr)}</code></td></tr>${videoSection}
      </tbody>
    </table>
    <p><em>※ 이 페이지는 SD 스페이스 원본을 복사한 것입니다. 원본은 SD 스페이스에서 계속 관리됩니다.</em></p>
  </ac:rich-text-body>
</ac:structured-macro>
<hr />
`;
}

/**
 * 본문 내 SD 페이지 ID 참조를 AA 페이지 ID로 치환합니다.
 * 이미지/첨부파일 참조 경로 수정.
 * @param {string} body        원본 HTML
 * @param {string} srcPageId   SD 원본 페이지 ID
 * @param {string} destPageId  AA 새 페이지 ID
 */
function fixBodyReferences(body, srcPageId, destPageId) {
  if (!body) return body;

  return body
    // /wiki/download/attachments/{srcPageId}/ → /wiki/download/attachments/{destPageId}/
    .replace(
      new RegExp(`/wiki/download/attachments/${srcPageId}/`, 'g'),
      `/wiki/download/attachments/${destPageId}/`
    )
    // SD 스페이스 페이지 참조 내 space-key 변경은 하지 않음 (외부 링크는 원본 유지)
    ;
}

// ─── 이관 후보 파서 ───────────────────────────────────────────────────────────

function parseMigrationCandidatesMd() {
  const mdPath = path.join(__dirname, '..', 'reference', 'migration_candidates.md');
  if (!fs.existsSync(mdPath)) throw new Error('reference/migration_candidates.md 파일이 없습니다.');

  const content = fs.readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = content.split('\n');
  const candidates = [];
  let currentProject = null;   // ## 과제 X (v2 프로젝트 그룹)
  let currentCategory = null;  // ### 서브카테고리 (v2 실제 카테고리)
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // v2 프로젝트 그룹 헤더: ## 과제 NAVIGATION (37개)
    const projMatch = line.match(/^## 과제 (.+?) \(\d+개\)/);
    if (projMatch) { currentProject = projMatch[1].trim(); currentCategory = null; inTable = false; continue; }

    // v2 카테고리 헤더: ### DN — Dynamic Navigation (29개)
    const catMatch = line.match(/^### (.+?) \(\d+개\)/);
    if (catMatch) { currentCategory = catMatch[1].trim(); inTable = false; continue; }

    if (line.startsWith('| 출처') || line.startsWith('|---')) { inTable = true; continue; }
    if (line.startsWith('#')) { inTable = false; continue; }

    if (inTable && currentCategory && line.startsWith('|')) {
      // v2 테이블: | 출처 | 제목 | 최종수정 | 레이블 |
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length < 4) continue;

      // cols: [0]=source, [1]=title, [2]=lastModified, [3]=labels
      const titleUrlMatch = cols[1].match(/^\[(.+?)\]\((.+?)\)$/);
      if (!titleUrlMatch) continue;

      const title = titleUrlMatch[1].trim();
      const url = titleUrlMatch[2].trim();
      const sourceSpace = cols[0].trim();
      const lastModified = cols[2].trim();
      const labels = cols[3] ? cols[3].split(',').map(l => l.trim()).filter(Boolean) : [];
      const idMatch = url.match(/\/pages\/(\d+)/);
      const id = idMatch ? idMatch[1] : null;

      if (id && title) {
        candidates.push({
          id, title, url, lastModified, labels, sourceSpace,
          project: currentProject,
          category: currentCategory,
          subCategory: currentCategory,
        });
      }
    }
  }

  console.log(`  migration_candidates.md에서 ${candidates.length}개 후보 파싱 완료`);
  return candidates;
}

// ─── 섹션 페이지 캐시 ────────────────────────────────────────────────────────

async function buildSectionPageCache() {
  // v2 flat 매핑: 카테고리 → AA 부모 페이지 제목
  // 중복 제거된 부모 페이지 제목 목록을 조회
  const sectionTitles = [...new Set(Object.values(CATEGORY_TO_AA_PARENT))];

  const cache = new Map();
  console.log('  AA 스페이스 섹션 페이지 ID 조회 중...');

  for (const title of sectionTitles) {
    const pageId = await findPageIdByTitle(title);
    if (pageId) {
      cache.set(title, pageId);
      console.log(`    ✅ "${title}" → ID: ${pageId}`);
    } else {
      console.warn(`    ⚠️  "${title}" 페이지를 찾을 수 없습니다. AA 스페이스에 먼저 생성하세요.`);
    }
    await sleep(300);
  }

  return cache;
}

// ─── 단일 페이지 이관 ────────────────────────────────────────────────────────

async function migrateSinglePage(candidate, spaceId, sectionCache) {
  // 1. 부모 페이지 ID 결정 (v2 flat 매핑)
  const parentTitle = CATEGORY_TO_AA_PARENT[candidate.category];
  if (!parentTitle) return { success: false, error: `알 수 없는 카테고리: ${candidate.category}` };

  const parentId = sectionCache.get(parentTitle);
  if (!parentId) return { success: false, error: `부모 페이지 ID 없음: "${parentTitle}"` };

  // 2. SD 원본 상세 조회
  let detail;
  try {
    detail = await fetchPageDetail(candidate.id);
  } catch (err) {
    return { success: false, error: `원본 조회 실패: ${err.message}` };
  }

  // 3. 첨부파일 정보 먼저 조회 (배너에 영상 링크를 포함하기 위해)
  let skippedVideos = [];
  let imageMapping = [];
  if (!SKIP_ATTACHMENTS) {
    try {
      // 첨부파일 목록 미리 조회 (아직 복사는 안 함 - 페이지가 없으므로)
      const attachments = await fetchAttachments(candidate.id);
      skippedVideos = attachments.filter(a => isVideoType(a.mediaType));
    } catch (_) {}
  }

  // 4. 배너 생성 (영상 링크 포함)
  const banner = buildBanner({
    sourcePageId: candidate.id,
    sourcePageTitle: candidate.title,
    sourcePageUrl: candidate.url,
    authorDisplayName: detail.authorDisplayName,
    originalCreatedAt: detail.createdAt,
    category: candidate.category,
    subCategory: candidate.subCategory,
    labels: candidate.labels,
  }, skippedVideos);

  const bodyWithBanner = banner + (detail.body || '');

  // 5. AA 스페이스에 새 페이지 생성
  let newPage;
  try {
    newPage = await createPage(spaceId, parentId, candidate.title, bodyWithBanner);
  } catch (err) {
    return { success: false, error: `페이지 생성 실패: ${err.message}` };
  }

  // 6. 이미지 복사 (영상 제외)
  let attachmentCount = 0;
  if (!SKIP_ATTACHMENTS) {
    try {
      const result = await copyAttachments(candidate.id, newPage.id);
      imageMapping = result.imageMapping;
      attachmentCount = imageMapping.length;

      // 본문 내 이미지 참조 경로 수정 (복사된 이미지만 대상)
      if (imageMapping.length > 0) {
        const fixedBody = fixBodyReferences(bodyWithBanner, candidate.id, newPage.id);
        try {
          const currentPage = await confluenceRequest('GET', `/wiki/api/v2/pages/${newPage.id}?include-version=true`);
          const currentVersion = currentPage.version?.number || 1;
          await confluenceRequest('PUT', `/wiki/api/v2/pages/${newPage.id}`, {
            id: newPage.id,
            status: 'current',
            title: candidate.title,
            body: { representation: 'storage', value: fixedBody },
            version: { number: currentVersion + 1 },
          });
        } catch (err) {
          console.warn(`      ⚠️  본문 참조 업데이트 실패 (이미지는 복사됨): ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`      ⚠️  첨부파일 처리 실패 (페이지는 생성됨): ${err.message}`);
    }
  }

  // 6. 레이블 부착 (정규화된 형식으로)
  const allLabels = [...new Set([...candidate.labels, 'rag:source', 'migrated:sd'])];
  await addLabels(newPage.id, allLabels);

  return {
    success: true,
    newPageId: newPage.id,
    newPageUrl: newPage.webUrl,
    attachmentCount,
  };
}

// ─── 메인 실행 ────────────────────────────────────────────────────────────────

async function main() {
  console.log('========================================');
  console.log('  AA 스페이스 이관 스크립트 v2');
  console.log('========================================');
  console.log(`모드: ${DRY_RUN ? '🔍 DRY-RUN (실제 생성 없음)' : '🚀 실제 실행'}`);
  console.log(`첨부파일: ${SKIP_ATTACHMENTS ? '⏭️  건너뜀' : '✅ 복사 포함'}`);
  if (CATEGORY_FILTER) console.log(`필터: "${CATEGORY_FILTER}" 카테고리만 이관`);
  console.log('');

  // ── 후보 목록 로드 ──────────────────────────────────────────────────────────
  console.log('[1/4] 이관 후보 목록 로드 중...');
  let candidates = parseMigrationCandidatesMd();

  if (CATEGORY_FILTER) {
    candidates = candidates.filter(c => c.category === CATEGORY_FILTER);
  }

  const { migratedIds, log: existingLog } = loadMigrationLog();
  const toMigrate = candidates.filter(c => !migratedIds.has(c.id));
  const skipped = candidates.length - toMigrate.length;

  console.log(`  총 후보: ${candidates.length}개`);
  console.log(`  이미 이관됨 (스킵): ${skipped}개`);
  console.log(`  이관 예정: ${toMigrate.length}개\n`);

  if (toMigrate.length === 0) {
    console.log('✅ 이관할 항목이 없습니다. 모두 완료되었습니다.');
    return;
  }

  if (DRY_RUN) {
    const byCategory = {};
    toMigrate.forEach(c => {
      const key = `${c.category} > ${c.subCategory}`;
      if (!byCategory[key]) byCategory[key] = [];
      byCategory[key].push(c);
    });
    console.log('[DRY-RUN] 이관 예정 목록:\n');
    Object.entries(byCategory).forEach(([key, pages]) => {
      console.log(`📁 ${key} (${pages.length}개)`);
      pages.forEach(p => {
        const normalizedLabels = [...p.labels, 'rag:source', 'migrated:sd'].map(normalizeLabel).join(', ');
        console.log(`   - ${p.title}`);
        console.log(`     레이블: ${normalizedLabels}`);
      });
      console.log('');
    });
    console.log('──────────────────────────────────────────');
    console.log(`DRY-RUN 완료. 총 ${toMigrate.length}개 페이지가 이관될 예정입니다.`);
    return;
  }

  // ── 실제 이관 ─────────────────────────────────────────────────────────────
  console.log('[2/4] AA 스페이스 정보 조회 중...');
  let spaceId;
  try {
    const spaceInfo = await getAASpaceInfo();
    spaceId = spaceInfo.spaceId;
    console.log(`  스페이스 ID: ${spaceId}\n`);
  } catch (err) {
    console.error(`❌ AA 스페이스 조회 실패: ${err.message}`);
    process.exit(1);
  }

  console.log('[3/4] 섹션 페이지 ID 캐시 구성 중...');
  const sectionCache = await buildSectionPageCache();
  console.log('');

  console.log('[4/4] 페이지 이관 시작...\n');
  const newLog = [...existingLog];
  let successCount = 0;
  let failCount = 0;
  let totalAttachments = 0;

  for (let i = 0; i < toMigrate.length; i++) {
    const candidate = toMigrate[i];
    const progress = `[${i + 1}/${toMigrate.length}]`;
    console.log(`${progress} 이관 중: "${candidate.title}"`);
    console.log(`         → ${candidate.category} > ${candidate.subCategory}`);

    const result = await migrateSinglePage(candidate, spaceId, sectionCache);

    if (result.success) {
      successCount++;
      totalAttachments += result.attachmentCount || 0;
      console.log(`         ✅ 완료 (첨부파일 ${result.attachmentCount}개) → ${result.newPageUrl}`);
      newLog.push({
        sourcePageId: candidate.id,
        sourcePageTitle: candidate.title,
        sourcePageUrl: candidate.url,
        newPageId: result.newPageId,
        newPageUrl: result.newPageUrl,
        category: candidate.category,
        subCategory: candidate.subCategory,
        labels: candidate.labels.map(normalizeLabel),
        attachmentCount: result.attachmentCount,
        migratedAt: new Date().toISOString(),
      });
    } else {
      failCount++;
      console.error(`         ❌ 실패: ${result.error}`);
      newLog.push({
        sourcePageId: candidate.id,
        sourcePageTitle: candidate.title,
        sourcePageUrl: candidate.url,
        category: candidate.category,
        subCategory: candidate.subCategory,
        error: result.error,
        migratedAt: new Date().toISOString(),
        failed: true,
      });
    }

    saveMigrationLog(newLog);
    if (i < toMigrate.length - 1) await sleep(PAGE_DELAY_MS);
  }

  console.log('\n========================================');
  console.log('  이관 완료 요약');
  console.log('========================================');
  console.log(`  성공: ${successCount}개`);
  console.log(`  실패: ${failCount}개`);
  console.log(`  스킵 (기이관): ${skipped}개`);
  console.log(`  복사된 첨부파일: ${totalAttachments}개`);
  console.log(`  이관 로그: ${MIGRATION_LOG_PATH}`);
  console.log(`  AA 스페이스: ${BASE_URL}/wiki/spaces/${AA_SPACE_KEY}/overview`);

  if (failCount > 0) {
    console.log('\n⚠️  일부 페이지 이관에 실패했습니다.');
    console.log('   실패 항목은 migration_log.json에서 확인 후 재시도하세요.');
    console.log('   (성공한 항목은 재실행 시 자동으로 스킵됩니다)');
  }
}

main().catch(err => {
  console.error('\n치명적 오류:', err.message);
  process.exit(1);
});
