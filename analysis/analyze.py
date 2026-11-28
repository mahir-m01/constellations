"""Constellations: the analysis pipeline.

Usage:  .venv/bin/python analysis/analyze.py [data_dir]   (default: data/raw)
Reads every CSV in data_dir: per-participant downloads and/or the Google Sheet "trials" export.
Writes data/constellations_dataset.xlsx, analysis/out/figs/*.pdf|png, analysis/out/stats.tex and tables/*.tex.
If data_dir contains simulated data (mode == "sim"), every output is watermarked SIMULATED.
"""
import json
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pingouin as pg
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.genmod.bayes_mixed_glm import BinomialBayesMixedGLM
from statsmodels.stats.power import TTestPower

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "analysis" / "out"
FIGS, TABS = OUT / "figs", OUT / "tables"
CONDS = ["none", "as", "tap"]
LABEL = {"none": "No load", "as": "Articulatory suppression", "tap": "Tapping"}
COLOR = {"none": "#0072B2", "as": "#D55E00", "tap": "#009E73"}  # Okabe–Ito
MIN_VALID_SHARE = 0.5      # participant excluded if < 50 % compliant trials in any block
STEM = {"stem", "health"}
NON_STEM = {"commerce", "arts"}   # "school" (no stream yet) and "other" are in neither group

# ---------- loading & cleaning ----------
def load(data_dir: Path) -> pd.DataFrame:
    files = sorted(data_dir.glob("*.csv"))
    if not files:
        sys.exit(f"No CSV files in {data_dir}")
    df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    df = df[df["mode"].isin(["live", "sim"])].drop_duplicates(["pid", "phase", "block", "trial"]).copy()   # drops demo and test rows
    # one session per person. Emails match ignoring case and surrounding spaces (a missing email counts as its own person).
    # Keep each person's first finished session. A session cut short by a closed tab (rescued with ?rescue, so it has no
    # duration_min) is used only if that person never finished one, so it can't knock out their complete session.
    df["email"] = df["email"].fillna(df["pid"]).astype(str).str.strip().str.lower()
    finished = df["duration_min"].notna() if "duration_min" in df else pd.Series(False, index=df.index)
    sessions = (df.assign(finished=finished).groupby("pid")
                .agg(email=("email", "first"), started=("started", "min"), finished=("finished", "any"))
                .sort_values(["finished", "started"], ascending=[False, True]))
    df = df[df["pid"].isin(sessions.drop_duplicates("email").index)]
    for c in ["acc_pos", "lev_sim", "complexity", "age", "sleep_h", "gaming_hpw", "maths", "languages_n", "sec_ok", "recall_rt_ms", "confidence"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    # Only the shortened design (task_version 2.x: 2.0 has 5 paths per round, 2.1 has 4). Applied after the one-session-per-email rule on purpose: anyone
    # whose first session was an earlier 14-path tryout has already seen every path, so they drop out too.
    return df[df.get("task_version", pd.Series("", index=df.index)).astype(str).str.startswith("2")]


def exclusions(df: pd.DataFrame):
    test = df[df["phase"] == "test"].copy()
    test["valid"] = ~((test["cond"] != "none") & (test["sec_ok"] == 0))  # unverified (no mic) counts as valid
    share = test.groupby(["pid", "cond"])["valid"].mean().unstack()
    bad = share.index[(share < MIN_VALID_SHARE).any(axis=1)]
    fail = share < MIN_VALID_SHARE
    log = {"n_sessions": df["pid"].nunique(), "n_excluded_participants": len(bad),
           "n_tap_fail": int(fail.get("tap", pd.Series(dtype=bool)).sum()), "n_as_fail": int(fail.get("as", pd.Series(dtype=bool)).sum()),
           "n_both_fail": int((fail.get("tap", False) & fail.get("as", False)).sum()) if {"as", "tap"} <= set(fail.columns) else 0,
           "n_invalid_trials": int((~test["valid"]).sum()), "n_test_trials": len(test), "n_dual_trials": int((test["cond"] != "none").sum())}
    clean = test[test["valid"] & ~test["pid"].isin(bad)].copy()
    return clean, log, test[~test["pid"].isin(bad)].copy()   # last: compliance filter off (sensitivity)


def osa(a, b):
    """Damerau–Levenshtein (optimal string alignment) distance: insertions, deletions, substitutions, adjacent swaps."""
    d = [[i + j if i * j == 0 else 0 for j in range(len(b) + 1)] for i in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[-1][-1]


def add_dl(test: pd.DataFrame) -> pd.DataFrame:
    sims = [1 - osa(str(s).split(), str(r).split()) / 8 for s, r in zip(test["seq"], test["response"])]
    return test.assign(dl_sim=sims)


# ---------- complexity metrics (alternatives to LoT) ----------
def steps(seq):
    return [(b - a) % 8 for a, b in zip(seq, seq[1:])]


def entropy(xs):
    p = pd.Series(xs).value_counts(normalize=True)
    return float(-(p * np.log2(p)).sum())


def lz76(s):
    """Lempel–Ziv (1976) complexity: number of new phrases in a left-to-right parse."""
    i, c, n = 0, 0, len(s)
    while i < n:
        k = 1
        while i + k <= n and _occurs(s[i:i + k], s[:i + k - 1]):
            k += 1
        c, i = c + 1, i + k
    return c


def _occurs(sub, hay):
    return any(hay[j:j + len(sub)] == sub for j in range(len(hay) - len(sub) + 1))


def crossings(seq):
    pts = [(math.cos(math.pi / 2 - v * math.pi / 4), math.sin(math.pi / 2 - v * math.pi / 4)) for v in seq]
    segs = list(zip(pts, pts[1:]))
    def ccw(a, b, c): return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    def cross(s, t): return ccw(s[0], t[0], t[1]) != ccw(s[1], t[0], t[1]) and ccw(s[0], s[1], t[0]) != ccw(s[0], s[1], t[1])
    return sum(cross(segs[i], segs[j]) for i in range(len(segs)) for j in range(i + 2, len(segs)))


def metrics_table(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for name, g in df.groupby("seq_name"):
        seq = [int(x) for x in g["canonical"].iloc[0].split()]
        st = steps(seq)
        rows.append({"seq_name": name, "LoT": g["complexity"].iloc[0], "LZ76": lz76("".join(map(str, st))),
                     "step_entropy": entropy(st), "step_runs": 1 + sum(a != b for a, b in zip(st, st[1:])),
                     "path_length": sum(2 * math.sin(math.pi * min(s, 8 - s) / 8) for s in st), "crossings": crossings(seq)})
    return pd.DataFrame(rows)


def items(test: pd.DataFrame) -> pd.DataFrame:
    """One row per serial position: correct = response[i] == sequence[i]."""
    out = []
    for r in test.itertuples():
        seq, resp = str(r.seq).split(), str(r.response).split()
        for i, v in enumerate(seq):
            out.append({"pid": r.pid, "cond": r.cond, "block": r.block, "seq_name": r.seq_name, "complexity": r.complexity,
                        "position": i + 1, "correct": int(i < len(resp) and resp[i] == v)})
    return pd.DataFrame(out)


# ---------- per-participant summary ----------
DEMO_COLS = ["email", "age", "gender", "course", "stream", "year", "maths", "languages_n", "english_l1", "sleep_h",
             "gaming_hpw", "input", "block_order", "mic_ok", "strategy", "as_words", "as_paused", "noticed", "duration_min",
             "effort_none", "effort_as", "effort_tap", "task_version", "path_set"]


def slope(d: pd.DataFrame, y="acc_pos") -> float:
    return -np.polyfit(d["complexity"], d[y], 1)[0] if d["complexity"].nunique() > 1 else np.nan


def participants(df: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    cols = DEMO_COLS + [c for c in df.columns if c.startswith("irqf_")]
    P = df.groupby("pid")[[c for c in cols if c in df.columns]].first()
    for c in CONDS:
        g = test[test["cond"] == c].groupby("pid")
        P[f"acc_{c}"] = g["acc_pos"].mean()
        P[f"compress_{c}"] = g.apply(slope, include_groups=False)   # accuracy lost per unit LoT complexity (> 0 = compression benefit)
        P[f"compressdl_{c}"] = g.apply(lambda d: slope(d, "dl_sim"), include_groups=False)
        P[f"meta_{c}"] = g.apply(lambda d: d["confidence"].corr(d["acc_pos"], method="spearman"), include_groups=False)  # metacognitive sensitivity
    P["acc_all"] = test.groupby("pid")["acc_pos"].mean()
    P["as_flattening"] = P["compress_tap"] - P["compress_as"]       # > 0: suppression removes part of the compression benefit
    P["as_cost"] = P["acc_tap"] - P["acc_as"]                       # verbal-specific dual-task cost
    P["stem"] = P["stream"].map(lambda s: 1 if s in STEM else 0 if s in NON_STEM else np.nan)   # NaN: no stream / not studying
    P["school"] = P["year"].astype(str).str.startswith("Class").astype(int)
    return P.dropna(subset=[f"acc_{c}" for c in CONDS])


# ---------- statistics ----------
def fmt_p(p):
    return "< .001" if p < .001 else f"= {p:.3f}".replace("0.", ".")


def fmt_bf(bf):
    bf = float(bf)
    if not np.isfinite(bf):
        return "--"
    if bf < 1000:
        return f"{bf:.2f}"
    m, e = f"{bf:.1e}".split("e")
    return f"{m} \\times 10^{{{int(e)}}}"   # math-mode string; callers supply the $…$


MIN_N_TEST = 3   # a t-test needs at least three people; with fewer the row is reported as not estimable


def one_sample(x, label):
    """One-sample t-test against 0. Effect size d = M / SD (for a difference score this is d_z)."""
    d = pd.to_numeric(x, errors="coerce").dropna()
    n = len(d)
    row = {"label": label, "n": n, "M": d.mean() if n else np.nan, "SD": d.std() if n > 1 else np.nan,
           "t": np.nan, "df": np.nan, "p": np.nan, "d": np.nan, "BF10": np.nan}
    if n < MIN_N_TEST or not d.std() > 0:
        return row
    t = pg.ttest(d, 0)
    col = lambda *ks: next(t[k].iat[0] for k in ks if k in t)
    row.update(t=col("T"), df=col("dof"), p=col("p_val", "p-val"), d=d.mean() / d.std(), BF10=float(col("BF10")))
    return row


def paired(a, b, label):
    """Paired t-test, run as a one-sample test on each person's difference a − b (people missing either score drop out).
    Effect size d_z = mean difference / SD of the differences. (pingouin's paired cohen_d is a different, pooled-SD d.)"""
    return one_sample(a - b, label)


def rm_anova(P, prefix):
    long = P[[f"{prefix}_{c}" for c in CONDS]].reset_index().melt("pid", var_name="cond", value_name="y")
    a = pg.rm_anova(long, dv="y", within="cond", subject="pid", correction=True, detailed=False)
    get = lambda *ks: next((a[k].iat[0] for k in ks if k in a), np.nan)
    return {"F": get("F"), "df1": get("ddof1"), "df2": get("ddof2"), "p": get("p_unc", "p-unc"),
            "p_gg": get("p_GG_corr", "p-GG-corr"), "eps": get("eps"), "np2": get("ng2", "np2")}


def gee(it: pd.DataFrame, ref="tap"):
    it = it.assign(kc=it["complexity"] - it["complexity"].mean())
    m = smf.gee(f"correct ~ kc * C(cond, Treatment('{ref}')) + C(block)", "pid", it,
                family=sm.families.Binomial(), cov_struct=sm.cov_struct.Exchangeable()).fit()
    return pd.DataFrame({"b": m.params, "se": m.bse, "z": m.tvalues, "p": m.pvalues, "OR": np.exp(m.params)})


# chunk boundaries implied by each sequence's minimal program (Amalric et al., 2017, S1 Text), e.g. 2squares = [[+0,[+2]^3]^2<-1>]
BOUNDS = {"2squares": [4], "2arcs": [4], "2rectangles": [4], "4segments": [2, 4, 6], "4diagonals": [2, 4, 6],
          "2crosses": [2, 4, 6], "alternate": [2, 4, 6]}


def boundary_slowing(test: pd.DataFrame, pooled: bool = False) -> pd.DataFrame:
    """Per participant × condition (or per participant with pooled=True, all rounds together): mean inter-click interval entering a new chunk minus within-chunk ICI.
    Only transitions made before the first error are used (the click and everything before it correct), and only trials
    answered without corrections (n_fixes = 0), since clearing a star leaves click times out of order."""
    rows = []
    fixes = pd.to_numeric(test["n_fixes"], errors="coerce").fillna(0) if "n_fixes" in test else pd.Series(0, index=test.index)
    for r in test[test["seq_name"].isin(BOUNDS) & (fixes == 0)].itertuples():
        t = [int(x) for x in str(r.click_ms).split()]
        for i in range(1, min(len(t), int(r.prefix))):
            rows.append({"pid": r.pid, "cond": r.cond, "boundary": i in BOUNDS[r.seq_name], "ici": t[i] - t[i - 1]})
    d = pd.DataFrame(rows)
    if d.empty:
        return pd.DataFrame()
    m = d.groupby(["pid", "boundary"] if pooled else ["pid", "cond", "boundary"])["ici"].mean().unstack()
    return m[True] - m[False] if pooled else (m[True] - m[False]).unstack()   # rows pid (, columns cond)


def bayes_glmm(it: pd.DataFrame) -> pd.DataFrame:
    it = it.assign(kc=it["complexity"] - it["complexity"].mean())
    vc = {"pid": "0 + C(pid)", "pid_k": "0 + C(pid):kc", "seq": "0 + C(seq_name)"}
    m = BinomialBayesMixedGLM.from_formula("correct ~ kc * C(cond, Treatment('tap')) + C(block)", vc, it).fit_vb()
    k = len(m.fe_mean)
    return pd.DataFrame({"term": m.model.exog_names[:k], "mean": m.fe_mean, "sd": m.fe_sd,
                         "lo": m.fe_mean - 1.96 * m.fe_sd, "hi": m.fe_mean + 1.96 * m.fe_sd})


def metric_comparison(it: pd.DataFrame, M: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for m in ["LoT", "LZ76", "step_entropy", "step_runs", "path_length", "crossings"]:
        d = it.merge(M[["seq_name", m]], on="seq_name")
        if d[m].nunique() < 2:
            continue
        d["mz"] = (d[m] - d[m].mean()) / d[m].std()
        fit = smf.glm("correct ~ C(pid) + C(block) + C(cond) * mz", d, family=sm.families.Binomial()).fit()
        seq_acc = d[d["cond"] == "none"].groupby("seq_name").agg(acc=("correct", "mean"), x=(m, "first"))
        rows.append({"metric": m, "AIC": fit.aic, "r_seq": seq_acc["acc"].corr(seq_acc["x"])})
    out = pd.DataFrame(rows)
    out["dAIC"] = out["AIC"] - out["AIC"].min()
    out["metric"] = out["metric"].map({"LoT": "LoT complexity", "LZ76": "Lempel–Ziv", "step_entropy": "Step entropy",
                                       "step_runs": "Step runs", "path_length": "Path length", "crossings": "Crossings"})
    return out.sort_values("AIC")


def correlations(P: pd.DataFrame) -> pd.DataFrame:
    pairs = [("acc_none", "age"), ("compress_none", "age"), ("acc_all", "age"), ("compress_none", "maths"), ("acc_none", "sleep_h"),
             ("acc_none", "gaming_hpw"), ("acc_none", "languages_n")] + [("as_flattening", c) for c in P.columns if c.startswith("irqf_")]
    rows = []
    for x, y in pairs:
        d = P[[x, y]].apply(pd.to_numeric, errors="coerce").dropna()
        if len(d) < 5 or d[y].nunique() < 2:
            continue
        r = pg.corr(d[x], d[y])
        s = pg.corr(d[x], d[y], method="spearman")
        rows.append({"x": x, "y": y, "n": len(d), "r": r["r"].iat[0], "CI": r["CI95"].iat[0] if "CI95" in r else r["CI95%"].iat[0],
                     "p": r["p_val"].iat[0] if "p_val" in r else r["p-val"].iat[0], "BF10": float(r["BF10"].iat[0]), "rho": s["r"].iat[0]})
    out = pd.DataFrame(rows)
    if len(out):
        out["p_holm"] = pg.multicomp(out["p"].values, method="holm")[1]
    return out


def group_diffs(P: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for grp, a, b in [("gender", "Female", "Male"), ("stem", 1, 0)]:
        for y in ["acc_none", "acc_all", "compress_none", "as_flattening"]:
            xa, xb = P.loc[P[grp] == a, y].dropna(), P.loc[P[grp] == b, y].dropna()
            if min(len(xa), len(xb)) < 3:
                continue
            t = pg.ttest(xa, xb, correction=True)
            g = pg.compute_effsize(xa, xb, eftype="hedges")
            rows.append({"group": f"{grp}: {a} vs {b}", "y": y, "n": f"{len(xa)}/{len(xb)}", "Ma": xa.mean(), "Mb": xb.mean(),
                         "t": t["T"].iat[0], "df": t["dof"].iat[0], "p": t["p_val"].iat[0] if "p_val" in t else t["p-val"].iat[0],
                         "g": g, "BF10": float(t["BF10"].iat[0])})
    return pd.DataFrame(rows)


# ---------- figures ----------
plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150,
                     "savefig.bbox": "tight", "font.family": "DejaVu Sans"})


def save(fig, name, simulated):
    if simulated:
        fig.text(0.5, 0.5, "SIMULATED DATA", fontsize=28, color="red", alpha=0.18, ha="center", va="center", rotation=25)
    for ext in ("pdf", "png"):
        fig.savefig(FIGS / f"{name}.{ext}")
    plt.close(fig)


def within_se(test: pd.DataFrame) -> pd.DataFrame:
    """Cousineau–Morey within-subject SE per condition × sequence."""
    d = test.copy()
    d["norm"] = d["acc_pos"] - d.groupby("pid")["acc_pos"].transform("mean") + d["acc_pos"].mean()
    k = len(CONDS) * d.groupby("pid")["seq_name"].nunique().median()   # cells per person (each person sees one path set)
    g = d.groupby(["cond", "seq_name"]).agg(m=("acc_pos", "mean"), sd=("norm", "std"), n=("norm", "size"), x=("complexity", "first"))
    g["se"] = g["sd"] / np.sqrt(g["n"]) * math.sqrt(k / (k - 1))
    return g.reset_index()


def fig_curve(test, sim):
    g = within_se(test)
    fig, ax = plt.subplots(figsize=(4.6, 3.2))
    for c in CONDS:
        d = g[g["cond"] == c].sort_values("x")
        ax.errorbar(d["x"], d["m"], yerr=d["se"], fmt="o", ms=4, color=COLOR[c], label=LABEL[c], capsize=2)
        b = np.polyfit(d["x"], d["m"], 1)
        xs = np.linspace(d["x"].min(), d["x"].max(), 2)
        ax.plot(xs, np.polyval(b, xs), color=COLOR[c], lw=1.5)
    ax.set(xlabel="Language-of-thought complexity", ylabel="Recall accuracy (serial position)", ylim=(0, 1.02))
    ax.legend(frameon=False, fontsize=8)
    save(fig, "fig_curve", sim)


def fig_paired(P, prefix, ylabel, name, sim):
    fig, ax = plt.subplots(figsize=(3.6, 3.2))
    for _, r in P.iterrows():
        ax.plot(range(3), [r[f"{prefix}_{c}"] for c in CONDS], color="0.8", lw=0.7, zorder=1)
    for i, c in enumerate(CONDS):
        x = P[f"{prefix}_{c}"]
        ci = 1.96 * x.std() / np.sqrt(len(x))
        ax.errorbar(i, x.mean(), yerr=ci, fmt="o", ms=7, color=COLOR[c], capsize=3, zorder=3)
    ax.set_xticks(range(3), [LABEL[c].replace(" ", "\n", 1) for c in CONDS])
    ax.set_ylabel(ylabel)
    save(fig, name, sim)


def fig_serial(it, sim):
    fig, ax = plt.subplots(figsize=(4.2, 3))
    for c in CONDS:
        s = it[it["cond"] == c].groupby("position")["correct"].mean()
        ax.plot(s.index, s.values, "o-", ms=3, color=COLOR[c], label=LABEL[c])
    ax.set(xlabel="Serial position", ylabel="Proportion correct", ylim=(0, 1.02))
    ax.legend(frameon=False, fontsize=8)
    save(fig, "fig_serial", sim)


def fig_metrics(mc, sim):
    fig, ax = plt.subplots(figsize=(4, 2.6))
    ax.barh(mc["metric"], mc["dAIC"], color=["#0072B2" if m.startswith("LoT") else "0.6" for m in mc["metric"]])
    ax.invert_yaxis()
    ax.set_xlabel("ΔAIC relative to best model (lower = better)")
    save(fig, "fig_metrics", sim)


def fig_individual(P, sim):
    pairs = [("age", "acc_none"), ("age", "compress_none"), ("maths", "compress_none")] + [(y, "as_flattening") for y in P.columns if y.startswith("irqf_")]
    nice = {"age": "Age (years)", "acc_none": "Accuracy, no load", "compress_none": "Compression benefit, no load",
            "maths": "Highest maths level", "as_flattening": "Suppression flattening", "irqf_verbal": "Inner speech (IRQ)"}
    fig, axes = plt.subplots(1, len(pairs), figsize=(3.1 * len(pairs), 2.8))
    for ax, (x, y) in zip(np.atleast_1d(axes), pairs):
        d = P[[x, y]].apply(pd.to_numeric, errors="coerce").dropna()
        ax.scatter(d[x], d[y], s=14, color="#333")
        if len(d) > 2 and d[x].nunique() > 1:
            b = np.polyfit(d[x], d[y], 1)
            xs = np.linspace(d[x].min(), d[x].max(), 2)
            ax.plot(xs, np.polyval(b, xs), color="#D55E00")
        ax.set(xlabel=nice.get(x, x), ylabel=nice.get(y, y), title=f"n = {len(d)}")
    fig.tight_layout()
    save(fig, "fig_individual", sim)


# ---------- outputs ----------
def tex_table(df: pd.DataFrame, cols: dict, caption: str, label: str, fmt: dict | None = None, wide: bool = False) -> str:
    fmt = fmt or {}
    head = " & ".join(cols.values()) + r" \\"
    body = "\n".join(" & ".join(fmt.get(c, _cell)(r[c]) for c in cols) + r" \\" for _, r in df.iterrows())
    tab = f"\\begin{{tabular}}{{{'l' + 'r' * (len(cols) - 1)}}}\\toprule\n{head}\n\\midrule\n{body}\n\\bottomrule\\end{{tabular}}"
    if wide:   # shrink to the text width instead of running into the margin
        tab = f"\\resizebox{{\\linewidth}}{{!}}{{%\n{tab}}}"
    return f"\\begin{{table}}[t]\\centering\\small\\caption{{{caption}}}\\label{{{label}}}\n{tab}\\end{{table}}\n"


def pretty(term: str) -> str:
    for k, v in {"C(cond, Treatment('tap'))[T.as]": "AS (vs tapping)", "C(cond, Treatment('tap'))[T.none]": "No load (vs tapping)",
                 "C(block)[T.2]": "Round 2 (vs round 1)", "C(block)[T.3]": "Round 3 (vs round 1)",
                 "kc": "Complexity", ":": " $\\times$ ", "Intercept": "Intercept"}.items():
        term = term.replace(k, v)
    return term


def _cell(v):
    if isinstance(v, (float, np.floating)):
        return "--" if np.isnan(v) else f"{v:.2f}"
    return str(v).replace("_", r"\_").replace("%", r"\%")


def write_macros(S: dict, simulated: bool):
    lines = [r"\newif\ifsimulated", r"\simulatedtrue" if simulated else r"\simulatedfalse"]
    lines += [f"\\newcommand{{\\{k}}}{{{v}}}" for k, v in S.items()]
    (OUT / "stats.tex").write_text("\n".join(lines) + "\n")


def apa_t(r):
    if not np.isfinite(r.get("t", np.nan)):
        return f"not estimable (only $n = {r.get('n', 0)}$ with usable data)"
    return f"$t({r['df']:.0f}) = {r['t']:.2f}$, $p {fmt_p(r['p'])}$, $d_z = {r['d']:.2f}$, BF$_{{10}} = {fmt_bf(r['BF10'])}$"


def report_numbers(PF, P, log, h1, h2, acc_aov, slope_aov, power_full, power_comp):
    ages = pd.to_numeric(PF["age"], errors="coerce")
    S = {"NSessions": log["n_sessions"], "NAll": len(PF), "NExcluded": log["n_excluded_participants"], "NFinal": len(P),
         "NTapFail": log["n_tap_fail"], "NAsFail": log["n_as_fail"], "NBothFail": log["n_both_fail"],
         "NInvalidTrials": log["n_invalid_trials"], "NTestTrials": log["n_test_trials"], "NDualTrials": log["n_dual_trials"],
         "NNoMic": int((pd.to_numeric(PF["mic_ok"], errors="coerce") == 0).sum()), "NMinors": int((ages < 18).sum()),
         "AgeMean": f"{ages.mean():.1f}", "AgeSD": f"{ages.std():.1f}", "AgeMin": f"{ages.min():.0f}", "AgeMax": f"{ages.max():.0f}",
         "AgeMedian": f"{ages.median():.0f}",
         "NFemale": int((PF["gender"] == "Female").sum()), "NMale": int((PF["gender"] == "Male").sum()),
         "NStem": int((PF["stem"] == 1).sum()), "NNonStem": int((PF["stem"] == 0).sum()), "NSchool": int(PF["school"].sum()),
         "MinDz": f"{power_comp:.2f}", "MinDzAll": f"{power_full:.2f}", "HoneStat": apa_t(h1), "HoneM": f"{h1['M']:.3f}",
         "DurationMedian": f"{pd.to_numeric(PF['duration_min'], errors='coerce').median():.1f}"}
    for key, r in h2.items():
        S[key] = apa_t(r)
    for c, tag in zip(CONDS, ["None", "As", "Tap"]):
        S[f"Acc{tag}"] = f"{P[f'acc_{c}'].mean():.2f}"
        S[f"AccSD{tag}"] = f"{P[f'acc_{c}'].std():.2f}"
        S[f"Compress{tag}"] = f"{P[f'compress_{c}'].mean():.3f}"
        S[f"Acc{tag}All"] = f"{PF[f'acc_{c}'].mean():.2f}"
        S[f"Compress{tag}All"] = f"{PF[f'compress_{c}'].mean():.3f}"
    for name, a in [("AccAov", acc_aov), ("SlopeAov", slope_aov)]:
        S[name] = (f"$F({a['df1']:.0f}, {a['df2']:.0f}) = {a['F']:.2f}$, $p_{{GG}} {fmt_p(a['p_gg'] if not np.isnan(a['p_gg']) else a['p'])}$, "
                   f"$\\eta^2_G = {a['np2']:.2f}$")
    return S


def export_excel(df, test, P, M, simulated):
    path = ROOT / "data" / ("constellations_dataset_SIMULATED.xlsx" if simulated else "constellations_dataset.xlsx")
    readme = pd.DataFrame({"field": ["acc_pos", "lev_sim", "prefix", "complexity", "cond", "sec_ok", "compress_<cond>", "as_flattening"],
                           "meaning": ["proportion of positions recalled in the correct serial position",
                                       "1 − Levenshtein distance / length (order-tolerant)", "correct items from the start before first error",
                                       "language-of-thought minimal description length of the sequence",
                                       "none = no load; as = articulatory suppression; tap = rhythmic tapping",
                                       "secondary-task compliance (1 = verified)", "accuracy lost per unit complexity (compression benefit)",
                                       "compress_tap − compress_as (> 0: suppression removes compression benefit)"]})
    with pd.ExcelWriter(path) as xw:
        readme.to_excel(xw, sheet_name="README", index=False)
        P.to_excel(xw, sheet_name="participants")
        df.to_excel(xw, sheet_name="all_trials", index=False)
        test.to_excel(xw, sheet_name="test_trials_clean", index=False)
        test.groupby(["pid", "cond"])[["acc_pos", "lev_sim", "recall_rt_ms"]].mean().to_excel(xw, sheet_name="condition_means")
        M.to_excel(xw, sheet_name="sequence_metrics", index=False)
    return path


def main():
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "raw"
    FIGS.mkdir(parents=True, exist_ok=True)
    TABS.mkdir(parents=True, exist_ok=True)
    df = load(data_dir)
    simulated = bool((df["mode"] == "sim").any())
    test, log, _ = exclusions(df)
    test_full = add_dl(df[df["phase"] == "test"].copy())   # every complete session, every test trial (no compliance filter)
    test = add_dl(test)
    # Two samples. The compliance rule concerns only the dual-task blocks, so it is applied only where conditions are compared:
    #  PF (everyone): the no-load compression effect, the complexity curve, metric comparison, practice/effort checks and
    #                 individual differences in no-load performance;
    #  P (compliant): every suppression-vs-tapping comparison; PF repeats the key contrast as a no-filter sensitivity check.
    PF = participants(df, test_full)
    P = participants(df, test)
    test = test[test["pid"].isin(P.index)]
    PF["in_condition_sample"] = PF.index.isin(P.index).astype(int)
    PF["as_flattening_compliant"] = P["as_flattening"].reindex(PF.index)
    it_full, it, M = items(test_full), items(test), metrics_table(test_full)

    h1 = one_sample(PF["compress_none"], "Compression benefit, no load > 0 (all)")
    h2 = {"HtwoAsTap": paired(P["compress_tap"], P["compress_as"], "Compression: tap − AS"),
          "HtwoNoneAs": paired(P["compress_none"], P["compress_as"], "Compression: none − AS"),
          "HtwoCostAsTap": paired(P["acc_tap"], P["acc_as"], "Accuracy: tap − AS"),
          "HtwoCostNoneTap": paired(P["acc_none"], P["acc_tap"], "Accuracy: none − tap"),
          "HthreeMetaAsTap": paired(P["meta_tap"], P["meta_as"], "Metacognition: tap − AS"),
          "HtwoAsTapDL": paired(P["compressdl_tap"], P["compressdl_as"], "Compression (DL scoring): tap − AS")}
    if "sec_max_gap_ms" in test:
        gap = pd.to_numeric(test["sec_max_gap_ms"], errors="coerce")
        P_strict = participants(df, test[~((test["cond"] == "as") & (gap > 1000))])
        h2["HtwoAsTapStrict"] = paired(P_strict["compress_tap"], P_strict["compress_as"], "Compression, strict AS filter: tap − AS")
    h2["HtwoAsTapUnfiltered"] = paired(PF["compress_tap"], PF["compress_as"], "Compression, all people, no filter: tap − AS")
    h2["HtwoCostAsTapAll"] = paired(PF["acc_tap"], PF["acc_as"], "Accuracy, all people, no filter: tap − AS")
    if "click_ms" in test_full:
        h2["HoneBoundary"] = one_sample(boundary_slowing(test_full, pooled=True).reindex(PF.index),
                                        "Chunk-boundary slowing (ms, rounds pooled) > 0 (all)")
        BS = boundary_slowing(test).reindex(P.index)
        if not BS.empty and {"as", "tap"} <= set(BS.columns):
            h2["HtwoBoundaryAsTap"] = paired(BS["tap"], BS["as"], "Boundary slowing (ms): tap − AS")
    rounds = test_full.groupby(["pid", "block"])["acc_pos"].mean().unstack()   # practice check: do people improve across rounds?
    if {1, 3} <= set(rounds.columns):
        h2["CheckPractice"] = paired(rounds[3], rounds[1], "Practice: round 3 − round 1 accuracy (all)")
    if {"effort_as", "effort_tap"} <= set(PF.columns):
        h2["CheckEffortAsTap"] = paired(pd.to_numeric(PF["effort_as"], errors="coerce"), pd.to_numeric(PF["effort_tap"], errors="coerce"),
                                        "Rated effort: AS − tap (all)")
        h2["CheckEffortAsNone"] = paired(pd.to_numeric(PF["effort_as"], errors="coerce"), pd.to_numeric(PF["effort_none"], errors="coerce"),
                                         "Rated effort: AS − no load (all)")
    acc_aov, slope_aov = rm_anova(P, "acc"), rm_anova(P, "compress")
    power_full = TTestPower().solve_power(nobs=len(PF), alpha=.05, power=.8)
    power_comp = TTestPower().solve_power(nobs=len(P), alpha=.05, power=.8)
    S = report_numbers(PF, P, log, h1, h2, acc_aov, slope_aov, power_full, power_comp)

    PI = PF.drop(columns=["as_flattening"]).rename(columns={"as_flattening_compliant": "as_flattening"})   # flattening only for compliant people
    G, mc, C, D = gee(it), metric_comparison(it_full, M), correlations(PI), group_diffs(PI)
    B = bayes_glmm(it)
    acc_by_k = test_full.groupby("complexity")["acc_pos"].agg(["mean", "size"])
    S["AccKFive"], S["AccKSixteen"] = f"{acc_by_k.loc[5, 'mean']:.2f}", f"{acc_by_k.loc[16, 'mean']:.2f}"
    S["BestMetric"], S["LoTdAIC"] = mc["metric"].iloc[0], f"{mc.loc[mc['metric'] == 'LoT complexity', 'dAIC'].iat[0]:.1f}"

    tests = pd.DataFrame([h1, *h2.values()])
    tests = tests[tests["n"] >= MIN_N_TEST]
    fmt_t = {"n": lambda v: f"{v:.0f}", "df": lambda v: "--" if np.isnan(v) else f"{v:.0f}",
             "p": lambda v: "--" if np.isnan(v) else (fmt_p(v)[2:] if v >= .001 else "<.001"), "BF10": lambda v: f"${fmt_bf(v)}$"}
    (TABS / "tests.tex").write_text(tex_table(tests, {"label": "Contrast", "n": "$n$", "M": "$M$", "SD": "$SD$", "t": "$t$", "df": "$df$", "p": "$p$", "d": "$d_z$", "BF10": "BF$_{10}$"},
                                              "Planned contrasts (participant level). ``All'': every participant, no compliance filter; other rows: the compliant sample. $d_z$ = mean difference / SD of differences.",
                                              "tab:tests", fmt_t, wide=True))
    G = G.reset_index().rename(columns={"index": "term"})
    G["term"], B["term"] = G["term"].map(pretty), B["term"].map(pretty)
    (TABS / "glmm.tex").write_text(tex_table(B, {"term": "Term", "mean": "Posterior mean", "sd": "Posterior SD", "lo": "2.5\\%", "hi": "97.5\\%"},
                                             "Bayesian logistic GLMM (variational Bayes; compliant sample); random intercepts for participants and sequences, random complexity slopes for participants (reference: tapping).", "tab:glmm"))
    (TABS / "gee.tex").write_text(tex_table(G, {"term": "Term", "b": "$b$", "se": "SE", "z": "$z$", "p": "$p$", "OR": "OR"},
                                            "Item-level logistic GEE (compliant sample; reference: tapping).", "tab:gee", {"p": lambda v: fmt_p(v)[2:] if v >= .001 else "<.001"}))
    (TABS / "metrics.tex").write_text(tex_table(mc, {"metric": "Metric", "AIC": "AIC", "dAIC": "$\\Delta$AIC", "r_seq": "$r_{\\text{seq}}$"},
                                                "Which complexity metric best predicts recall? (all participants)", "tab:metrics"))
    pretty_var = {"acc_none": "Accuracy, no load", "acc_all": "Accuracy, all rounds", "compress_none": "Compression, no load",
                  "as_flattening": "Suppression flattening", "age": "Age", "maths": "Maths level", "sleep_h": "Sleep (h)",
                  "gaming_hpw": "Gaming (h/week)", "languages_n": "Languages", "irqf_verbal": "Inner speech (IRQ)"}
    if len(C):
        C = C.assign(x=C["x"].map(lambda v: pretty_var.get(v, v)), y=C["y"].map(lambda v: pretty_var.get(v, v)))
        (TABS / "corr.tex").write_text(tex_table(C, {"x": "Measure", "y": "Correlate", "n": "$n$", "r": "$r$", "CI": "95\\% CI", "p": "$p$", "p_holm": "$p_{\\text{Holm}}$", "BF10": "BF$_{10}$", "rho": "$\\rho$"},
                                                 "Exploratory individual-difference correlations (Pearson $r$, Spearman $\\rho$).", "tab:corr", {"n": str, "CI": lambda v: f"[{v[0]:.2f}, {v[1]:.2f}]", "BF10": lambda v: f"${fmt_bf(v)}$"}, wide=True))
    if len(D):
        D = D.assign(y=D["y"].map(lambda v: pretty_var.get(v, v)), group=D["group"].str.replace("stem: 1 vs 0", "STEM vs non-STEM").str.replace("gender: ", ""))
        (TABS / "groups.tex").write_text(tex_table(D, {"group": "Groups", "y": "Measure", "n": "$n$", "Ma": "$M_a$", "Mb": "$M_b$", "t": "$t$", "p": "$p$", "g": "$g$", "BF10": "BF$_{10}$"},
                                                   "Exploratory group differences (Welch $t$-tests, Hedges' $g$).", "tab:groups", {"p": lambda v: fmt_p(v)[2:] if v >= .001 else "<.001", "BF10": lambda v: f"${fmt_bf(v)}$"}, wide=True))
    write_macros(S, simulated)

    fig_curve(test_full, simulated)
    fig_paired(P, "acc", "Mean recall accuracy", "fig_accuracy", simulated)
    fig_paired(P, "compress", "Compression benefit\n(accuracy lost per complexity unit)", "fig_compression", simulated)
    fig_paired(P, "meta", "Metacognitive sensitivity\n(confidence–accuracy ρ)", "fig_meta", simulated)
    fig_serial(it_full, simulated)
    fig_metrics(mc, simulated)
    fig_individual(PI, simulated)
    xlsx = export_excel(df, test, PF, M, simulated)
    (OUT / "summary.json").write_text(json.dumps({"log": log, "simulated": simulated, "n_all": len(PF), "n_compliant": len(P), "xlsx": str(xlsx)}, indent=2))
    print(json.dumps({"log": log, "simulated": simulated, "N_all": len(PF), "N_compliant": len(P), **{k: S[k] for k in ["HoneStat", "AccAov", "SlopeAov"]}}, indent=2))


if __name__ == "__main__":
    main()
