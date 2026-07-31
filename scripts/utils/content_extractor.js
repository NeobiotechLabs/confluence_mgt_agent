'use strict';
// Confluence storage format HTML → LLM 분류 입력용 평문 본문.
// 순수 함수 — 네트워크/디스크 의존 없음.
// info 매크로(이관 배너)는 메타데이터 잡음이므로 본문에서 제외한다.
// code 등 그 외 매크로의 텍스트 내용(CDATA 포함)은 본문 신호로 보존한다.

const DEFAULT_MAX_CHARS = 2000;

const INFO_MACRO_RE = /<ac:structured-macro\b[^>]*\bac:name="info"[^>]*>[\s\S]*?<\/ac:structured-macro>/gi;

const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};
const ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g;

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY_RE, (m) => ENTITY_MAP[m])
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateContent(text, maxChars = DEFAULT_MAX_CHARS) {
  if (!text || typeof text !== 'string') return '';
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function extractBodyText(storageHtml, maxChars = DEFAULT_MAX_CHARS) {
  if (!storageHtml || typeof storageHtml !== 'string') return '';
  return truncateContent(stripHtml(storageHtml.replace(INFO_MACRO_RE, ' ')), maxChars);
}

module.exports = { stripHtml, truncateContent, extractBodyText, DEFAULT_MAX_CHARS };
