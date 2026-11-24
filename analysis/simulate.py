"""Simulated participants for testing the analysis pipeline ONLY (rows flagged mode='sim'; all outputs watermarked).

Usage: .venv/bin/python analysis/simulate.py [N] → data/sim/sim_<pid>.csv
Generative model: logit P(correct item) = a_i + cond_shift + b_i·(1 − f·[AS])·(k − k̄) + position effect,
where f = flattening under suppression, related to inner-speech score (H3).
"""
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
rng = np.random.default_rng(7)
# stimulus set read from the task itself (single source of truth)
SEQS = [(n, [int(x) for x in v.split(",")], int(k)) for n, v, k in
        re.findall(r"name: '([^']+)', v: \[([\d, ]+)\], k: (\d+)", (ROOT / "task" / "task.js").read_text())]
BOUNDS = {"2squares": [4], "2arcs": [4], "2rectangles": [4], "4segments": [2, 4, 6], "4diagonals": [2, 4, 6],
          "2crosses": [2, 4, 6], "alternate": [2, 4, 6]}
CONDS = ["none", "as", "tap"]
SHIFT = {"none": 0.0, "as": -0.35, "tap": -0.30}


def participant(i: int) -> pd.DataFrame:
    pid = f"S{i:03d}"
    verbal = rng.uniform(1.5, 5)
    a, b = rng.normal(1.6, 0.5), rng.normal(-0.17, 0.05)
    flat = np.clip(0.15 + 0.08 * (verbal - 3) + rng.normal(0, 0.1), 0, 1)
    demo = {"pid": pid, "mode": "sim", "started": f"2026-11-24T10:{i:02d}:00Z", "email": f"{pid}@example.com",
            "age": int(rng.choice([18, 19, 20, 21, 22, 23, 35, 48], p=[.15, .2, .2, .15, .1, .1, .05, .05])),
            "gender": rng.choice(["Female", "Male"]), "course": "simulated", "stream": rng.choice(["stem", "arts", "commerce"]),
            "year": "2", "maths": int(rng.integers(1, 5)), "languages_n": int(rng.integers(1, 4)), "english_l1": 0,
            "sleep_h": float(rng.choice([5, 6, 7, 8])), "gaming_hpw": float(rng.choice([0, 2, 5.5, 11])), "input": "mouse",
            "mic_ok": 1, "block_order": ">".join(rng.permutation(CONDS)), "strategy": "shape", "as_words": 2, "as_paused": "no",
            "noticed": 1, "effort_none": int(rng.integers(2, 5)), "effort_as": int(rng.integers(4, 7)), "effort_tap": int(rng.integers(3, 7)),
            "irqf_verbal": round(verbal, 2), "irqf_visual": round(rng.uniform(1.5, 5), 2), "duration_min": 17.5}
    rows, kbar = [], np.mean([k for *_, k in SEQS])
    for blk, cond in enumerate(demo["block_order"].split(">"), 1):
        for t, (name, canon, k) in enumerate(rng.permutation(np.array(SEQS, dtype=object)), 1):
            rot, mir = int(rng.integers(8)), int(rng.integers(2))
            seq = [((-v if mir else v) + rot) % 8 for v in canon]
            slope = b * (1 - flat * (cond == "as"))
            p = 1 / (1 + np.exp(-(a + SHIFT[cond] + slope * (k - kbar) - 0.12 * np.abs(np.arange(8) - 2.5))))
            ok = rng.random(8) < p
            resp = [v if c else int(rng.choice([x for x in range(8) if x != v])) for v, c in zip(seq, ok)]
            sec_ok = int(cond == "none" or rng.random() > 0.05)
            rows.append({**demo, "phase": "test", "block": blk, "trial": t, "cond": cond, "seq_name": name, "complexity": k,
                         "rot": rot, "mirror": mir, "seq": " ".join(map(str, seq)), "canonical": " ".join(map(str, canon)),
                         "response": " ".join(map(str, resp)), "acc_pos": ok.mean(), "lev_sim": ok.mean(), "prefix": int(np.argmin(ok)) if not ok.all() else 8,
                         "recall_rt_ms": int(rng.normal(6000, 1200)),
                         "click_ms": " ".join(map(str, np.cumsum([900] + [int(rng.normal(450, 60) + 70 * (i in BOUNDS.get(name, [])))
                                                                        for i in range(1, 8)]))), "confidence": int(np.clip(round(1 + 3 * ok.mean() + rng.normal(0, .6)), 1, 4)),
                         "sec_coverage": "" if cond == "none" else 0.95, "sec_ok": "" if cond == "none" else sec_ok})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    out = ROOT / "data" / "sim"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("sim_*.csv"):
        f.unlink()
    for i in range(1, n + 1):
        participant(i).to_csv(out / f"sim_S{i:03d}.csv", index=False)
    print(f"wrote {n} simulated participants to {out}")
