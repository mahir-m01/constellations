"""Language-of-geometry minimal description length (Amalric et al., 2017, S1 Text), re-implemented.

Sizes: atomic instruction = 2; q^s adds ceil(log10 s); q^s<i> and q^s{i} add ceil(log10 s) + 2. Octagon vertices 0..7.
K(seq) = size of the shortest program that, run from the sequence's first vertex, outputs seq.
Not an author-released implementation (theirs: github.com/sromano/language-of-geometry, Haskell); validated below
against every K printed in S1 Fig 2.

Usage: .venv/bin/python analysis/lot_complexity.py   → self-check, transform-invariance check, stimulus selection.
"""
import random
from functools import lru_cache
from itertools import permutations
from math import ceil, log10

ATOMS = {"+0": lambda n: n, "+1": lambda n: (n + 1) % 8, "+2": lambda n: (n + 2) % 8, "+3": lambda n: (n + 3) % 8,
         "-1": lambda n: (n - 1) % 8, "-2": lambda n: (n - 2) % 8, "-3": lambda n: (n - 3) % 8, "P": lambda n: (n + 4) % 8,
         "H": lambda n: (3 - n) % 8, "V": lambda n: (7 - n) % 8, "A": lambda n: (5 - n) % 8, "B": lambda n: (1 - n) % 8}
LOG = {s: ceil(log10(s)) for s in range(1, 40)}
INF = 10 ** 9


def _loop_constraints(C, s, m):
    """Constraint sets for the loop body q under q^s, q^s<i>, q^s{i} covering the first s*m items."""
    cands = [(set(), 0)]
    for n, t in C:
        cur = n
        for k in range(s):
            blk = t[k * m:(k + 1) * m]
            cands[0][0].add((cur, blk))
            cur = blk[-1]
    for f in ATOMS.values():
        variation, ok = set(), True          # q^s<i>: each copy is i applied to the previous copy
        for n, t in C:
            variation.add((n, t[:m]))
            if any(t[k * m:(k + 1) * m] != tuple(f(x) for x in t[(k - 1) * m:k * m]) for k in range(1, s)):
                ok = False
                break
        if ok:
            cands.append((variation, 2))
        offset = set()                       # q^s{i}: start vertex advanced by i between copies
        for n, t in C:
            cur = n
            for k in range(s):
                offset.add((cur, t[k * m:(k + 1) * m]))
                cur = f(cur)
        cands.append((offset, 2))
    return cands


@lru_cache(maxsize=None)
def solve(C):
    """Minimal size of a program q with q(n) == t for every (n, t) in C (all targets the same length)."""
    L = len(next(iter(C))[1])
    best = INF
    for f in ATOMS.values():                 # first item produced by a single instruction
        if all(f(n) == t[0] for n, t in C):
            best = min(best, 2 if L == 1 else 2 + solve(frozenset((t[0], t[1:]) for _, t in C)))
    for length in range(2, L + 1):           # first `length` items produced by a loop of s copies of m items
        for s in range(2, length + 1):
            if length % s:
                continue
            for cons, extra in _loop_constraints(C, s, length // s):
                q = solve(frozenset(cons))
                if q >= INF:
                    continue
                cost = q + LOG[s] + extra
                best = min(best, cost if length == L else cost + solve(frozenset((t[length - 1], t[length:]) for _, t in C)))
    return best


def K(seq) -> int:
    seq = tuple(int(v) for v in seq)
    return solve(frozenset([(seq[0], seq)]))


def transforms(seq):
    """All 16 octagon symmetries (8 rotations × optional reflection) of a sequence."""
    return [tuple(((-int(v) if m else int(v)) + r) % 8 for v in seq) for r in range(8) for m in (0, 1)]


PUBLISHED = {  # Amalric et al. 2017, S1 Text Fig 2
    "repeat+1": ("01234567", 5), "repeat+2": ("02460246", 5), "alternate16": ("0213243546576071", 7), "2points": ("02020202", 7),
    "2arcs": ("01237654", 8), "2squares": ("02467135", 8), "4points": ("02360236", 11), "4segments": ("01726354", 7),
    "4diagonals": ("04152637", 7), "2rectangles": ("05416327", 10), "2crosses": ("04512673", 7)}

if __name__ == "__main__":
    for name, (s, k) in PUBLISHED.items():
        assert K(s) == k, (name, K(s), k)
    print("published values reproduced: 11/11")
    for name, (s, k) in PUBLISHED.items():
        assert {K(t) for t in transforms(s)} == {k}, name
    print("K invariant under all 16 rotations/reflections: yes")
    perms = [(0,) + p for p in permutations(range(1, 8))]
    by_k = {}
    for p in perms:
        by_k.setdefault(K(p), []).append(p)
    print({k: len(v) for k, v in sorted(by_k.items())})
    rng = random.Random(2026)
    for k in (9, 11, 12, 13, 14, 16):
        print(k, "".join(map(str, rng.choice(by_k[k]))))
