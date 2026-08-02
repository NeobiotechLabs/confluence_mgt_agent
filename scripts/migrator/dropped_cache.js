// scripts/migrator/dropped_cache.js
'use strict';
// reference/dropped_pages.json SSOT — 이관 탈락(dropped) 페이지 캐시.
// unmatched_state_io와 같은 패턴: 부재/깨짐 graceful, 원자적 쓰기.
// 추가 책임: consult (캐시 적중 + 7일 재평가 게이트), merge (upsert/remove), hash.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * reference/dropped_pages.json SSOT 로더. 부재/깨짐/스키마 위반은 모두 []로 우아 퇴화.
 * @param {string} file
 * @returns {Array<{pageId, sourceSpace?, title?, hash, reason?, firstSeen?, lastSeen?, nextReevalAt?}>}
 */
function loadDroppedCache(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  let parsed;
  try { parsed = JSON.parse(txt); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(it => it && typeof it.pageId === 'string');
}

/**
 * 원자적 쓰기. 부모 디렉터리 자동 생성. .tmp → rename.
 * @param {string} file
 * @param {Array} items
 */
function saveDroppedCache(file, items) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 재평가 도래 여부. nextReevalAt <= today → true.
 * @param {{nextReevalAt?: string}} entry
 * @param {string} today  YYYY-MM-DD
 */
function shouldReevaluate(entry, today) {
  if (!entry || !entry.nextReevalAt) return true; // 안전: 방어적
  return entry.nextReevalAt <= today;
}

/**
 * 캐시 조회.
 * @returns {{cached: boolean, reevaluate: boolean, entry?: Object}}
 */
function consultDroppedCache(pageId, hash, today, cache) {
  const entry = cache.find(it => it.pageId === pageId && it.hash === hash);
  if (!entry) return { cached: false, reevaluate: false };
  const reevaluate = shouldReevaluate(entry, today);
  return { cached: true, reevaluate, entry };
}

/**
 * 캐시 머지. update 항목이 {remove:true}면 제거, 아니면 upsert.
 * @param {Array} cache
 * @param {Array} updates
 * @returns {Array} 새 배열 (입력 mutate 안 함)
 */
function mergeDroppedCache(cache, updates) {
  const out = cache.slice();
  for (const u of updates) {
    if (u.remove) {
      const idx = out.findIndex(it => it.pageId === u.pageId && it.hash === u.hash);
      if (idx >= 0) out.splice(idx, 1);
      continue;
    }
    const idx = out.findIndex(it => it.pageId === u.pageId && it.hash === u.hash);
    if (idx >= 0) {
      out[idx] = { ...out[idx], ...u, firstSeen: out[idx].firstSeen || u.firstSeen };
    } else {
      out.push(u);
    }
  }
  return out;
}

/**
 * 페이지 해시. pageId + 본문 길이 + 본문 앞 200자 → sha1 → 16자 hex.
 * 본문이 바뀌면 hash가 바뀌어 재평가 트리거.
 * @param {{id: string, title?: string, body?: string}} page
 * @returns {string}
 */
function hashFor(page) {
  const id = page && page.id ? String(page.id) : '';
  const body = page && page.body ? String(page.body) : '';
  const head = body.substring(0, 200);
  return crypto.createHash('sha1').update(`${id}|${body.length}|${head}`).digest('hex').substring(0, 16);
}

module.exports = {
  loadDroppedCache,
  saveDroppedCache,
  shouldReevaluate,
  consultDroppedCache,
  mergeDroppedCache,
  hashFor,
};
