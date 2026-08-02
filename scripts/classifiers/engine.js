// scripts/classifiers/engine.js
// 분류 체인 호환 엔트리포인트. classifyWithChain(ctx, aaTree, deps) 시그니처 유지.
// 내부 체인: human → structural → inline-llm(본문) → fallback(미분류+의견).
// 2026-07-31 재설계: ANTHROPIC_API_KEY가 있으면 실 client를 지연 생성해 LLM 단계를 실제로 구동.
'use strict';
require('../utils/load_env');
const { classifyPage } = require('../utils/classification_provider');
const { humanClassifier } = require('./human');
const { callLLMForClassification } = require('../utils/llm_api');
const { loadGuidelines } = require('../utils/classification_prompt');

let sharedClient;
let sharedClientInit = false;

// 프로세스당 1회만 SDK 로딩·생성. 키 없으면 null (provider가 단계 자체를 skip).
function defaultClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!sharedClientInit) {
    sharedClientInit = true;
    try {
      const { Anthropic } = require('@anthropic-ai/sdk');
      sharedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch (e) {
      console.warn(`⚠️ Anthropic SDK 생성 실패 (${e.message}) — LLM 단계 skip`);
      sharedClient = null;
    }
  }
  return sharedClient;
}

async function classifyWithChain(ctx, aaTree, deps) {
  const llm = deps?.llm || {
    callLLM: async ({ ctx: c, aaTree: t }) =>
      callLLMForClassification({
        client: deps?.anthropicClient !== undefined ? deps.anthropicClient : defaultClient(),
        title: c?.title || '',
        body: c?.body || '', // storage HTML 가능 — 추출·절단은 callLLMForClassification 내부
        treeText: t && typeof t.toText === 'function' ? t.toText() : '',
        guidelines: deps?.guidelines !== undefined ? deps.guidelines : loadGuidelines(),
        ...(deps?.model ? { model: deps.model } : {}),
      }),
  };
  return classifyPage(ctx, aaTree, { humanClassifier, llm });
}

module.exports = { classifyWithChain };
