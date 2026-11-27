// Fast drop-in for makefun-diff 1.0.0 (MIT, make.fun's own line diff, derived from
// jsdiff 9.0.0's Myers line diff). Returns byte-identically the same patch as
// makefun-diff 1.0.0 for every input { old, new }, but computes the edit script with
// line interning plus flat Int32Array V-tables and backtracking, instead of one
// allocated path object per diagonal per edit distance, which is where the house
// baseline spends its time.
//
// The rule, exactly as the house baseline's index.js header states it:
//  - Lines: a text is cut after every "\n" (the only separator); a last line with no
//    "\n" is a line too; two lines are equal only when the same code units.
//  - Edit script: common prefix kept, then common suffix of what is left; between
//    them Myers's greedy search from the first lines, keeping on each diagonal the
//    path reaching furthest into the old text, and when a deletion and an insertion
//    reach the same point the deletion's path wins; never past either text's end,
//    no edge-diagonal pruning, every run of equal lines followed as far as it goes;
//    the first path to reach both ends is the script.
//  - Patch: "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I", then per hunk
//    "@ os ol ns nl" and one line per covered line ("=" kept, "-" deleted, "+"
//    inserted); each change run lists deletions before insertions, shows up to 3 kept
//    lines before/after it, and two runs at most 6 kept lines apart share a hunk. A
//    line ending its text with no newline is written with one and followed by "%".
//    Identical texts are the first line alone.
//
// Nothing is cached from one case to the next: every run() call tokenizes, interns,
// searches and serializes its own input from scratch.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** Op kinds, as numbers for the hot paths. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const lines = [];
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines.push(parts[i] + '\n');
  if (parts[last] !== '') lines.push(parts[last]);
  return lines;
}

/**
 * Myers's greedy search on the trimmed line-id arrays a (old) and b (new), exactly
 * the house rule: for d = 0, 1, 2, ... and each diagonal k = x - y from -d to d in
 * steps of 2, the furthest point a path of d edits reaches on k is one old line
 * past the furthest (d-1)-point on k - 1 (a deletion) or one new line past the
 * furthest (d-1)-point on k + 1 (an insertion), whichever lies further into the old
 * text, the deletion when both reach one point; a move past the end of either text
 * is no candidate; from that point the path follows every run of equal lines as far
 * as it goes; the first path to reach both ends ends the search.
 *
 * a and b carry a sentinel id past their end (two distinct ids, equal to no real
 * line id), so the snake loop needs no bounds checks: it stops at the sentinel
 * mismatch exactly where it would stop at the text's end.
 *
 * Returns { Vs, D }: Vs[d] is an Int32Array of d + 1 entries, Vs[d][j] the old lines
 * consumed (x) after d edits and the snake on diagonal k = 2j - d, or -1 when no
 * path reached that diagonal; D the edit distance of the first path to reach both
 * ends. Diagonals are indexed by j = (k + d) / 2, so diagonal k - 1 at d - 1 is
 * index j - 1 and diagonal k + 1 at d - 1 is index j. The edge diagonals j = 0
 * (insertion only) and j = d (deletion only) are handled apart from the interior.
 */
function myersForward(a, b, N, M) {
  const Vs = [];
  // d = 0: the path of no edits, then its snake from the first lines.
  let V = new Int32Array(1);
  let x = 0;
  let y = 0;
  while (a[x] === b[y]) {
    x++;
    y++;
  }
  V[0] = x;
  Vs.push(V);
  if (x === N && y === M) return { Vs, D: 0 };
  for (let d = 1; d <= N + M; d++) {
    const Vprev = Vs[d - 1];
    const Vcur = new Int32Array(d + 1);
    // j = 0, k = -d: insertion only, from the (d-1)-point on k + 1 = Vprev[0].
    {
      const pv = Vprev[0];
      if (pv !== -1 && pv + d - 1 < M) {
        let xx = pv;
        let yy = xx + d;
        while (a[xx] === b[yy]) {
          xx++;
          yy++;
        }
        Vcur[0] = xx;
        if (xx === N && yy === M) {
          Vs.push(Vcur);
          return { Vs, D: d };
        }
      } else {
        Vcur[0] = -1;
      }
    }
    for (let j = 1; j < d; j++) {
      const k = 2 * j - d;
      // The deletion's candidate: one old line past the (d-1)-point on k - 1.
      let xDel = -1;
      {
        const pv = Vprev[j - 1];
        if (pv !== -1 && pv < N) xDel = pv + 1;
      }
      // The insertion's candidate: the (d-1)-point on k + 1, old lines unchanged.
      let xIns = -1;
      {
        const pv = Vprev[j];
        if (pv !== -1 && pv - (k + 1) < M) xIns = pv;
      }
      if (xDel < 0 && xIns < 0) {
        Vcur[j] = -1;
        continue;
      }
      // Further into the old text wins; the deletion wins a tie.
      let xx = xDel >= xIns ? xDel : xIns;
      let yy = xx - k;
      while (a[xx] === b[yy]) {
        xx++;
        yy++;
      }
      Vcur[j] = xx;
      if (xx === N && yy === M) {
        Vs.push(Vcur);
        return { Vs, D: d };
      }
    }
    // j = d, k = d: deletion only, from the (d-1)-point on k - 1 = Vprev[d - 1].
    {
      const pv = Vprev[d - 1];
      if (pv !== -1 && pv < N) {
        let xx = pv + 1;
        let yy = xx - d;
        while (a[xx] === b[yy]) {
          xx++;
          yy++;
        }
        Vcur[d] = xx;
        if (xx === N && yy === M) {
          Vs.push(Vcur);
          return { Vs, D: d };
        }
      } else {
        Vcur[d] = -1;
      }
    }
    Vs.push(Vcur);
  }
  throw new Error('makefun-diff: the search ended without reaching both ends');
}

/**
 * The edit script's runs [{ kind, count }], from the first lines to the last,
 * recovered by walking the V-tables back from (D, N - M) with the same
 * deletion-wins-ties choice the forward search made at each step. Runs are built
 * directly, from the end, so no per-line reversal pass is needed.
 */
function backtrackRuns(Vs, D, N, M) {
  const rev = [];
  let x = N;
  let y = M;
  let k = N - M;
  let d = D;
  // Append one op to the reversed run list, merging with the run on its end.
  const pushRev = (kind, count) => {
    const last = rev[rev.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else rev.push({ kind, count });
  };
  while (d > 0) {
    const Vprev = Vs[d - 1];
    const j = (k + d) / 2;
    let xDel = -1;
    if (j > 0) {
      const pv = Vprev[j - 1];
      if (pv !== -1 && pv < N) xDel = pv + 1;
    }
    let xIns = -1;
    if (j < d) {
      const pv = Vprev[j];
      if (pv !== -1 && pv - (k + 1) < M) xIns = pv;
    }
    if (xDel >= 0 && xDel >= xIns) {
      // The step was a deletion: the snake back to just after it, then the deletion.
      const xm = xDel;
      const ym = xDel - k;
      if (x > xm) pushRev(KEEP, x - xm);
      pushRev(DELETE, 1);
      x = xm - 1;
      y = ym;
      k = k - 1;
    } else if (xIns >= 0) {
      // The step was an insertion: the snake back to just after it, then the insertion.
      const xm = xIns;
      const ym = xIns - k;
      if (x > xm) pushRev(KEEP, x - xm);
      pushRev(INSERT, 1);
      x = xm;
      y = ym - 1;
      k = k + 1;
    } else {
      throw new Error('makefun-diff: the backtrack found no predecessor');
    }
    d--;
  }
  // The d = 0 snake, from the first lines to where the first edit began.
  if (x > 0) pushRev(KEEP, x);
  rev.reverse();
  return rev;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** make.fun's own patch of oldText into newText, by the header's rule. */
function diffPatch(oldText, newText) {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  if (prefix < n - suffix || prefix < m - suffix) {
    // Intern the trimmed lines to ids, shared across both texts, with a distinct
    // sentinel id past each text's end so the snake needs no bounds checks.
    const aa = a.slice(prefix, n - suffix);
    const bb = b.slice(prefix, m - suffix);
    const map = new Map();
    let nextId = 0;
    const aId = new Int32Array(aa.length + 1);
    const bId = new Int32Array(bb.length + 1);
    for (let i = 0; i < aa.length; i++) {
      let id = map.get(aa[i]);
      if (id === undefined) {
        id = nextId++;
        map.set(aa[i], id);
      }
      aId[i] = id;
    }
    for (let i = 0; i < bb.length; i++) {
      let id = map.get(bb[i]);
      if (id === undefined) {
        id = nextId++;
        map.set(bb[i], id);
      }
      bId[i] = id;
    }
    aId[aa.length] = nextId;
    bId[bb.length] = nextId + 1;
    const { Vs, D } = myersForward(aId, bId, aa.length, bb.length);
    runs.push(...backtrackRuns(Vs, D, aa.length, bb.length));
  }
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  return diffPatch(input.old, input.new);
}
