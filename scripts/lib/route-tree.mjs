// Shared route-tree utilities: builds the URL route tree from `src/app` and
// provides the target-normalization / matching logic used by both
// `tests/routing.test.mjs` (static link wiring) and `scripts/check-routes.mjs`
// (HTTP existence probe).
//
// Next.js conventions handled:
//  - route groups `(dashboard)` do not appear in URLs
//  - `page.tsx` -> page route, `route.ts` -> API route
//  - dynamic segments `[param]` match any single, non-empty segment
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_DIR = join(REPO_ROOT, 'src', 'app');

export function repoRoot() {
  return REPO_ROOT;
}

export function appDir() {
  return APP_DIR;
}

export function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

export function walkSources(dir = join(REPO_ROOT, 'src'), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSources(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * The app's route tree as a Map of URL pattern -> defining file.
 * Dynamic segments are kept literally (`/student/subjects/[offeringId]`).
 */
export function buildRouteTree(appDirPath = APP_DIR) {
  const routes = new Map();
  for (const file of walkFiles(appDirPath)) {
    const rel = relative(appDirPath, file).split(sep).join('/');
    let dir = null;
    if (rel === 'page.tsx') dir = '';
    else {
      const m = rel.match(/^(?:.+\/)(page\.tsx|route\.ts)$/);
      if (m) dir = rel.slice(0, rel.lastIndexOf('/'));
    }
    if (dir === null) continue;
    const url =
      '/' +
      dir
        .split('/')
        .filter((s) => s && !/^\(.*\)$/.test(s))
        .join('/');
    const clean = url === '/' ? '/' : url.replace(/\/$/, '');
    if (!routes.has(clean)) routes.set(clean, file);
  }
  return routes;
}

/** Fill dynamic segments with a placeholder so a URL can be probed. */
export function probePath(route, param = '00000000-0000-0000-0000-000000000000') {
  return route.replace(/\[[^\]]+\]/g, param);
}

/**
 * Normalize a link target lifted from source code into a comparable path.
 * Handles: query/hash (only when they precede any interpolation), template
 * `${...}` segments (become `*` wildcards, or the static prefix when a
 * segment mixes text with interpolation, e.g. `audit-logs${qs}`), trailing
 * slashes. Returns null when the target cannot be a route path at all.
 */
export function normalizeTarget(raw) {
  if (!raw.startsWith('/')) return null;
  let v = raw;
  const dyn = v.indexOf('${');
  for (const ch of ['?', '#']) {
    const i = v.indexOf(ch);
    if (i !== -1 && (dyn === -1 || i < dyn)) v = v.slice(0, i);
  }
  const segs = v.split('/').map((seg) => {
    if (seg === '') return '';
    const d = seg.indexOf('${');
    if (d === 0) return '*';
    if (d > 0) {
      const stat = seg.slice(0, d);
      return /^[A-Za-z0-9_.\-[\]]+$/.test(stat) ? stat : '*';
    }
    return seg;
  });
  const joined = segs.join('/').replace(/\/+$/, '');
  return joined === '' ? '/' : joined;
}

/**
 * Match a (possibly wildcard-bearing) target against the route tree.
 * Returns the BEST-matching route pattern, or null.
 * Rules:
 *  - exact string matches are tried first;
 *  - a `*` target segment (from `${...}` interpolation) may only fill a
 *    dynamic `[param]` route segment — never a static one, so a link can
 *    never silently resolve to an unrelated route;
 *  - a concrete target segment fills a `[param]` or must equal the static
 *    route segment; empty segments only match empty (root path).
 * Ambiguity is resolved by score (exact static segment > concrete value
 * filling [param] > `*` filling [param]), NOT by filesystem order:
 * `readdirSync` order differs between platforms (NTFS vs ext4), and a link
 * like `.../assessments/new` also matches `.../assessments/[assessmentId]` —
 * first-match would mark different routes as linked on Windows and Linux.
 * Ties break lexicographically so the result is fully deterministic.
 */
export function matchRoute(target, routes) {
  if (target === null) return null;
  if (routes.has(target)) return target;
  const t = target.split('/');
  let best = null;
  let bestScore = -1;
  for (const r of routes.keys()) {
    const s = r.split('/');
    if (s.length !== t.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < s.length; i++) {
      const rs = s[i];
      const ts = t[i];
      const rsDynamic = rs.startsWith('[') && rs.endsWith(']');
      if (ts === '*') {
        if (!rsDynamic) {
          ok = false;
          break;
        }
        score += 1; // interpolated value filling a [param]
        continue;
      }
      if (ts === '') {
        if (rs === '') {
          score += 3; // leading slash; root path has a trailing ''
          continue;
        }
        ok = false;
        break;
      }
      if (rsDynamic) {
        score += 2; // concrete value filling a [param]
        continue;
      }
      if (rs !== ts) {
        ok = false;
        break;
      }
      score += 3; // exact static segment
    }
    if (!ok) continue;
    if (score > bestScore || (score === bestScore && best !== null && r < best)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Extract every string literal (single/double quoted, plus backtick templates
 * with nested `${...}`) from source text, with positions. Comments skipped.
 */
export function extractLiterals(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i);
      i = i === -1 ? n : i + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === c || text[j] === '\n') break;
        j++;
      }
      out.push({ value: text.slice(i + 1, j), start: i });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (depth === 0 && text[j] === '`') break;
        if (text[j] === '$' && text[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0 && text[j] === '}') {
          depth--;
          j++;
          continue;
        }
        j++;
      }
      out.push({ value: text.slice(i + 1, j), start: i });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

const ASSET_EXT =
  /\.(svg|png|jpg|jpeg|gif|webp|ico|txt|css|js|json|xml|webmanifest|map|pdf|docx?|woff2?)$/i;

/** True for literals that are shaped like an internal app path (not assets, not prose). */
export function isPathLiteral(value) {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/_next')) return false;
  if (/\s/.test(value)) return false;
  if (value.includes('://')) return false;
  const pathPart = value.split(/[?#]/)[0];
  if (ASSET_EXT.test(pathPart)) return false;
  return /^\/[A-Za-z0-9_$\-./[\]{}()?#=&+]*$/.test(value);
}
