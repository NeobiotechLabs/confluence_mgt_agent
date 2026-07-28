// scripts/classifiers/rule.js
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');

const ANALYSIS_RULES_PATH = path.join(__dirname, '..', '..', 'config', 'analysis_rules.json');

let cachedRules = null;
function loadRules() {
  if (cachedRules) return cachedRules;
  cachedRules = JSON.parse(fs.readFileSync(ANALYSIS_RULES_PATH, 'utf8'));
  return cachedRules;
}

function regexFromPattern(p, flags = 'i') {
  try { return new RegExp(p, flags); } catch { return null; }
}

function matchesCategory(category, ctx) {
  const { title, ancestors, ancestorStr } = ctx;
  if (category.is_catch_all) return true;
  const m = category.match || {};
  const groups = m.any ? [{ any: m.any }] : [m];
  for (const g of groups) {
    const anyList = g.any || [g];
    if (anyList.length === 0) continue;
    const hit = anyList.some((rule) => {
      if (rule.title_patterns) {
        const regs = rule.title_patterns.map((p) => regexFromPattern(p)).filter(Boolean);
        if (regs.some(r => r.test(title))) return true;
      }
      if (rule.ancestor_contains) {
        if (ancestorStr.includes(rule.ancestor_contains)) return true;
      }
      return false;
    });
    if (!hit) return false;
  }
  if (category.exclude) {
    const exList = category.exclude.title_patterns || [];
    const regs = exList.map((p) => regexFromPattern(p)).filter(Boolean);
    if (regs.some(r => r.test(title))) return false;
  }
  return true;
}

function buildCategory(category, ctx) {
  const f = category.fields || {};
  const vars = { year: ctx.year, title: ctx.title, doctype: '' };
  const out = {
    category: category.name,
    subCategory: category.is_catch_all ? '분류 보류 (휴먼 큐)' : '',
    labels: [],
    reason: category.id,
    isCatchAll: !!category.is_catch_all,
  };
  if (!category.is_catch_all) {
    if (f.subCategory) out.subCategory = f.subCategory;
    else if (f.subCategory_annual && regexFromPattern('연간').test(ctx.title)) out.subCategory = f.subCategory_annual;
    else if (f.subCategory_periodic_template) out.subCategory = applyTemplate(f.subCategory_periodic_template, vars);
    else if (f.subCategory_template) out.subCategory = applyTemplate(f.subCategory_template, vars);
    else out.subCategory = '기타';
  }
  if (f.doctype_map) {
    for (const [key, label] of Object.entries(f.doctype_map)) {
      if (key === 'default') continue;
      if (regexFromPattern(key).test(ctx.title)) { out.doctype = label; vars.doctype = label; break; }
    }
    if (!out.doctype) out.doctype = f.doctype_map.default || '';
  }
  if (f.labels_template) {
    out.labels = applyTemplate(f.labels_template, vars).filter(Boolean);
  }
  return out;
}

function applyTemplate(tpl, vars) {
  if (Array.isArray(tpl)) return tpl.map(s => applyTemplate(s, vars)).filter(Boolean);
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

async function classify(ctx, aaTree) {
  const rules = loadRules();
  const categories = rules.categories || [];
  const global = rules.global || {};
  const cutoffDate = new Date((global.cutoff_date || '2024-01-01') + 'T00:00:00Z');
  const ancestors = ctx.ancestors || [];
  const ancestorStr = ancestors.join(' > ');
  const year = (ctx.pageDate || '').substring(0, 4);

  // 글로벌 제외
  const ex = global.exclude_patterns || {};
  if (regexFromPattern(ex.archived_prefix || '^Archived\\s')?.test(ctx.title)) return { ok: false, source: 'miss' };
  if (regexFromPattern(ex.daily_scrum || 'Daily Scrum', 'i')?.test(ctx.title)) return { ok: false, source: 'miss' };
  if (regexFromPattern(ex.weekly_date_record || '^\\d{4}-\\d{2}-\\d{2}')?.test(ctx.title)) return { ok: false, source: 'miss' };
  const date = new Date(ctx.pageDate);
  if (!isNaN(date.getTime()) && date < cutoffDate) return { ok: false, source: 'miss' };

  for (const cat of categories) {
    if (matchesCategory(cat, { title: ctx.title, ancestors, ancestorStr, year })) {
      const matched = buildCategory(cat, { title: ctx.title, ancestors, ancestorStr, year });
      const folderId = resolveFolderId(matched.category, aaTree);
      if (!folderId) continue;
      return {
        ok: true,
        source: 'rule',
        folderId,
        folderTitle: matched.category,
        labels: matched.labels || [],
        reason: matched.id || matched.category,
      };
    }
  }
  return { ok: false, source: 'miss' };
}

function resolveFolderId(categoryName, aaTree) {
  // 카테고리명 → aaTree.flat 의 제목 매칭
  const folder = aaTree.flat.find(f => f.title === categoryName);
  return folder?.id || null;
}

const ruleClassifier = { name: 'rule', classify };

module.exports = { ruleClassifier, classify };