// scripts/classifiers/human.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');

const DECISIONS_PATH = path.join(__dirname, '..', '..', 'config', 'classification_decisions.json');

let cache = null;
let cacheMtime = 0;

function loadDecisions() {
  const stat = fs.statSync(DECISIONS_PATH);
  if (cache && stat.mtimeMs === cacheMtime) return cache;
  const data = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  cache = data.decisions || [];
  cacheMtime = stat.mtimeMs;
  return cache;
}

const SOURCE_PRIORITY = {
  'human-ui-move': 0,
  'manual-script': 1,
  'rule-promoted': 2,
};

function sortByPriority(decisions) {
  return [...decisions].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    if (pa !== pb) return pa - pb;
    return (b.decidedAt || '').localeCompare(a.decidedAt || '');
  });
}

function matches(match, ctx) {
  if (!match) return false;
  if (match.titleRegex) {
    try { if (!new RegExp(match.titleRegex, 'i').test(ctx.title)) return false; }
    catch { return false; }
  }
  if (match.ancestorContains) {
    const hay = (ctx.ancestors || []).join(' > ');
    if (!hay.includes(match.ancestorContains)) return false;
  }
  if (match.sourceSpace) {
    if (match.sourceSpace !== ctx.sourceSpace) return false;
  }
  if (match.labels && match.labels.length > 0) {
    const has = match.labels.some(l => (ctx.existingLabels || []).includes(l));
    if (!has) return false;
  }
  return true;
}

async function classify(ctx, aaTree) {
  const decisions = sortByPriority(loadDecisions());
  for (const d of decisions) {
    if (matches(d.match, ctx)) {
      return {
        ok: true,
        source: 'human',
        folderId: d.targetFolderId,
        folderTitle: d.targetFolderTitle,
        labels: d.labels || [],
        reason: d.id,
      };
    }
  }
  return { ok: false, source: 'miss' };
}

const humanClassifier = { name: 'human', classify };

module.exports = { humanClassifier, classify, loadDecisions, sortByPriority, matches };