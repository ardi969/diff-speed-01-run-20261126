[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/ardi969/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/ardi969/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

# Diff Speed — a faster makefun-diff 1.0.0

A drop-in replacement for makefun-diff 1.0.0, make.fun's own line diff, written for
make.fun's ["Diff two texts faster, 27 November 2026"](https://make.fun/bounty/diff-speed-01-run-20261126)
bounty ($100 over 10 places). `solve.js` returns byte-identically the same patch as
makefun-diff 1.0.0 for every input, and runs about 2.4× faster than the house
baseline on the practice set (median CPU 0.71s vs 1.68s for the four practice cases).

## How it works

The house baseline walks Myers's search with one allocated path object per
diagonal per edit distance. This entry computes the same search — same rule, same
tie-breaks, same first path to both ends — with flat `Int32Array` V-tables plus
backtracking:

- Lines are interned to integer ids (shared across both texts), so the snake loop
  compares ints, and a distinct sentinel id past each text's end means the snake
  needs no bounds checks.
- The forward pass stores one `Int32Array` per edit distance `d` (entry `j` is the
  furthest old-lines-consumed on diagonal `k = 2j - d`, or `-1` when no path
  reached it), choosing the deletion when a deletion and an insertion reach the
  same point, never moving past either text's end, and following every run of
  equal lines as far as it goes — exactly the house rule.
- The edit script is recovered by walking the tables back from `(D, N - M)` with
  the same choice at each step, then the patch is serialized exactly as the house
  baseline writes it (hunks, 3 lines of context, `%` after a line with no newline).

Nothing is cached from one case to the next: every `run()` call tokenizes, interns,
searches and serializes its own input from scratch.

## Verify

```sh
# practice set: exactness against the kit's reference + timing vs the baseline
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Exactness was also checked against the house baseline on 3,488 random fuzz cases
(including empty texts, bare last lines, CRLF, repeated lines, moved blocks) and
24 fresh cases drawn with the kit's own generator — all byte-identical.

## Run it

`main.ts` is the program the harness runs (`node /bot/main.ts`, Node 22): it reads
every case from `/input/cases.json`, answers each one alone with `run()` from
`solve.js`, and writes `/output/answers.json`. Outside a container,
`MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.

## License

MIT — see [LICENSE](LICENSE). makefun-diff 1.0.0 itself is make.fun's own code
(MIT, derived from jsdiff 9.0.0, BSD-3-Clause); this entry is an independent
implementation of the same documented rule.
