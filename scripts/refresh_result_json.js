/**
 * refresh_result_json.js
 *
 * 목적: spaces_config.json 의 active 스페이스들 전체의 페이지 스냅샷을
 *       Confluence Cloud REST API 로 가져와 result_json/{space}_v2_p{n}.json 으로 저장.
 *       - 하드코딩 경로/ID 0
 *       - 모든 설정은 config/analysis_rules.json + spaces_config.json 에서 로드
 *       - v1 search API 의 CQL + start/limit 페이지네이션 사용 (snapshot.page_size / max_pages_per_file 룰 적용)
 *       - 페이지네이션 종료 조건: 응답 results.length < page_size 이거나 next 비어있음
 *
 * 실행:
 *   node scripts/refresh_result_json.js
 *   node scripts/refresh_result_json.js --space=SD
 *   node scripts/refresh_result_json.js --space=SD,WND   (콤마 구분 다중)
 *
 * 출력:
 *   scripts/result_json/{space}_v2_p1.json
 *   scripts/result_json/{space}_v2_p2.json ...
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { confluenceRequest } = require('./utils/confluence_api');

// ─── 설정 로드 (하드코딩 없음) ────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..');
const SPACES_CONFIG_PATH = path.join(REPO_ROOT, 'spaces_config.json');
const ANALYSIS_RULES_PATH = path.join(REPO_ROOT, 'config', 'analysis_rules.json');

const RESERVED_KEYS = ['GLOBAL_RULE_VERSION', 'LOOKBACK_DAYS'];

function loadConfig() {
  if (!fs.existsSync(SPACES_CONFIG_PATH)) {
    throw new Error(`spaces_config.json 없음: ${SPACES_CONFIG_PATH}`);
  }
  if (!fs.existsSync(ANALYSIS_RULES_PATH)) {
    throw new Error(`analysis_rules.json 없음: ${ANALYSIS_RULES_PATH}`);
  }
  const spaces = JSON.parse(fs.readFileSync(SPACES_CONFIG_PATH, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(ANALYSIS_RULES_PATH, 'utf8'));
  const snap = rules.snapshot || {};
  const outputDir = path.join(REPO_ROOT, snap.output_dir || 'scripts/result_json');
  const pageSize = snap.page_size || 100;
  const maxPagesPerFile = snap.max_pages_per_file || 100;
  const expand = snap.expand || 'ancestors,body.storage,version,metadata.labels,space';
  const filenameTemplate = snap.filename_template || '{space}_v2_p{index}.json';
  return { spaces, rules, outputDir, pageSize, maxPagesPerFile, expand, filenameTemplate };
}

function getActiveSpaces(spaces) {
  return Object.keys(spaces).filter(
    (k) => !RESERVED_KEYS.includes(k) && spaces[k] && spaces[k].active
  );
}

function parseSpaceArg(argv) {
  const arg = argv.find((a) => a.startsWith('--space='));
  if (!arg) return null;
  return arg.slice('--space='.length).split(',').map((s) => s.trim()).filter(Boolean);
}

// ─── API 호출 ────────────────────────────────────────────────────────────────

/**
 * CQL 기반 페이지 스냅샷을 페이지네이션으로 전부 가져옵니다.
 * - v1 search API 사용: /wiki/rest/api/content/search?cql=...
 * - start + limit 페이지네이션
 * - 200 페이지 × 100 = 20,000 페이지까지 안전
 */
async function fetchAllPagesInSpace(spaceKey, { pageSize, expand, lookbackDays }) {
  const since = new Date();
  since.setDate(since.getDate() - (lookbackDays || 7));
  const sinceStr = since.toISOString().split('T')[0];

  const cql = `space="${spaceKey}" AND type="page" AND lastmodified >= "${sinceStr}" order by lastmodified desc`;
  const encodedCql = encodeURIComponent(cql);
  const collected = [];
  let start = 0;
  let total = null;
  let page = 0;

  while (true) {
    page++;
    const url = `/wiki/rest/api/content/search?cql=${encodedCql}&limit=${pageSize}&start=${start}&expand=${encodeURIComponent(expand)}`;
    let res;
    try {
      res = await confluenceRequest('GET', url);
    } catch (e) {
      throw new Error(`[${spaceKey}] page ${page} fetch 실패: ${e.message}`);
    }
    const batch = res.results || [];
    if (total === null) total = res.totalSize || batch.length;
    collected.push(...batch);
    process.stdout.write(`\r  📥 [${spaceKey}] page ${page} | fetched ${collected.length}/${total}  `);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 25000) {
      console.warn(`\n  ⚠️ [${spaceKey}] 안전 제한(25000) 도달, 중단합니다.`);
      break;
    }
  }
  process.stdout.write('\n');
  return { pages: collected, total, lookbackSince: sinceStr };
}

// ─── 파일 저장 ────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function writeShards({ spaceKey, payload, outputDir, filenameTemplate, pageSize, total }) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  // 기존 스냅샷(같은 스페이스) 정리
  for (const f of fs.readdirSync(outputDir)) {
    if (f.startsWith(`${spaceKey}_v2_p`) && f.endsWith('.json')) {
      fs.unlinkSync(path.join(outputDir, f));
    }
  }
  const chunks = chunkArray(payload.pages, pageSize);
  if (chunks.length === 0) chunks.push([]);
  chunks.forEach((chunk, idx) => {
    const filename = filenameTemplate
      .replace('{space}', spaceKey)
      .replace('{index}', idx + 1);
    const filePath = path.join(outputDir, filename);
    const data = {
      meta: {
        spaceKey,
        spaceName: payload.spaceName || null,
        totalSize: total,
        chunkIndex: idx + 1,
        chunkCount: chunks.length,
        chunkSize: chunk.length,
        lookbackSince: payload.lookbackSince,
        fetchedAt: new Date().toISOString(),
        apiVersion: 'v1-search',
      },
      results: chunk,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`  💾 ${filename} (${chunk.length} pages)`);
  });
  return chunks.length;
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  const { spaces, outputDir, pageSize, maxPagesPerFile, expand, filenameTemplate } = loadConfig();
  const allActive = getActiveSpaces(spaces);
  const argSpaces = parseSpaceArg(process.argv.slice(2));
  const targetSpaces = argSpaces && argSpaces.length ? argSpaces : allActive;

  if (targetSpaces.length === 0) {
    console.log('⏭️  활성 스페이스가 없습니다. spaces_config.json 을 확인하세요.');
    return;
  }

  console.log(`🚀 refresh_result_json 시작`);
  console.log(`   활성 스페이스: ${allActive.join(', ')}`);
  console.log(`   대상 스페이스: ${targetSpaces.join(', ')}`);
  console.log(`   pageSize=${pageSize} maxPagesPerFile=${maxPagesPerFile}`);
  console.log(`   outputDir=${outputDir}`);
  console.log(`   lookback=${spaces.LOOKBACK_DAYS || 7}d`);
  console.log('');

  const summary = [];
  for (const spaceKey of targetSpaces) {
    console.log(`=================================================`);
    console.log(`📂 스페이스: ${spaceKey}  (${spaces[spaceKey]?.description || ''})`);
    try {
      const { pages, total, lookbackSince } = await fetchAllPagesInSpace(spaceKey, {
        pageSize: maxPagesPerFile, // 한 파일에 다 담되 chunk size 와 일치
        expand,
        lookbackDays: spaces.LOOKBACK_DAYS || 7,
      });
      const spaceMeta = spaces[spaceKey] || {};
      const shardCount = writeShards({
        spaceKey,
        payload: { pages, spaceName: spaceMeta.description, lookbackSince },
        outputDir,
        filenameTemplate,
        pageSize,
        total,
      });
      summary.push({ spaceKey, totalSize: total, fetched: pages.length, shardCount });
    } catch (e) {
      console.error(`❌ [${spaceKey}] 실패: ${e.message}`);
      summary.push({ spaceKey, error: e.message });
    }
    console.log('');
  }

  console.log(`=================================================`);
  console.log(`📋 요약`);
  for (const s of summary) {
    if (s.error) {
      console.log(`   ❌ ${s.spaceKey}: ${s.error}`);
    } else {
      console.log(`   ✅ ${s.spaceKey}: ${s.fetched}/${s.totalSize} pages, ${s.shardCount} shard(s)`);
    }
  }
  console.log(`\n📁 출력: ${outputDir}`);
}

main().catch((e) => {
  console.error('💥 fatal:', e.message);
  process.exit(1);
});