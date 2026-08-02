'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree } = require('./utils/aa_space_tree');
const { classifyWithChain } = require('./classifiers/engine');
const { assessMigrationValue } = require('./utils/migration_value');
const {
  loadDroppedCache,
  saveDroppedCache,
  consultDroppedCache,
  mergeDroppedCache,
  hashFor,
} = require('./migrator/dropped_cache');

const {
  fetchPageDetail,
  createPage,
  updatePageBody,
  addLabels,
  copyAttachments,
  buildBanner,
  fixBodyReferences
} = require('./utils/migration_utils');

const AA_SPACE_KEY = 'AA';
const DROPPED_CACHE_PATH = path.join(__dirname, '..', 'reference', 'dropped_pages.json');

// YYYY-MM-DD + days → YYYY-MM-DD (UTC). addDays 시드(source) 기준.
function addDays(yyyyMmDd, days) {
  const d = new Date(yyyyMmDd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// API Rate Limit 방지를 위한 대기 함수
const delay = ms => new Promise(res => setTimeout(res, ms));

// v1 search 응답은 expand=body.storage만 포함하므로 metadata.labels는 비어 있음.
// 휴먼 분류기(human-classified 태그) 등이 existingLabels를 신뢰해야 하므로
// 별도 라벨 엔드포인트로 페이지별로 조회.
async function fetchPageLabels(pageId) {
  try {
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/label?limit=50`);
    return (res.results || []).map(l => l.name);
  } catch (_) {
    return [];
  }
}

// CQL 문자열 리터럴 이스케이프 (백슬래시 + 큰따옴표).
const cqlEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// AA 스페이스에 동일 제목 페이지가 이미 존재하는지 조회.
// Confluence Cloud는 스페이스 내 페이지 제목 유일성을 강제하므로, 이 조회 결과가
// 재이관 시 400 title-collision 대신 "제자리 덮어쓰기 동기화" 분기의 근거가 된다.
// 조회 실패 시 null 반환 → 호출부는 일반 create 흐름으로 폴백(충돌은 per-page catch가 흡수).
// deps.confluenceRequest 주입 가능(테스트 밀폐).
async function findPageByTitleInAA(title, deps = {}) {
  const req = deps.confluenceRequest || confluenceRequest;
  const cql = encodeURIComponent(`space="${AA_SPACE_KEY}" AND type="page" AND title="${cqlEscape(title)}"`);
  try {
    const res = await req('GET', `/wiki/rest/api/content/search?cql=${cql}&limit=5`);
    const hits = (res.results || []).filter(r => r.status === 'current' && r.title === title);
    if (hits.length > 1) {
      console.warn(`⚠️ [동기화] AA에 동명 페이지 ${hits.length}건 — 첫 번째(id=${hits[0].id})를 사용합니다.`);
    }
    return hits[0] || null;
  } catch (e) {
    console.warn(`⚠️ [동기화] 동명 페이지 조회 실패: ${e.message} — 일반 생성 흐름으로 진행합니다.`);
    return null;
  }
}

/**
 * 마이그레이션을 실행하고 구조화된 결과를 반환.
 * report_aa_daily.js(§2 루프 A)와 CLI(runMigrator)에서 공통으로 호출.
 *
 * @param {{dryRun?: boolean, deps?: Object}} opts
 * @param {boolean} opts.dryRun - true면 실제 생성/업데이트 없이 후보 탐색만
 * @param {Object} opts.deps - 의존성 주입 (테스트 밀폐). 미지정 시 실제 모듈 사용.
 * @returns {Promise<{items: Array}>} items: kind:'migrate-a' 객체 배열
 */
async function runMigrate(opts = {}) {
  const { dryRun = false, deps = {} } = opts;
  const items = [];

  // 의존성 주입 (기본값: 실제 모듈)
  const req = deps.confluenceRequest || confluenceRequest;
  const _fetchPageDetail = deps.fetchPageDetail || fetchPageDetail;
  const _fetchPageLabels = deps.fetchPageLabels || fetchPageLabels;
  const _classifyWithChain = deps.classifyWithChain || classifyWithChain;
  const _assessMigrationValue = deps.assessMigrationValue || assessMigrationValue;
  const _loadDroppedCache = deps.loadDroppedCache || loadDroppedCache;
  const _saveDroppedCache = deps.saveDroppedCache || saveDroppedCache;
  const _consultDroppedCache = deps.consultDroppedCache || consultDroppedCache;
  const _mergeDroppedCache = deps.mergeDroppedCache || mergeDroppedCache;
  const _hashFor = deps.hashFor || hashFor;
  const _today = deps.today || new Date().toISOString().slice(0, 10);
  const _createPage = deps.createPage || createPage;
  const _updatePageBody = deps.updatePageBody || updatePageBody;
  const _addLabels = deps.addLabels || addLabels;
  const _copyAttachments = deps.copyAttachments || copyAttachments;
  const _buildBanner = deps.buildBanner || buildBanner;
  const _fixBodyReferences = deps.fixBodyReferences || fixBodyReferences;
  const _findPageByTitleInAA = deps.findPageByTitleInAA || findPageByTitleInAA;
  const _fetchAATree = deps.fetchAATree || fetchAATree;

  // 1. spaces_config.json 로드
  const configPath = path.join(__dirname, '..', 'spaces_config.json');
  if (!fs.existsSync(configPath)) {
    return { items };
  }
  const spacesConfig = deps.spacesConfig || JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // 2. 활성 스페이스 필터
  const RESERVED_KEYS = ['GLOBAL_RULE_VERSION', 'LOOKBACK_DAYS'];
  const activeSpaceKeys = Object.keys(spacesConfig).filter(
    key => !RESERVED_KEYS.includes(key) && spacesConfig[key].active
  );
  if (activeSpaceKeys.length === 0) return { items };

  // 3. AA 트리 + 스페이스 ID
  const aaTree = await _fetchAATree();
  const contextTree = aaTree.toText();
  if (!contextTree) return { items };

  let targetSpaceId;
  try {
    const spaces = await req('GET', `/wiki/api/v2/spaces?keys=${AA_SPACE_KEY}`);
    if (spaces && spaces.results && spaces.results.length > 0) {
      targetSpaceId = spaces.results[0].id;
    } else {
      return { items };
    }
  } catch {
    return { items };
  }

  // 4. 룩백 기간
  const lookbackDays = spacesConfig.LOOKBACK_DAYS || 7;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - lookbackDays);
  const sinceDateStr = sinceDate.toISOString().split('T')[0];

  // 5. 스페이스 순회
  // 4-0. Dropped 캐시 로드 (graceful — 부재/깨짐 모두 []로 퇴화)
  let droppedCache = [];
  let saveError = null;
  try {
    droppedCache = await _loadDroppedCache(DROPPED_CACHE_PATH);
  } catch (e) {
    droppedCache = [];
    saveError = `load-dropped-cache:${e.message}`;
  }
  const cacheUpdates = [];
  const today = _today;

  for (const sourceSpace of activeSpaceKeys) {
    const cql = encodeURIComponent(
      `space="${sourceSpace}" AND type="page" AND lastmodified >= "${sinceDateStr}" order by lastmodified desc`);
    const searchUrl = `/wiki/rest/api/content/search?cql=${cql}&limit=200&expand=body.storage`;

    let candidates;
    try {
      const res = await req('GET', searchUrl);
      candidates = res.results || [];
    } catch {
      continue;
    }
    if (candidates.length === 0) continue;

    // globalRuleVersion (배너용)
    const globalRuleVersion = spacesConfig.GLOBAL_RULE_VERSION || '1.0';

    for (const page of candidates) {
      const pageBody = page.body?.storage?.value || '';
      const truncatedBody = pageBody.substring(0, 20000);

      try {
        const srcMeta = await _fetchPageDetail(page.id);
        const pageDate = srcMeta.createdAt ? srcMeta.createdAt.substring(0, 10) : '';

        const existingLabels = await _fetchPageLabels(page.id);
        const chainResult = await _classifyWithChain({
          pageId: page.id,
          title: page.title,
          body: truncatedBody,
          ancestors: [],
          sourceSpace,
          sourceUrl: page._links?.webui || '',
          pageDate,
          existingLabels,
        }, aaTree);

        // ── 1차: 분류 verdict 정규화
        // chainResult.ok=true & folderId=null → needs_new_category (true chain failure과 구분)
        // chainResult.ok=false → chain-fail (분류 자체 실패)
        const needsNewCategory = chainResult.ok === true && !chainResult.folderId;
        const classificationOk = chainResult.ok && !!chainResult.folderId;
        const decision = classificationOk ? {
          is_valid: true,
          target_folder_id: chainResult.folderId,
          target_folder_title: chainResult.folderTitle,
          needs_new_category: false,
          reason: chainResult.reason,
          labels: chainResult.labels,
          classifier_source: chainResult.source,
        } : {
          is_valid: false,
          target_folder_id: null,
          needs_new_category: needsNewCategory,
          reason: chainResult.reason || 'no-classifier-matched',
          classifier_source: chainResult.source || 'miss',
        };

        // needs_new_category (chain이 ok=true지만 folderId 없음) → skip
        if (decision.needs_new_category) {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: null,
            targetFolderTitle: null,
            status: 'skipped',
            classifierSource: decision.classifier_source || 'miss',
            reason: decision.reason,
          });
          if (!dryRun) await delay(1500);
          continue;
        }

        // ── 2차: 캐시 조회
        const hash = _hashFor({ id: page.id, title: page.title, body: truncatedBody });
        const cacheResult = _consultDroppedCache(page.id, hash, today, droppedCache);

        // ── 3차: 가치 평가 (캐시 적중 + 재평가 미도래면 skip)
        let verdict;
        let valueReason;
        let valueSource;
        let suggestedFolderId = null;
        let cacheHit = false;
        let reevalDueAt = null;
        let valueError = null;

        if (cacheResult.cached && !cacheResult.reevaluate) {
          verdict = 'dropped';
          valueReason = cacheResult.entry.reason;
          valueSource = 'cache';
          cacheHit = true;
          reevalDueAt = cacheResult.entry.nextReevalAt;
        } else {
          let value;
          try {
            value = await _assessMigrationValue({
              pageId: page.id,
              title: page.title,
              body: truncatedBody,
              classifyHint: {
                folderId: decision.target_folder_id,
                labels: decision.labels || [],
              },
            }, aaTree);
          } catch (e) {
            valueError = e;
            value = { ok: false, verdict: 'create', reason: `llm-error:${e.message}`, source: 'miss' };
          }
          verdict = value.verdict;
          valueReason = value.reason;
          valueSource = value.source;
          suggestedFolderId = value.suggestedFolderId || null;
          reevalDueAt = addDays(today, 7);

          // 분류 실패 + 가치 create → 강제 unclassified
          if (!classificationOk && verdict === 'create') {
            verdict = 'unclassified';
            valueReason = `${valueReason} + chain-fail`;
          }

          // dropped → 캐시 upsert, unclassified/create (재평가) → 캐시에서 제거
          if (verdict === 'dropped') {
            cacheUpdates.push({
              pageId: page.id,
              sourceSpace,
              title: page.title,
              hash,
              reason: valueReason,
              firstSeen: cacheResult.entry ? cacheResult.entry.firstSeen : today,
              lastSeen: today,
              nextReevalAt: reevalDueAt,
            });
          } else if (cacheResult.cached) {
            // unclassified 또는 create로 부활 → 캐시에서 제거
            cacheUpdates.push({ remove: true, pageId: page.id, hash });
          }
        }

        // ── 4차: 분기
        if (verdict === 'dropped') {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: null,
            targetFolderTitle: null,
            status: 'dropped',
            classifierSource: decision.classifier_source,
            reason: valueReason,
            reevalDueAt,
            cacheHit,
          });
          if (!dryRun) await delay(1500);
          continue;
        }

        if (verdict === 'unclassified') {
          // 미분류 폴더에 이관. 폴더를 미분류로 강제 보정.
          decision.target_folder_id = aaTree.unsortedFolderId;
          decision.target_folder_title = '미분류';
          decision.labels = (decision.labels || []).filter(l => l !== 'needs-review');
        }

        // needs_new_category → skip
        if (decision.needs_new_category) {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: null,
            targetFolderTitle: null,
            status: 'skipped',
            classifierSource: decision.classifier_source || 'miss',
            reason: decision.reason,
          });
          if (!dryRun) await delay(1500);
          continue;
        }

        // 멱등성: 동명 페이지 존재 → 동기화, 없으면 생성
        const existing = await _findPageByTitleInAA(srcMeta.title);
        const isSync = !!existing;

        let destId;
        let destTitle;

        if (dryRun) {
          items.push({
            kind: 'migrate-a',
            pageId: page.id,
            title: page.title,
            sourceSpace,
            targetFolderId: decision.target_folder_id,
            targetFolderTitle: decision.target_folder_title || null,
            status: isSync ? 'synced' : 'created',
            classifierSource: decision.classifier_source,
            reason: valueReason || decision.reason,
            ...(isSync ? { destPageId: existing.id } : {}),
            ...(verdict === 'unclassified' && suggestedFolderId ? { suggestedFolderId } : {}),
          });
          continue;
        }

        if (isSync) {
          destId = existing.id;
          destTitle = existing.title;
          try {
            const destMeta = await req('GET', `/wiki/api/v2/pages/${destId}`);
            if (destMeta.parentId && String(destMeta.parentId) !== String(decision.target_folder_id)) {
              // 폴더 이동은 하지 않음 — 내용만 동기화
            }
          } catch { /* 부모 폴더 정보는 부가 정보 */ }
        } else {
          const newPage = await _createPage(targetSpaceId, decision.target_folder_id, srcMeta.title, '<p>복사 중...</p>');
          destId = newPage.id;
          destTitle = newPage.title;
        }

        const { skippedVideos } = await _copyAttachments(page.id, destId);

        const bannerHtml = _buildBanner({
          ruleVersion: globalRuleVersion,
          pageVersion: '1',
          sourceSpaceKey: sourceSpace,
          sourcePageUrl: srcMeta.url,
          sourcePageTitle: srcMeta.title,
          authorDisplayName: srcMeta.authorDisplayName,
          originalCreatedAt: pageDate,
          labels: decision.labels,
        }, skippedVideos);

        let newBody = _fixBodyReferences(srcMeta.body, page.id, destId);
        newBody = bannerHtml + newBody;
        await _updatePageBody(destId, destTitle, newBody);

        if (decision.labels && decision.labels.length > 0) {
          await _addLabels(destId, decision.labels);
        }

        const finalStatus = verdict === 'unclassified' ? 'unclassified' : (isSync ? 'synced' : 'created');
        items.push({
          kind: 'migrate-a',
          pageId: page.id,
          title: page.title,
          sourceSpace,
          targetFolderId: decision.target_folder_id,
          targetFolderTitle: decision.target_folder_title || null,
          status: finalStatus,
          classifierSource: decision.classifier_source,
          reason: valueReason || decision.reason,
          destPageId: destId,
          ...(verdict === 'unclassified' && suggestedFolderId ? { suggestedFolderId } : {}),
        });

      } catch (e) {
        items.push({
          kind: 'migrate-a',
          pageId: page.id,
          title: page.title,
          sourceSpace,
          targetFolderId: null,
          targetFolderTitle: null,
          status: 'failed',
          classifierSource: null,
          reason: null,
          error: e.message,
        });
      }

      if (!dryRun) await delay(1500);
    }
  }

  // 5. dropped 캐시 머지 + 저장 (실실행 시)
  if (!dryRun && cacheUpdates.length > 0) {
    try {
      const merged = _mergeDroppedCache(droppedCache, cacheUpdates);
      await _saveDroppedCache(DROPPED_CACHE_PATH, merged);
    } catch (e) {
      saveError = `save-dropped-cache:${e.message}`;
      console.warn(`⚠️ dropped_pages.json 저장 실패: ${e.message}`);
    }
  }
  if (saveError) {
    return { items, saveError };
  }
  return { items };
}

async function runMigrator() {
  console.log(`🚀 [Migrator] 다중 스페이스 이관 작업을 시작합니다.`);

  // 1. spaces_config.json 로드
  const configPath = path.join(__dirname, '..', 'spaces_config.json');
  if (!fs.existsSync(configPath)) {
    return console.error('❌ spaces_config.json 파일이 없습니다.');
  }
  const spacesConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const activeSpaces = Object.keys(spacesConfig).filter(key => spacesConfig[key].active);

  if (activeSpaces.length === 0) {
    return console.log('⏭️ 활성화된 수집 대상 스페이스가 없습니다.');
  }

  console.log('📡 [1/3] AA 스페이스의 최신 폴더 구조(context_tree)를 수집합니다...');
  const aaTree = await fetchAATree();
  const contextTree = aaTree.toText();
  if (!contextTree) return console.error('❌ 컨텍스트 트리를 가져오지 못해 작업을 중단합니다.');
  console.log('✅ 컨텍스트 트리 수집 완료.\n');

  // AA 스페이스 ID 조회
  let targetSpaceId;
  try {
    const spaces = await confluenceRequest('GET', `/wiki/api/v2/spaces?keys=${AA_SPACE_KEY}`);
    if (spaces && spaces.results && spaces.results.length > 0) {
      targetSpaceId = spaces.results[0].id;
    } else {
      throw new Error('Target space not found');
    }
  } catch (e) {
    return console.error(`❌ 타겟 스페이스(${AA_SPACE_KEY}) ID 조회 실패:`, e.message);
  }

  // 2. 날짜 기반 룩백 기간 계산 (기본: 최근 7일)
  const lookbackDays = spacesConfig.LOOKBACK_DAYS || 7;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - lookbackDays);
  const sinceDateStr = sinceDate.toISOString().split('T')[0]; // 'YYYY-MM-DD'
  console.log(`📅 스캔 기준: 최근 ${lookbackDays}일 (${sinceDateStr} 이후 수정된 문서 대상)`);

  // 3. 활성화된 스페이스 순회 (GLOBAL_RULE_VERSION, LOOKBACK_DAYS 같은 비-스페이스 키 제외)
  const RESERVED_KEYS = ['GLOBAL_RULE_VERSION', 'LOOKBACK_DAYS'];
  const activeSpaceKeys = Object.keys(spacesConfig).filter(
    key => !RESERVED_KEYS.includes(key) && spacesConfig[key].active
  );

  if (activeSpaceKeys.length === 0) {
    return console.log('⏭️ 활성화된 수집 대상 스페이스가 없습니다.');
  }

  // 3. 활성화된 스페이스 순회
  for (const sourceSpace of activeSpaceKeys) {
    console.log(`==================================================`);
    console.log(`📂 대상 스페이스: ${sourceSpace}`);
    console.log(`📡 [2/3] ${sourceSpace} 스페이스에서 ${sinceDateStr} 이후 수정된 문서를 검색합니다...`);

      const cql = encodeURIComponent(`space="${sourceSpace}" AND type="page" AND lastmodified >= "${sinceDateStr}" order by lastmodified desc`);
      const searchUrl = `/wiki/rest/api/content/search?cql=${cql}&limit=200&expand=body.storage`;

      let candidates;
      try {
        const res = await confluenceRequest('GET', searchUrl);
        candidates = res.results || [];
        console.log(`✅ 총 ${candidates.length}개의 후보 문서를 발견했습니다.`);
      } catch (e) {
        console.error(`❌ ${sourceSpace} 후보 문서 검색 실패:`, e.message);
        continue;
      }

      if (candidates.length === 0) continue;

      console.log(`📡 [3/3] 분류 체인 분석 및 이관을 시작합니다...`);
      for (const page of candidates) {
        console.log(`\n--------------------------------------------------`);
        console.log(`📄 분석 중: [${page.title}] (ID: ${page.id})`);

        const pageBody = page.body?.storage?.value || '';
        const truncatedBody = pageBody.substring(0, 20000);

        try {
          console.log(`✨ [진행 중] 원본 페이지 메타데이터 및 날짜 조회 중...`);
          const srcMeta = await fetchPageDetail(page.id);
          const pageDate = srcMeta.createdAt ? srcMeta.createdAt.substring(0, 10) : '';

          // ClassifierChain 결과는 { ok, source, folderId, folderTitle, labels, reason } 모양.
          // 하위 호환을 위해 기존 호출자 모양으로 정규화 (lines 108-120 그대로 동작).
          const existingLabels = await fetchPageLabels(page.id);
          const chainResult = await classifyWithChain({
            pageId: page.id,
            title: page.title,
            body: truncatedBody,
            ancestors: [],
            sourceSpace,
            sourceUrl: page._links?.webui || '',
            pageDate,
            existingLabels,
          }, aaTree);

          const decision = chainResult.ok ? {
            is_valid: true,
            target_folder_id: chainResult.folderId,
            target_folder_title: chainResult.folderTitle,
            needs_new_category: false,
            suggested_new_folder: null,
            reason: chainResult.reason,
            labels: chainResult.labels,
            classifier_source: chainResult.source,
          } : {
            is_valid: false,
            target_folder_id: null,
            needs_new_category: false,
            reason: chainResult.reason || 'no-classifier-matched',
          };

        console.log(`🤖 Chain 판단[${decision.classifier_source || 'miss'}]: 유효성(${decision.is_valid}) | 목적지(${decision.target_folder_id})`);

        if (decision.needs_new_category) {
          console.log(`🚨 [예외] 적절한 폴더가 없습니다! 제안: ${decision.suggested_new_folder} / 사유: ${decision.reason}`);
          continue;
        }

        if (!decision.is_valid || !decision.target_folder_id) {
          console.log(`⏭️ [스킵] 유효하지 않거나 타겟 폴더가 없습니다.`);
          continue;
        }

        // 멱등성 보장: AA에 동명 페이지가 이미 있으면(이전 이관분) 새로 만들지 않고
        // 제자리 덮어쓰기 동기화(본문·배너·첨부·라벨 갱신). 폴더 이동은 하지 않는다 —
        // 재배치는 audit/reorganize(루프 B)의 책임이며, 분류기 판단 변동으로 기존 페이지를
        // 옮기면 루프 B의 휴먼 이동 학습이 오염될 수 있다.
        const existing = await findPageByTitleInAA(srcMeta.title);
        const isSync = !!existing;
        const stepTag = isSync ? '동기화 진행' : '복사 진행';

        let destId;
        let destTitle;
        let destRef;

        if (isSync) {
          destId = existing.id;
          destTitle = existing.title;
          destRef = `"${existing.title}" (AA 페이지 id=${existing.id})`;
          console.log(`🔄 [동기화] AA에 동명 페이지 존재 (id=${destId}) — 새 내용으로 제자리 덮어쓰기.`);
          // 현재 폴더가 체인 판단과 다르면 로그만 남기고 이동하지 않음(선택적 조회, 실패 무시).
          try {
            const destMeta = await confluenceRequest('GET', `/wiki/api/v2/pages/${destId}`);
            if (destMeta.parentId && String(destMeta.parentId) !== String(decision.target_folder_id)) {
              console.log(`ℹ️ [동기화] 현재 폴더(${destMeta.parentId}) ≠ 체인 판단(${decision.target_folder_id}) — 내용만 동기화하고 이동하지 않습니다.`);
            }
          } catch (_) { /* 부모 폴더 정보는 부가 정보일 뿐 */ }
        } else {
          console.log(`✨ [복사 진행] 새 페이지 껍데기 생성 중...`);
          const newPage = await createPage(targetSpaceId, decision.target_folder_id, srcMeta.title, '<p>복사 중...</p>');
          destId = newPage.id;
          destTitle = newPage.title;
          destRef = newPage.webUrl;
        }

        console.log(`✨ [${stepTag}] 첨부파일 복사 중...`);
        const { skippedVideos } = await copyAttachments(page.id, destId);

        const config = require('../spaces_config.json');
        const globalRuleVersion = config.GLOBAL_RULE_VERSION || '1.0';

        console.log(`✨ [${stepTag}] 본문 변환 및 배너 삽입 중...`);
        const bannerHtml = buildBanner({
          ruleVersion: globalRuleVersion,
          pageVersion: '1',
          sourceSpaceKey: sourceSpace,
          sourcePageUrl: srcMeta.url,
          sourcePageTitle: srcMeta.title,
          authorDisplayName: srcMeta.authorDisplayName,
          originalCreatedAt: pageDate,
          labels: decision.labels
        }, skippedVideos);

        let newBody = fixBodyReferences(srcMeta.body, page.id, destId);
        newBody = bannerHtml + newBody;
        await updatePageBody(destId, destTitle, newBody);

        console.log(`✨ [${stepTag}] 레이블 부착 중...`);
        if (decision.labels && decision.labels.length > 0) {
          await addLabels(destId, decision.labels);
        }

        console.log(`✅ ${isSync ? '동기화' : '이관'} 성공: ${destRef}`);
      } catch (e) {
        console.error(`❌ [오류] '${page.title}' 처리 중 에러 발생:`, e.message);
      }

      await delay(1500);
    }
  }

  console.log(`\n🎉 [Migrator] 모든 작업이 완료되었습니다!`);
}

if (require.main === module) {
  runMigrator();
}

module.exports = { runMigrator, runMigrate, findPageByTitleInAA, cqlEscape };
