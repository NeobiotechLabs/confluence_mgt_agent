// scripts/check_llm_env.js
// 현재 .env 기반 LLM(Anthropic SDK) 연결 점검. Confluence 호출 일체 없음.
// 분류기가 실제로 호출하는 모델(코드 고정)과 .env의 ANTHROPIC_MODEL 을 각각 ping 한다.
// 사용: npm run check:llm
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// 분류 체인 3단계가 실제 호출하는 모델(claude.js 에서 해석된 값)을 그대로 가져온다.
const { claudeClassifier, MODEL: CLASSIFIER_MODEL } = require('./classifiers/claude');

const mask = (v) => (v ? `${v.slice(0, 4)}… (${v.length} chars)` : '(unset)');

async function ping(client, model) {
  const t0 = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with only one word: pong' }],
  });
  const ms = Date.now() - t0;
  const text = (msg.content || []).map(b => (b.type === 'text' ? b.text : `[${b.type}]`)).join(' ').trim();
  return { ms, text, usage: msg.usage, resolvedModel: msg.model };
}

async function main() {
  console.log('=== LLM env check (no Confluence calls) ===');
  console.log(`CONFLUENCE_EMAIL   : ${process.env.CONFLUENCE_EMAIL ? 'SET' : '(unset)'}`);
  console.log(`CONFLUENCE_TOKEN   : ${process.env.CONFLUENCE_TOKEN ? 'SET' : '(unset)'}`);
  console.log(`ANTHROPIC_API_KEY  : ${mask(process.env.ANTHROPIC_API_KEY)}`);
  console.log(`ANTHROPIC_BASE_URL : ${process.env.ANTHROPIC_BASE_URL || '(unset → SDK default api.anthropic.com)'}`);
  console.log(`ANTHROPIC_MODEL    : ${process.env.ANTHROPIC_MODEL || '(unset)'}`);
  if (process.env.CI) console.warn('⚠️ CI 가 설정되어 있음 — 로컬에서는 해제 권장 (결정 로그 기록 스킵됨)');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nLLM check skipped: ANTHROPIC_API_KEY 미설정 → 분류기는 rule-only 모드로 동작합니다. (정상)');
    process.exitCode = 0;
    return;
  }

  // baseURL 는 SDK 가 ANTHROPIC_BASE_URL 로부터 자동 판독 — claude.js 와 동일한 생성 방식.
  const { Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const targets = [{ model: CLASSIFIER_MODEL, label: 'classifier-actual' }];
  if (process.env.ANTHROPIC_MODEL && process.env.ANTHROPIC_MODEL !== CLASSIFIER_MODEL) {
    targets.push({ model: process.env.ANTHROPIC_MODEL, label: 'env-ANTHROPIC_MODEL' });
  }

  let failed = 0;
  for (const { model, label } of targets) {
    try {
      const r = await ping(client, model);
      console.log(`\n✅ [${label}] 요청 model=${model} 응답 model=${r.resolvedModel} ${r.ms}ms usage=${JSON.stringify(r.usage)}`);
      console.log(`   reply: ${r.text.slice(0, 120)}`);
    } catch (e) {
      failed++;
      console.error(`\n❌ [${label}] model=${model} — ${e.name}: ${e.message}`);
    }
  }

  // 분류기 실제 경로(claude.js, tool_use) 스모크 — 가상 AA tree 사용, Confluence 호출 없음.
  if (failed === 0) {
    try {
      const fakeTree = {
        toText: () => '- folder-spec: 연구소 규정 (id=folder-spec)\n- folder-meeting: 회의록 (id=folder-meeting)',
        hasFolder: (id) => ['folder-spec', 'folder-meeting'].includes(id),
        flat: [
          { id: 'folder-spec', title: '연구소 규정' },
          { id: 'folder-meeting', title: '회의록' },
        ],
      };
      const d = await claudeClassifier.classify(
        { pageId: 'smoke', title: '연구실 안전 관리 규정 v2', body: '', sourceSpace: 'SD', sourceUrl: '', pageDate: '2025-11-02', existingLabels: [] },
        fakeTree
      );
      if (d.ok && d.source === 'claude') {
        console.log(`\n✅ [classifier-smoke] source=${d.source} folder=${d.folderTitle}(${d.folderId}) reason="${d.reason}"`);
      } else {
        failed++;
        console.error(`\n❌ [classifier-smoke] 결정 실패: ${JSON.stringify(d)} — 모델이 tool_use(select_folder)로 응답하지 않았을 수 있음`);
      }
    } catch (e) {
      failed++;
      console.error(`\n❌ [classifier-smoke] ${e.name}: ${e.message}`);
    }
  }

  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error(e); process.exit(1); });
