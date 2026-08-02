#!/usr/bin/env node
'use strict';
// 운영 CLI: reference/dropped_pages.json 테이블 형식 출력.
const path = require('path');
const { loadDroppedCache } = require('./migrator/dropped_cache');

const FILE = path.join(__dirname, '..', 'reference', 'dropped_pages.json');
const items = loadDroppedCache(FILE);
if (items.length === 0) {
  console.log('(no dropped entries)');
  process.exit(0);
}
console.log('| pageId | sourceSpace | title | reason | firstSeen | lastSeen | nextReevalAt |');
console.log('|---|---|---|---|---|---|---|');
for (const it of items) {
  console.log(`| ${it.pageId} | ${it.sourceSpace || ''} | ${(it.title || '').replace(/\|/g, '\\|')} | ${(it.reason || '').replace(/\|/g, '\\|')} | ${it.firstSeen || ''} | ${it.lastSeen || ''} | ${it.nextReevalAt || ''} |`);
}
