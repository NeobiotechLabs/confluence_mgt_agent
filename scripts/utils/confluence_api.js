'use strict';

require('../utils/load_env');
const https = require('https');

const BASE_URL = 'https://neobiotech.atlassian.net';
const EMAIL = process.env.CONFLUENCE_EMAIL;
const TOKEN = process.env.CONFLUENCE_TOKEN;
const AUTH_HEADER = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

/**
 * Confluence API 요청 공통 유틸리티
 */
async function confluenceRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: AUTH_HEADER,
        Accept: 'application/json',
      },
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`API Error [${res.statusCode}] ${endpoint}\n${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * v2 API 응답의 `_links.next`(relative/absolute URL)에서 path+query만 추출.
 * `_links.next`는 전체 경로+쿼리 문자열이라, 이걸 그대로 `cursor` 파라미터 값으로
 * 쓰면 400(INVALID_REQUEST_PARAMETER: not the correct type)이 난다.
 * 반환값을 그대로 다음 confluenceRequest의 endpoint로 쓰는 것이 Atlassian v2 권장 방식.
 */
function nextPagePath(res) {
  const next = res && res._links && res._links.next;
  if (!next) return null;
  const u = new URL(next, BASE_URL);
  return u.pathname + u.search;
}

/**
 * AA 스페이스의 최신 폴더 트리 구조(ID 및 Title)를 재귀적으로 가져와 텍스트 포맷으로 반환
 * System Design 정책 (3-2)에 따라 'is-folder' 레이블이 부착된 페이지만 폴더(컨테이너)로 취급합니다.
 */
async function fetchAASpaceTreeText() {
  try {
    const query = encodeURIComponent(`space="AA" and label="is-folder"`);
    const searchUrl = `/wiki/rest/api/content/search?cql=${query}&limit=200&expand=ancestors`;
    const res = await confluenceRequest('GET', searchUrl);
    
    const pageList = res.results || [];
    if (pageList.length === 0) {
      console.warn('⚠️ AA 스페이스에 is-folder 레이블을 가진 페이지가 없습니다. 전체 페이지를 가져옵니다.');
      return await fetchAASpaceTreeTextFallback();
    }
    
    // is-folder 페이지 ID 집합 (부모가 이 목록에 없으면 루트 노드로 취급)
    const folderIdSet = new Set(pageList.map(p => p.id));
    
    const childrenMap = {};
    const rootNodes = [];
    
    pageList.forEach(p => {
      const parentId = (p.ancestors && p.ancestors.length > 0) 
        ? p.ancestors[p.ancestors.length - 1].id 
        : null;
      
      // 부모가 is-folder 목록에 없거나 없는 경우 → 루트 노드로 취급
      if (!parentId || !folderIdSet.has(parentId)) {
        rootNodes.push(p);
      } else {
        if (!childrenMap[parentId]) childrenMap[parentId] = [];
        childrenMap[parentId].push(p);
      }
    });

    let treeText = '--- AA Space Folder IDs ---\n';
    function printTree(node, currentPath = '') {
      const newPath = currentPath ? `${currentPath} > ${node.title}` : node.title;
      treeText += `- ${newPath} (ID: ${node.id})\n`;
      const children = childrenMap[node.id] || [];
      children.forEach(c => printTree(c, newPath));
    }

    rootNodes.forEach(root => printTree(root));
    return treeText;

  } catch (error) {
    console.error('Failed to fetch AA Space Tree:', error.message);
    return '';
  }
}

// 초기 세팅 전 is-folder 태그가 하나도 없을 때를 대비한 Fallback (기존 로직)
async function fetchAASpaceTreeTextFallback() {
  try {
    const spaces = await confluenceRequest('GET', '/wiki/api/v2/spaces?keys=AA');
    if (!spaces.results || spaces.results.length === 0) return '';
    const spaceId = spaces.results[0].id;

    const pages = await confluenceRequest('GET', `/wiki/api/v2/spaces/${spaceId}/pages?limit=200`);
    const pageList = pages.results || [];
    
    const childrenMap = {};
    const rootNodes = [];
    
    pageList.forEach(p => {
      if (!p.parentId) rootNodes.push(p);
      else {
        if (!childrenMap[p.parentId]) childrenMap[p.parentId] = [];
        childrenMap[p.parentId].push(p);
      }
    });

    let treeText = '--- AA Space Folder IDs (Fallback: All Pages) ---\n';
    function printTree(node, currentPath = '') {
      const newPath = currentPath ? `${currentPath} > ${node.title}` : node.title;
      treeText += `- ${newPath} (ID: ${node.id})\n`;
      const children = childrenMap[node.id] || [];
      children.forEach(c => printTree(c, newPath));
    }

    rootNodes.forEach(root => printTree(root));
    return treeText;
  } catch (error) {
    return '';
  }
}

module.exports = {
  BASE_URL,
  AUTH_HEADER,
  confluenceRequest,
  nextPagePath,
  fetchAASpaceTreeText
};
