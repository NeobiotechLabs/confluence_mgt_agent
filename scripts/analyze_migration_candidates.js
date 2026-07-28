/**
 * analyze_migration_candidates.js (룰 기반)
 *
 * 목적: scripts/result_json/{space}_v2_p*.json 스냅샷을 분석하여
 *       AA 스페이스 이관 후보 페이지 목록을 추출합니다.
 *
 * - 하드코딩 0. 모든 분류 룰은 config/analysis_rules.json 에서 로드.
 * - 스페이스 활성 여부는 spaces_config.json 에서 로드.
 * - 결과는 reference/migration_candidates.md 에 저장.
 *
 * 실행:
 *   node scripts/analyze_migration_candidates.js
 *   npm run analyze:candidates
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── 설정 로드 (하드코딩 없음) ────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..');
const SPACES_CONFIG_PATH = path.join(REPO_ROOT, 'spaces_config.json');
const ANALYSIS_RULES_PATH = path.join(REPO_ROOT, 'config', 'analysis_rules.json');
const RESULT_PATH = path.join(__dirname, 'result_json');
const OUTPUT_FILE = path.join(REPO_ROOT, 'reference', 'migration_candidates.md');

const RESERVED_KEYS = ['GLOBAL_RULE_VERSION', 'LOOKBACK_DAYS'];

function loadConfig() {
  const spaces = JSON.parse(fs.readFileSync(SPACES_CONFIG_PATH, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(ANALYSIS_RULES_PATH, 'utf8'));
  return { spaces, rules };
}

function getActiveSpaces(spaces) {
  return Object.keys(spaces).filter(
    (k) => !RESERVED_KEYS.includes(k) && spaces[k] && spaces[k].active
  );
}

// ─── 글로벌 제외 룰 ──────────────────────────────────────────────────────────

function buildExcludeMatchers(globalRules) {
  const ex = globalRules.exclude_patterns || {};
  return {
    archived: (title) => new RegExp(ex.archived_prefix || '^Archived\\s').test(title),
    dailyScrum: (title) => new RegExp(ex.daily_scrum || 'Daily Scrum', 'i').test(title),
    weeklyDate: (title) => new RegExp(ex.weekly_date_record || '^\\d{4}-\\d{2}-\\d{2}\\s*[~\\-]\\s*\\d{4}-\\d{2}').test(title.trim()),
  };
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function regexFromPattern(p, flags = 'i') {
  try { return new RegExp(p, flags); } catch { return null; }
}

function getAncestorTitles(page, pageMap) {
  const ancestors = [];
  let current = page;
  let depth = 0;
  while (current.parentId && depth < 10) {
    const parent = pageMap.get(current.parentId);
    if (!parent) break;
    ancestors.unshift(parent.title);
    current = parent;
  }
  return ancestors;
}

function detectYearFromTitleOrDate(title, date, yearRegex) {
  const m = title.match(new RegExp(yearRegex));
  if (m) return parseInt(m[1], 10);
  return date.getFullYear();
}

function detectTeamFromTitleAndAncestors(title, ancestors, teamMap) {
  const all = [title, ...ancestors].join(' ');
  for (const [key, label] of Object.entries(teamMap)) {
    if (key === 'default') continue;
    if (regexFromPattern(key) && regexFromPattern(key).test(all)) return label;
  }
  return teamMap.default || 'group-center';
}

function resolveDoctype(title, doctypeMap) {
  for (const [key, label] of Object.entries(doctypeMap)) {
    if (key === 'default') continue;
    if (regexFromPattern(key) && regexFromPattern(key).test(title)) return label;
  }
  return doctypeMap.default || 'doctype-mps-monthly';
}

function resolvePhase(title, phaseMap) {
  for (const [key, label] of Object.entries(phaseMap)) {
    if (key === 'default') continue;
    if (regexFromPattern(key) && regexFromPattern(key).test(title)) return label;
  }
  return phaseMap.default || 'status-active';
}

function applyTemplate(tpl, vars) {
  if (Array.isArray(tpl)) {
    return tpl.map((s) => applyTemplate(s, vars)).filter(Boolean);
  }
  // 정의되지 않은 변수는 제거 (예: gate-{gate} → 빈 값)
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : ''));
}

// ─── 매칭 엔진 ──────────────────────────────────────────────────────────────

function matchesCategory(category, ctx) {
  const { title, ancestors, ancestorStr } = ctx;
  // catch_all: 항상 매칭 (포용적 수집의 fallback)
  if (category.is_catch_all) return true;
  const m = category.match || {};

  // any / all 분기
  const groups = m.any ? [{ any: m.any }] : [m];
  for (const g of groups) {
    const anyList = g.any || [g];
    if (anyList.length === 0) continue;
    const hit = anyList.some((rule) => {
      if (rule.title_patterns) {
        const regs = rule.title_patterns.map((p) => regexFromPattern(p)).filter(Boolean);
        if (regs.some((r) => r.test(title))) return true;
      }
      if (rule.ancestor_contains) {
        if (ancestorStr.includes(rule.ancestor_contains)) return true;
      }
      return false;
    });
    if (!hit) return false;
  }

  // exclude
  if (category.exclude) {
    const exList = category.exclude.title_patterns || [];
    const regs = exList.map((p) => regexFromPattern(p)).filter(Boolean);
    if (regs.some((r) => r.test(title))) return false;
  }
  return true;
}

function buildCategory(category, ctx) {
  const { title, year } = ctx;
  const f = category.fields || {};
  const vars = { year, title, doctype: '' };
  const out = {
    category: category.name,
    subCategory: category.is_catch_all ? '분류 보류 (휴먼 큐)' : '',
    labels: [],
    reason: category.id,
    isCatchAll: !!category.is_catch_all,
  };

  // subCategory
  if (!category.is_catch_all) {
    if (f.subCategory) {
      out.subCategory = f.subCategory;
    } else if (f.subCategory_annual && regexFromPattern('연간').test(title)) {
      out.subCategory = f.subCategory_annual;
    } else if (f.subCategory_periodic_template) {
      out.subCategory = applyTemplate(f.subCategory_periodic_template, vars);
    } else if (f.subCategory_template) {
      out.subCategory = applyTemplate(f.subCategory_template, vars);
    } else {
      // 카테고리명에 매핑된 doctype 사용
      out.subCategory = f.doctype_map ? (out.doctype || '기타') : '기타';
    }
  }

  // doctype
  if (f.doctype_map) {
    out.doctype = resolveDoctype(title, f.doctype_map);
    vars.doctype = out.doctype;
  }

  // phase
  if (f.phase_map) {
    vars.phase = resolvePhase(title, f.phase_map);
  }

  // team (MPS 류)
  if (category.id === 'mps_history') {
    vars.team = detectTeamFromTitleAndAncestors(title, ctx.ancestors, ctx.teamMap);
    vars.doctype = out.doctype;
  }

  // labels
  if (f.labels_template) {
    out.labels = applyTemplate(f.labels_template, vars).filter(Boolean);
  }

  // 글로벌 기본 rag-source
  if (ctx.defaultLabelsToAdd && ctx.defaultLabelsToAdd.length) {
    for (const l of ctx.defaultLabelsToAdd) {
      if (!out.labels.includes(l)) out.labels.push(l);
    }
  }
  return out;
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== AA 스페이스 이관 후보 분석 시작 (룰 기반) ===\n');

  const { spaces, rules } = loadConfig();
  const activeSpaces = getActiveSpaces(spaces);
  const global = rules.global || {};
  const cutoffDate = new Date((global.cutoff_date || '2024-01-01') + 'T00:00:00Z');
  const excludeMatchers = buildExcludeMatchers(global);
  const teamMap = global.team_label_map || { default: 'group-center' };
  const yearRegex = global.year_regex || '(20[2-9]\\d)';
  const defaultLabels = global.default_labels_to_add || ['rag-source'];
  const categories = rules.categories || [];

  // ── 스냅샷 로드 (활성 스페이스 모두) ──
  const allPages = [];
  const pageSourceSpace = new Map(); // pageId → spaceKey
  for (const spaceKey of activeSpaces) {
    const dirEntries = fs.existsSync(RESULT_PATH) ? fs.readdirSync(RESULT_PATH) : [];
    const files = dirEntries
      .filter((f) => f.startsWith(`${spaceKey}_v2_p`) && f.endsWith('.json'))
      .sort();
    if (files.length === 0) {
      console.warn(`⚠️  [${spaceKey}] 스냅샷 파일 없음 — refresh:snapshots 실행 필요`);
      continue;
    }
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(RESULT_PATH, f), 'utf8'));
      const results = data.results || data || [];
      for (const p of results) {
        allPages.push(p);
        pageSourceSpace.set(p.id, spaceKey);
      }
    }
    console.log(`📦 ${spaceKey}: ${files.length} shard 로드`);
  }
  console.log(`총 페이지 수: ${allPages.length}\n`);

  if (allPages.length === 0) {
    console.log('❌ 분석할 페이지가 없습니다. 먼저 `npm run refresh:snapshots` 실행하세요.');
    return;
  }

  // 페이지 맵 (id → page) — ancestor 경로 추적용
  const pageMap = new Map();
  allPages.forEach((p) => pageMap.set(p.id, p));

  // ── 분류 ──
  const categorized = {};
  const excluded = { archived: 0, tooOld: 0, dailyScrum: 0, weeklyDate: 0, noMatch: 0 };
  const candidates = [];

  for (const page of allPages) {
    const title = page.title || '';
    const sourceSpace = pageSourceSpace.get(page.id) || '?';

    // 글로벌 제외
    if (page.status === 'archived') { excluded.archived++; continue; }
    if (excludeMatchers.archived(title)) { excluded.archived++; continue; }
    if (excludeMatchers.dailyScrum(title)) { excluded.dailyScrum++; continue; }
    if (excludeMatchers.weeklyDate(title)) { excluded.weeklyDate++; continue; }

    const lastModified = new Date(page.version?.when || page.version?.createdAt || page.version?.number || 0);
    if (isNaN(lastModified.getTime()) || lastModified < cutoffDate) { excluded.tooOld++; continue; }

    const ancestors = getAncestorTitles(page, pageMap);
    const ancestorStr = ancestors.join(' > ');
    const year = detectYearFromTitleOrDate(title, lastModified, yearRegex);

    // 카테고리 순회 (룰 순서대로)
    let matched = null;
    for (const cat of categories) {
      const ctx = { title, ancestors, ancestorStr, year };
      if (matchesCategory(cat, ctx)) {
        matched = buildCategory(cat, { ...ctx, teamMap, defaultLabelsToAdd: [] });
        break;
      }
    }
    if (!matched) { excluded.noMatch++; continue; }

    candidates.push({
      id: page.id,
      title,
      sourceSpace,
      lastModified: lastModified.toISOString().split('T')[0],
      url: `https://neobiotech.atlassian.net/wiki${page._links?.webui || ''}`,
      ...matched,
    });

    if (!categorized[matched.category]) categorized[matched.category] = {};
    if (!categorized[matched.category][matched.subCategory]) categorized[matched.category][matched.subCategory] = [];
    categorized[matched.category][matched.subCategory].push(candidates[candidates.length - 1]);
  }

  // ── 보고서 ──
  const lines = [];
  lines.push('# AA 스페이스 이관 후보 목록');
  lines.push('');
  lines.push(`> 분석일: ${new Date().toISOString().split('T')[0]} | 기준일: ${(global.cutoff_date || '2024-01-01')} 이후 수정 | 룰 스키마: v${rules.$schema_version || '?'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 요약 통계');
  lines.push('');
  lines.push('| 항목 | 수치 |');
  lines.push('|------|------|');
  lines.push(`| 스냅샷 페이지 합계 | ${allPages.length}개 |`);
  lines.push(`| 활성 스페이스 | ${activeSpaces.join(', ')} |`);
  lines.push(`| 이관 후보 | **${candidates.length}개** |`);
  if (allPages.length > 0) lines.push(`| 이관 비율 | ${Math.round(candidates.length / allPages.length * 100)}% |`);
  lines.push(`| 제외: archived/상태 | ${excluded.archived}개 |`);
  lines.push(`| 제외: ${(global.cutoff_date || '2024-01-01')} 이전 | ${excluded.tooOld}개 |`);
  lines.push(`| 제외: Daily Scrum | ${excluded.dailyScrum}개 |`);
  lines.push(`| 제외: 주간 날짜 기록 | ${excluded.weeklyDate}개 |`);
  lines.push(`| 제외: 룰 매칭 실패 | ${excluded.noMatch}개 |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 카테고리별 — 과제(project-) 라벨을 추출해 과제 단위로 묶음
  function extractProject(labels) {
    for (const l of (labels || [])) {
      if (l.startsWith('project-')) return l;
    }
    return 'project-unsorted';
  }
  const projectBuckets = new Map(); // project → [{category, pages}]
  for (const [category, subMap] of Object.entries(categorized)) {
    const flat = Object.values(subMap).flat();
    const proj = extractProject(flat[0]?.labels);
    if (!projectBuckets.has(proj)) projectBuckets.set(proj, []);
    projectBuckets.get(proj).push({ category, pages: flat });
  }
  const projOrder = Array.from(projectBuckets.keys()).sort();
  for (const proj of projOrder) {
    const groups = projectBuckets.get(proj);
    const total = groups.reduce((s, g) => s + g.pages.length, 0);
    const projLabel = proj.replace('project-', '').toUpperCase();
    lines.push(`## 과제 ${projLabel} (${total}개)`);
    lines.push('');
    for (const { category, pages } of groups) {
      lines.push(`### ${category} (${pages.length}개)`);
      lines.push('');
      lines.push('| 출처 | 제목 | 최종수정 | 레이블 |');
      lines.push('|------|------|---------|--------|');
      pages.forEach((p) => {
        const labelStr = (p.labels || []).join(', ');
        lines.push(`| ${p.sourceSpace} | [${p.title}](${p.url}) | ${p.lastModified} | ${labelStr} |`);
      });
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('## 이관 제외 통계');
  lines.push('');
  lines.push('| 제외 사유 | 건수 |');
  lines.push('|----------|------|');
  lines.push(`| Archived 상태 페이지 | ${excluded.archived}개 |`);
  lines.push(`| ${(global.cutoff_date || '2024-01-01')} 이전 고령 문서 | ${excluded.tooOld}개 |`);
  lines.push(`| Daily Scrum 기록 | ${excluded.dailyScrum}개 |`);
  lines.push(`| 주간 날짜 기록 (YYYY-MM-DD ~ YYYY-MM-DD) | ${excluded.weeklyDate}개 |`);
  lines.push(`| 분류 불가 (기타) | ${excluded.noMatch}개 |`);
  lines.push('');
  lines.push(`*문서 위치: \`reference/migration_candidates.md\`*`);
  lines.push(`*관련 정책: [dify/space_rules_knowledge.md](../dify/space_rules_knowledge.md) | 룰 파일: [config/analysis_rules.json](../config/analysis_rules.json)*`);

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');

  console.log(`\n✅ 분석 완료!`);
  console.log(`   후보: ${candidates.length} / 전체: ${allPages.length}`);
  console.log(`   저장: ${OUTPUT_FILE}`);
  Object.entries(categorized).forEach(([cat, subs]) => {
    const t = Object.values(subs).flat().length;
    console.log(`   - ${cat}: ${t}`);
  });
}

main();