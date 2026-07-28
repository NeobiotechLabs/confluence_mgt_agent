'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { confluenceRequest, fetchAASpaceTreeText } = require('./utils/confluence_api');
const { fetchAATree } = require('./utils/aa_space_tree');
const { classifyWithChain } = require('./classifiers/engine');

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
  const contextTree = await fetchAASpaceTreeText();
  if (!contextTree) return console.error('❌ 컨텍스트 트리를 가져오지 못해 작업을 중단합니다.');

  // ClassifierChain용 트리 객체도 함께 로드 (chain은 folders 배열/트리 메타를 필요로 함)
  const aaTree = await fetchAATree();
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

      console.log(`📡 [3/3] Dify LLM 분석 및 이관을 시작합니다...`);
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
          // 하위 호환을 위해 Dify-like 모양으로 브릿지 (lines 108-120 그대로 동작).
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
        
        console.log(`✨ [복사 진행] 새 페이지 껍데기 생성 중...`);
        const newPage = await createPage(targetSpaceId, decision.target_folder_id, srcMeta.title, '<p>복사 중...</p>');
        
        console.log(`✨ [복사 진행] 첨부파일 복사 중...`);
        const { skippedVideos } = await copyAttachments(page.id, newPage.id);

        const config = require('../spaces_config.json');
        const globalRuleVersion = config.GLOBAL_RULE_VERSION || '1.0';

        console.log(`✨ [복사 진행] 본문 변환 및 배너 삽입 중...`);
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

        let newBody = fixBodyReferences(srcMeta.body, page.id, newPage.id);
        newBody = bannerHtml + newBody;
        await updatePageBody(newPage.id, newPage.title, newBody);

        console.log(`✨ [복사 진행] 레이블 부착 중...`);
        if (decision.labels && decision.labels.length > 0) {
          await addLabels(newPage.id, decision.labels);
        }

        console.log(`✅ 이관 성공: ${newPage.webUrl}`);
      } catch (e) {
        console.error(`❌ [오류] '${page.title}' 처리 중 에러 발생:`, e.message);
      }
      
      await delay(1500);
    }
  }
  
  console.log(`\n🎉 [Migrator] 모든 작업이 완료되었습니다!`);
}

runMigrator();
