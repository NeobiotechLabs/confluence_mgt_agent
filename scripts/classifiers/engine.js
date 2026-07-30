// scripts/classifiers/engine.js
// 분류 체인 호환 엔트리포인트. 신규 scripts/utils/classification_provider.js에 위임.
// 호출자(migrator.js, reorganize_aa_space.js, audit_aa_space.js)는 classifyWithChain(ctx, aaTree) 형태로
// 계속 호출 가능하며 내부적으로는 rule → inline-llm(Anthropic SDK) → fallback 체인을 사용한다.
// Dify / human-classifier 단계는 정책상 제거.
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { classifyPage } = require('../utils/classification_provider');
const { ruleClassifier } = require('./rule');
const { humanClassifier } = require('./human');
const { callLLM } = require('../utils/llm_api');

async function classifyWithChain(ctx, aaTree, deps) {
  const llm = deps?.llm || {
    callLLM: async ({ ctx: c, aaTree: t }) =>
      callLLM({
        client: deps?.anthropicClient || (() => {
          // 실제 호출은 migrator/audit 의존성 주입 경로에서만.
          // 환경에 키가 있고 client가 없으면 즉시 miss로 처리하여 per-page catch 호환.
          return null;
        })(),
        system: deps?.buildPrompt ? deps.buildPrompt(c, t) : '',
        user: c?.title || '',
        tools: deps?.tools || [{ name: 'select_folder' }],
      }),
  };
  return classifyPage(ctx, aaTree, { humanClassifier, ruleClassifier, llm });
}

module.exports = { classifyWithChain };
