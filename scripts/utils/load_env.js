'use strict';
// .env 로더 — dotenvx 시크릿 분류 문제 회피.
// dotenvx가 ANTHROPIC_API_KEY, CONFLUENCE_TOKEN 등을 시크릿으로 분류해
// process.env에 주입하지 않는 문제를 해결하기 위해 .env를 직접 파싱한다.
// require('./utils/load_env') 한 줄로 호출.

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '..', '.env');

function loadEnv() {
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (_) {
    // .env 없으면 무시
  }
}

// 즉시 실행
loadEnv();

module.exports = { loadEnv };
