// scripts/report/unmatched_state_io.js
'use strict';
const fs = require('fs');

/**
 * reference/unmatched_pages.json SSOT 로더.
 * - 파일 부재/깨짐/스키마 위반은 모두 []로 우아 퇴화(리포트 실패 방지).
 * - 절대 throw 하지 않는다.
 * @param {string} file
 * @returns {Array<{fingerprint:string, title?:string, seenCount?:number, firstSeen?:string, lastSeen?:string, sourceSpace?:string}>}
 */
function loadUnmatchedState(file) {
  let txt;
  try {
    txt = fs.readFileSync(file, 'utf8');
  } catch { return []; }
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  // fingerprint 없는 항목은 무시(스키마 위반 → 빈 상태와 동등 처리)
  return parsed.filter(it => it && typeof it.fingerprint === 'string');
}

/**
 * 원자적 덮어쓰기. 부모 디렉터리 자동 생성. 호출자가 명시한 경로에만 쓴다.
 * @param {string} file
 * @param {Array} items
 */
function saveUnmatchedState(file, items) {
  const dir = require('path').dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // .tmp → rename: 부분 쓰기 방지. fsync는 Node가 close 시 보장.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { loadUnmatchedState, saveUnmatchedState };
