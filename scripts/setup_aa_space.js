/**
 * setup_aa_space.js
 *
 * AA 스페이스(덴탈AI연구소 운영 아카이브)의 페이지 계층 구조를 생성합니다.
 * AA 스페이스 키: AA
 * 인스턴스: https://neobiotech.atlassian.net
 *
 * 실행: node scripts/setup_aa_space.js [--dry-run] [--update]
 *   --dry-run : 실제 API 호출 없이 생성될 구조만 출력
 *   --update  : 기존 페이지의 본문과 레이블을 업데이트 (없으면 생성)
 *
 * 필수 환경변수 (.env):
 *   CONFLUENCE_EMAIL=your@email.com
 *   CONFLUENCE_TOKEN=your_api_token
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https = require('https');

// ─── 설정 ─────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://neobiotech.atlassian.net';
const AA_SPACE_KEY = 'AA';
const DRY_RUN = process.argv.includes('--dry-run');
const UPDATE = process.argv.includes('--update');

const EMAIL = process.env.CONFLUENCE_EMAIL;
const TOKEN = process.env.CONFLUENCE_TOKEN;

if (!DRY_RUN && (!EMAIL || !TOKEN)) {
  console.error('오류: .env 파일에 CONFLUENCE_EMAIL, CONFLUENCE_TOKEN을 설정하세요.');
  process.exit(1);
}

const AUTH_HEADER = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

// ─── AA 스페이스 계층 구조 정의 ──────────────────────────────────────────────

/**
 * AA 스페이스 페이지 트리 정의
 * 각 노드: { title, body, labels, children }
 *
 * body는 ADF(Atlassian Document Format) 또는 storage 형식 HTML
 */
const AA_SPACE_TREE = {
  home: {
    title: 'AA 스페이스 운영 정책 가이드',
    body: buildHomepageBody(),
    labels: ['doctype-guideline', 'group-center', 'status-evergreen'],
    children: [
      {
        title: 'MPS 이력',
        body: buildSectionBody('MPS 이력', 'AI/SW/Device/Solution/R&D 과제의 연간·월간·주간 MPS 이력을 보관합니다.'),
        labels: ['doctype-mps-monthly', 'group-center', 'status-active'],
        children: [
          {
            title: '연간 MPS',
            body: buildSectionBody('연간 MPS', '과제별 연간 MPS 전략 계획서 (LLM이 가장 먼저 참조하는 핵심 문서)'),
            labels: ['doctype-mps-annual', 'group-center', 'status-active', 'rag-priority'],
            children: [],
          },
          {
            title: '2025년 월간·주간',
            body: buildSectionBody('2025년 월간·주간', '2025년도 과제별 월간/주간 MPS 문서'),
            labels: ['year-2025', 'group-center', 'status-completed'],
            children: [
              { title: '25 연구소', body: buildSectionBody('25 연구소', '연구소 전체 월간/주간 MPS'), labels: ['group-center', 'year-2025'], children: [] },
              { title: '25 AI 과제', body: buildSectionBody('25 AI 과제', 'AI 과제 MPS 이력'), labels: ['group-ai', 'year-2025'], children: [] },
              { title: '25 SW 과제', body: buildSectionBody('25 SW 과제', 'SW 과제 MPS 이력'), labels: ['group-sw', 'year-2025'], children: [] },
              { title: '25 Device 과제', body: buildSectionBody('25 Device 과제', 'Device 과제 MPS 이력'), labels: ['group-device', 'year-2025'], children: [] },
            ],
          },
          {
            title: '2026년 월간·주간',
            body: buildSectionBody('2026년 월간·주간', '2026년도 과제별 월간/주간 MPS 문서'),
            labels: ['year-2026', 'group-center', 'status-active'],
            children: [
              { title: '26 연구소', body: buildSectionBody('26 연구소', '연구소 전체 월간/주간 MPS'), labels: ['group-center', 'year-2026'], children: [] },
              { title: '26 AI 과제', body: buildSectionBody('26 AI 과제', 'AI 과제 MPS 이력'), labels: ['group-ai', 'year-2026'], children: [] },
              { title: '26 SW 과제', body: buildSectionBody('26 SW 과제', 'SW 과제 MPS 이력'), labels: ['group-sw', 'year-2026'], children: [] },
              { title: '26 Device 과제', body: buildSectionBody('26 Device 과제', 'Device 과제 MPS 이력'), labels: ['group-device', 'year-2026'], children: [] },
            ],
          },
        ],
      },
      {
        title: '프로젝트 현황',
        body: buildSectionBody('프로젝트 현황', '과제별 진행 중인 프로젝트와 정부과제 현황을 관리합니다.'),
        labels: ['doctype-project-status', 'group-center', 'status-active'],
        children: [
          {
            title: '정부과제',
            body: buildSectionBody('정부과제', '진행 중인 정부 지원 과제 현황 요약'),
            labels: ['doctype-gov-project', 'group-center', 'status-active'],
            children: [],
          },
          {
            title: 'AI 프로젝트',
            body: buildSectionBody('AI 프로젝트', 'AI 과제 프로젝트 현황 및 로드맵'),
            labels: ['doctype-project-status', 'group-ai', 'status-active'],
            children: [],
          },
          {
            title: 'SW 프로젝트',
            body: buildSectionBody('SW 프로젝트', 'SW 과제 프로젝트 현황'),
            labels: ['doctype-project-status', 'group-sw', 'status-active'],
            children: [],
          },
          {
            title: 'Device 프로젝트',
            body: buildSectionBody('Device 프로젝트', 'Device 과제 프로젝트 현황 (Neo Robot 등)'),
            labels: ['doctype-project-status', 'group-device', 'status-active'],
            children: [],
          },
        ],
      },
      {
        title: '기술 조사 & 인사이트',
        body: buildSectionBody('기술 조사 & 인사이트', 'MPS 계획에 활용할 수 있는 기술 조사 및 시장 분석 자료'),
        labels: ['doctype-tech-survey', 'group-center', 'status-active'],
        children: [
          {
            title: 'AI·ML 기술',
            body: buildSectionBody('AI·ML 기술', 'RAG, Fine-tuning, Agent, MCP 등 AI/ML 기술 조사'),
            labels: ['doctype-tech-survey', 'group-ai', 'status-active'],
            children: [],
          },
          {
            title: '제품·시장 조사',
            body: buildSectionBody('제품·시장 조사', '전시회 분석, 경쟁사, 치과 시장 동향'),
            labels: ['doctype-market-survey', 'group-center', 'status-active'],
            children: [],
          },
          {
            title: '기술 표준 & 아키텍처',
            body: buildSectionBody('기술 표준 & 아키텍처', '소프트웨어 아키텍처, 개발 표준, 방법론'),
            labels: ['doctype-tech-survey', 'group-sw', 'status-active'],
            children: [],
          },
          {
            title: '특허·논문 분석',
            body: buildSectionBody('특허·논문 분석', '특허 조사 및 논문 리뷰 자료'),
            labels: ['doctype-patent', 'group-center', 'status-active'],
            children: [],
          },
        ],
      },
      {
        title: '팀 운영 가이드',
        body: buildSectionBody('팀 운영 가이드', 'MPS 작성 프로세스, 개발 표준, AI 활용 가이드라인'),
        labels: ['doctype-guideline', 'group-center', 'status-evergreen'],
        children: [],
      },
      {
        title: '주간·월간 보고 (보관)',
        body: buildSectionBody('주간·월간 보고 (보관)', '팀 주간 업무 공유 보고서 (최근 1년치 보관)'),
        labels: ['doctype-mps-weekly', 'group-center', 'status-active'],
        children: [
          {
            title: '2025년 보고',
            body: buildSectionBody('2025년 보고', '2025년 주간·월간 보고'),
            labels: ['year-2025', 'group-center', 'doctype-mps-weekly'],
            children: [],
          },
          {
            title: '2026년 보고',
            body: buildSectionBody('2026년 보고', '2026년 주간·월간 보고'),
            labels: ['year-2026', 'group-center', 'doctype-mps-weekly'],
            children: [],
          },
        ],
      },
      // ── v2 마이그레이션 추가 섹션 ──
      {
        title: 'DYN — 의료기기 IEC 62304 산출물',
        body: buildSectionBody('DYN — 의료기기 IEC 62304 산출물', 'Wearable Navigation 의료기기 IEC 62304 규제 산출물 (PA/EA Gate 문서)'),
        labels: ['doctype-regulatory', 'group-device', 'project-navigation', 'status-active'],
        children: [],
      },
      {
        title: 'DN — Dynamic Navigation',
        body: buildSectionBody('DN — Dynamic Navigation', 'Dynamic Navigation 프로젝트 설계/요구사항/조사 문서'),
        labels: ['group-device', 'project-navigation', 'status-active'],
        children: [],
      },
      {
        title: 'SmileArch — Smile Design v2.0',
        body: buildSectionBody('SmileArch — Smile Design v2.0', 'SmileArch CBCT 세그멘테이션 연구 문서'),
        labels: ['group-ai', 'project-smilearch', 'status-active'],
        children: [],
      },
      {
        title: '전사 How-To / 개발 가이드',
        body: buildSectionBody('전사 How-To / 개발 가이드', '전사 공통 개발 가이드 및 How-To 문서'),
        labels: ['doctype-guideline', 'group-center', 'status-evergreen'],
        children: [],
      },
      {
        title: '전사 AI 전략 / 로드맵',
        body: buildSectionBody('전사 AI 전략 / 로드맵', 'AI 전략, 로드맵, 기술 방향 문서'),
        labels: ['doctype-strategy', 'group-ai', 'status-active'],
        children: [],
      },
      {
        title: '기술 조사 / 시장 분석',
        body: buildSectionBody('기술 조사 / 시장 분석', '전시회 분석, 기술 스택 조사, 시장 동향'),
        labels: ['doctype-market-survey', 'group-center', 'status-active'],
        children: [],
      },
      {
        title: 'Device — HW 부품/업체 조사',
        body: buildSectionBody('Device — HW 부품/업체 조사', 'Device 과제 HW 부품 및 업체 조사 문서'),
        labels: ['doctype-survey', 'group-device', 'status-active'],
        children: [],
      },
      {
        title: '주간·월간 보고',
        body: buildSectionBody('주간·월간 보고', '전사 주간·월간 보고 (최신 보관)'),
        labels: ['doctype-mps-weekly', 'group-center', 'status-active'],
        children: [],
      },
      {
        title: '분류 보류',
        body: buildSectionBody('분류 보류', '자동 분류 보류 — 휴먼 리뷰 대상 문서'),
        labels: ['needs-review', 'group-center'],
        children: [],
      },
    ],
  },
};

// ─── 페이지 본문 빌더 ────────────────────────────────────────────────────────

function buildHomepageBody() {
  return `<h1>AA 스페이스 (덴탈AI연구소 운영 아카이브)</h1>
<p>이 스페이스는 <strong>MPS 계획·평가 자동화</strong>를 위한 선별된 지식 허브입니다.</p>
<h2>스페이스 목적</h2>
<ul>
  <li>MPS(Mission/Performance objectives/Strategy) 작성·평가 시 LLM이 참조할 데이터 원천 제공</li>
  <li>SD 스페이스에서 가치 있는 문서만 선별하여 정제·보관</li>
  <li>레이블 기반 체계적 분류로 RAG 검색 품질 최적화</li>
</ul>
<h2>레이블 체계</h2>
<table>
  <tr><th>그룹</th><th>레이블</th><th>설명</th></tr>
  <tr><td>조직/과제</td><td>group-center / group-ai / group-sw / group-device</td><td>연구소 및 과제 그룹</td></tr>
  <tr><td>문서유형(DocType)</td><td>doctype-mps-annual / doctype-mps-monthly / doctype-project-status / doctype-tech-survey / doctype-guideline ...</td><td>문서 성격</td></tr>
  <tr><td>연도(Year)</td><td>year-2024 / year-2025 / year-2026</td><td>문서 유효 연도</td></tr>
  <tr><td>상태(Status)</td><td>status-active / status-completed / status-evergreen / status-review-needed</td><td>문서 유효성 상태</td></tr>
</table>
<h2>명명 규칙</h2>
<ul>
  <li>MPS: <code>[과제] YYYY-MM 월간 MPS</code> / <code>[과제] YYYY 연간 MPS</code></li>
  <li>프로젝트: <code>[과제명] 현황 요약 (YYYY)</code></li>
  <li>기술 조사: <code>[주제] 기술 조사 (YYYY-MM)</code></li>
  <li>가이드라인: <code>[주제] 가이드라인 vX.X</code></li>
</ul>
<h2>폴더 구조</h2>
<ul>
  <li>MPS 이력: 연간 MPS / 연도별 월간·주간 (과제별 하위 폴더)</li>
  <li>프로젝트 현황: 정부과제 / AI·SW·Device·Solution 과제</li>
  <li>기술 조사 & 인사이트: AI·ML / 시장 / 표준 / 특허</li>
  <li>팀 운영 가이드: 공통 가이드라인</li>
  <li>주간·월간 보고 (보관): 연도별 보관</li>
</ul>
<h2>유효기간 정책</h2>
<ul>
  <li>MPS 이력: 무기한 보관 (완료 시 status-completed)</li>
  <li>기술 조사: 2년 후 review-needed</li>
  <li>주간 보고: 1년 후 SD 스페이스로 이동</li>
  <li>가이드라인: evergreen (버전업 유지)</li>
</ul>
<p><em>원본 문서: SD 스페이스(Digital R&amp;D Center) | 정책 수립: 2026-06-15</em></p>`;
}

function buildSectionBody(title, description) {
  return `<h1>${title}</h1>
<p>${description}</p>
<p><em>이 페이지는 섹션 인덱스입니다. 하위 페이지를 참조하세요.</em></p>`;
}

// ─── Confluence API 호출 ──────────────────────────────────────────────────────

/**
 * Confluence REST API v2 호출
 * @param {string} method
 * @param {string} endpoint
 * @param {object|null} body
 * @returns {Promise<object>}
 */
function confluenceRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/wiki/api/v2${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * AA 스페이스의 홈페이지 ID 조회
 * @returns {Promise<string>}
 */
async function getAASpaceHomepageId() {
  const data = await confluenceRequest('GET', `/spaces/${AA_SPACE_KEY}`);
  return data.homepageId;
}

/**
 * 페이지 생성
 * @param {string} spaceId
 * @param {string} parentId
 * @param {string} title
 * @param {string} bodyHtml
 * @returns {Promise<{id: string, title: string, webUrl: string}>}
 */
async function createPage(spaceId, parentId, title, bodyHtml) {
  const payload = {
    spaceId,
    parentId,
    status: 'current',
    title,
    body: {
      representation: 'storage',
      value: bodyHtml,
    },
  };

  const result = await confluenceRequest('POST', '/pages', payload);
  return {
    id: result.id,
    title: result.title,
    webUrl: `${BASE_URL}/wiki${result._links?.webui || ''}`,
  };
}

/**
 * 페이지 ID 조회 (멱등성 보장용)
 * parentId가 주어지면 해당 부모의 자식 페이지 중에서 제목으로 검색합니다.
 * parentId가 없으면 스페이스 전체에서 검색합니다 (스페이스 최상위 페이지에만 사용).
 * @param {string} title
 * @param {string|null} parentId
 */
async function findPageIdByTitle(title, parentId = null) {
  try {
    if (parentId) {
      // 부모 페이지의 자식 페이지 중에서 검색 (v2 API: /pages/{id}/children)
      const data = await confluenceRequest('GET', `/pages/${parentId}/children?limit=50`);
      const results = data.results || [];
      const found = results.find(p => p.title === title);
      return found ? found.id : null;
    } else {
      // 스페이스 전체 검색 (최상위 노드에만 허용)
      const encoded = encodeURIComponent(title);
      const data = await confluenceRequest('GET', `/pages?space-key=${AA_SPACE_KEY}&title=${encoded}&limit=5`);
      const results = data.results || [];
      return results.length > 0 ? results[0].id : null;
    }
  } catch (_) {
    return null;
  }
}

/**
 * 페이지에 레이블 일괄 부착
 * @param {string} pageId
 * @param {string[]} labels
 */
async function addLabels(pageId, labels) {
  if (!labels || labels.length === 0) return;
  const payload = labels.map(name => ({ prefix: 'global', name }));
  
  return new Promise((resolve) => {
    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/label`);
    const body = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 300) {
          console.error(`      ⚠️ 레이블 추가 실패 (${res.statusCode}): ${data}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      console.error(`      ⚠️ 레이블 요청 에러: ${err.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

/**
 * 페이지의 현재 레이블 목록 조회 (v1 API)
 * @param {string} pageId
 * @returns {Promise<string[]>}
 */
async function getLabels(pageId) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/label`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': AUTH_HEADER,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve((parsed.results || []).map(l => l.name));
        } catch (_) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.end();
  });
}

/**
 * 페이지에서 특정 레이블 삭제
 * @param {string} pageId
 * @param {string} labelName
 */
async function deleteLabel(pageId, labelName) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}/wiki/rest/api/content/${pageId}/label/${encodeURIComponent(labelName)}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'DELETE',
      headers: { 'Authorization': AUTH_HEADER },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve());
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * 레이블 동기화: 현재 레이블과 목표 레이블을 비교하여 추가/삭제
 * @param {string} pageId
 * @param {string[]} desiredLabels
 * @param {string} indent
 */
async function syncLabels(pageId, desiredLabels, indent = '') {
  const currentLabels = await getLabels(pageId);
  const desired = new Set(desiredLabels);
  const current = new Set(currentLabels);

  const toAdd = desiredLabels.filter(l => !current.has(l));
  const toRemove = currentLabels.filter(l => !desired.has(l));

  if (toRemove.length > 0) {
    console.log(`${indent}  🏷️  레이블 삭제: ${toRemove.join(', ')}`);
    for (const label of toRemove) {
      await deleteLabel(pageId, label);
      await sleep(200);
    }
  }

  if (toAdd.length > 0) {
    console.log(`${indent}  🏷️  레이블 추가: ${toAdd.join(', ')}`);
    await addLabels(pageId, toAdd);
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    console.log(`${indent}  🏷️  레이블 변경 없음`);
  }
}

/**
 * 페이지 본문 업데이트
 * @param {string} pageId
 * @param {string} title
 * @param {string} bodyHtml
 */
async function updatePageBody(pageId, title, bodyHtml) {
  const currentPage = await confluenceRequest('GET', `/pages/${pageId}`);
  const currentVersion = currentPage.version?.number || 1;

  await confluenceRequest('PUT', `/pages/${pageId}`, {
    id: pageId,
    status: 'current',
    title,
    body: {
      representation: 'storage',
      value: bodyHtml,
    },
    version: { number: currentVersion + 1 },
  });
}

/**
 * 재귀적으로 페이지 트리 생성 또는 업데이트
 * @param {string} spaceId
 * @param {string} parentId
 * @param {object[]} nodes
 * @param {string} indent
 */
async function createPageTree(spaceId, parentId, nodes, indent = '') {
  for (const node of nodes) {
    if (!node.labels) node.labels = [];
    if (!node.labels.includes('is-folder')) node.labels.push('is-folder');

    if (DRY_RUN) {
      if (UPDATE) {
        console.log(`${indent}[DRY-RUN] 업데이트 예정: "${node.title}"`);
        console.log(`${indent}          본문 업데이트 + 레이블 동기화`);
        console.log(`${indent}          목표 레이블: ${node.labels.join(', ')}`);
      } else {
        console.log(`${indent}[DRY-RUN] 생성 예정: "${node.title}"`);
        console.log(`${indent}          레이블: ${node.labels.join(', ')}`);
      }
      if (node.children && node.children.length > 0) {
        await createPageTree(spaceId, 'DUMMY_ID', node.children, indent + '  ');
      }
      continue;
    }

    try {
      console.log(`${indent}처리 중: "${node.title}"...`);
      // parentId를 기준으로 자식 페이지 중에서 검색 (동일 제목 중복 방지)
      let pageId = await findPageIdByTitle(node.title, parentId);

      if (pageId) {
        if (UPDATE) {
          // 업데이트 모드: 본문 + 레이블 동기화
          console.log(`${indent}📝 업데이트: ${node.title} (id:${pageId})`);
          await updatePageBody(pageId, node.title, node.body);
          await syncLabels(pageId, node.labels, indent);
        } else {
          console.log(`${indent}✅ 존재함 (스킵): ${node.title} (id:${pageId})`);
          // 레이블은 항상 부착 (기존 동작 유지)
          if (node.labels && node.labels.length > 0) {
            await addLabels(pageId, node.labels);
          }
        }
      } else {
        const page = await createPage(spaceId, parentId, node.title, node.body);
        pageId = page.id;
        console.log(`${indent}✅ 생성 완료: ${node.title} (id:${pageId})`);
        if (node.labels && node.labels.length > 0) {
          await addLabels(pageId, node.labels);
        }
      }

      await sleep(500);

      // 자식 페이지 재귀 생성/업데이트
      if (node.children && node.children.length > 0) {
        await createPageTree(spaceId, pageId, node.children, indent + '  ');
      }
    } catch (err) {
      console.error(`${indent}❌ 오류 (${node.title}): ${err.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 메인 실행 ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== AA 스페이스 구조 생성/업데이트 시작 ===');
  const modeDesc = DRY_RUN
    ? (UPDATE ? 'DRY-RUN + UPDATE (업데이트 미리보기)' : 'DRY-RUN (생성 미리보기)')
    : (UPDATE ? 'UPDATE (기존 페이지 업데이트)' : '실제 실행 (생성)');
  console.log(`모드: ${modeDesc}`);
  console.log('');

  let spaceId;
  let homepageId;

  if (DRY_RUN) {
    console.log('[DRY-RUN] AA 스페이스 정보 조회 생략\n');
    spaceId = 'DUMMY_SPACE_ID';
    homepageId = 'DUMMY_HOME_ID';
  } else {
    console.log('AA 스페이스 홈페이지 ID 조회...');
    const data = await confluenceRequest('GET', `/spaces?keys=${AA_SPACE_KEY}`);
    if (!data.results || data.results.length === 0) {
      console.error(`❌ 오류: AA 스페이스를 찾을 수 없습니다. (키: ${AA_SPACE_KEY})`);
      process.exit(1);
    }
    const spaceInfo = data.results[0];
    spaceId = spaceInfo.id;
    homepageId = spaceInfo.homepageId;
    console.log(`  스페이스 ID: ${spaceId}`);
    console.log(`  홈페이지 ID: ${homepageId}`);
    console.log('');
  }

  // 홈페이지 업데이트 (정책 가이드로)
  if (!DRY_RUN) {
    console.log('홈페이지 내용 업데이트 중...');
    try {
      await updatePageBody(homepageId, AA_SPACE_TREE.home.title, AA_SPACE_TREE.home.body);
      if (UPDATE) {
        await syncLabels(homepageId, AA_SPACE_TREE.home.labels, '');
      } else {
        await addLabels(homepageId, AA_SPACE_TREE.home.labels);
      }
      console.log('✅ 홈페이지 업데이트 완료\n');
    } catch (err) {
      console.warn(`홈페이지 업데이트 실패 (무시): ${err.message}\n`);
    }
  } else {
    console.log(`[DRY-RUN] 홈페이지 업데이트 예정: "${AA_SPACE_TREE.home.title}"`);
    console.log(`          레이블: ${AA_SPACE_TREE.home.labels.join(', ')}\n`);
  }

  // 하위 페이지 트리 생성
  console.log('하위 페이지 구조 생성...\n');
  await createPageTree(spaceId, homepageId, AA_SPACE_TREE.home.children);

  console.log('\n=== AA 스페이스 구조 생성/업데이트 완료 ===');
  if (DRY_RUN) {
    if (UPDATE) {
      console.log('실제 업데이트를 원하면 --dry-run 옵션을 제거하고 실행하세요.');
      console.log('예: node scripts/setup_aa_space.js --update');
    } else {
      console.log('실제 생성을 원하면 --dry-run 옵션을 제거하고 실행하세요.');
    }
  } else {
    console.log(`AA 스페이스 확인: ${BASE_URL}/wiki/spaces/${AA_SPACE_KEY}/overview`);
  }
}

main().catch(err => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
