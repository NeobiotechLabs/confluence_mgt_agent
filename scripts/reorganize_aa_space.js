// scripts/reorganize_aa_space.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { confluenceRequest } = require('./utils/confluence_api');
const { fetchAATree, fetchAASpaceHomepageId } = require('./utils/aa_space_tree');
const { classifyWithChain } = require('./classifiers/engine');
const { movePage } = require('./utils/migration_utils');

const DRY_RUN = process.argv.includes('--dry-run');

async function listAAPages() {
  let cursor = null;
  const all = [];
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await confluenceRequest('GET', `/wiki/api/v2/pages?${params}`);
    for (const p of (res.results || [])) {
      const labels = await fetchLabels(p.id);
      all.push({ id: p.id, title: p.title, parentId: p.parentId, labels });
    }
    cursor = res._links?.next;
  } while (cursor);
  return all;
}

async function fetchLabels(pageId) {
  try {
    const res = await confluenceRequest('GET', `/wiki/rest/api/content/${pageId}/label?limit=50`);
    return (res.results || []).map(l => l.name);
  } catch { return []; }
}

async function fetchAncestors(pageId, byId) {
  const ancestors = [];
  let current = byId.get(pageId)?.parentId;
  let depth = 0;
  while (current && depth < 10) {
    const parent = byId.get(current);
    if (!parent) break;
    ancestors.unshift(parent.title);
    current = parent.parentId;
    depth++;
  }
  return ancestors;
}

async function main() {
  console.log(`=== Reorganize AA Space (${DRY_RUN ? 'DRY-RUN' : 'EXEC'}) ===`);
  const aaTree = await fetchAATree();
  const homePageId = await fetchAASpaceHomepageId('AA');
  const pages = await listAAPages();
  const byId = new Map(pages.map(p => [p.id, p]));

  let moved = 0;
  for (const p of pages) {
    // Skip folders themselves
    if (p.labels.includes('is-folder')) continue;
    // Skip if already in valid folder (heuristic: not at top level)
    if (p.parentId && !isAtTopLevel(p, homePageId)) continue;

    const ancestors = await fetchAncestors(p.id, byId);
    const ctx = {
      pageId: p.id, title: p.title, body: '',
      ancestors, sourceSpace: 'AA', sourceUrl: '',
      pageDate: '', existingLabels: p.labels,
    };
    const decision = await classifyWithChain(ctx, aaTree);
    if (!decision.ok || decision.folderId === p.parentId) continue;

    if (DRY_RUN) {
      console.log(`[DRY] ${p.title}: ${p.parentId || 'top'} → ${decision.folderId} (source: ${decision.source})`);
    } else {
      try {
        await movePage(p.id, decision.folderId);
        console.log(`✅ ${p.title}: ${p.parentId || 'top'} → ${decision.folderId} (source: ${decision.source})`);
        moved++;
      } catch (e) {
        console.warn(`⚠️ ${p.title} move failed: ${e.message}`);
      }
    }
  }
  console.log(`\n${DRY_RUN ? '[DRY] would move' : 'Moved'}: ${moved} pages`);
}

function isAtTopLevel(page, homePageId) {
  if (!homePageId) return !page.parentId;
  return page.parentId === homePageId;
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}