# ✦ Constellations, explained

Everything you need to explain our task in class, defend it, and report it properly. Read this once and you'll be able to
answer almost any question the professor throws at you.

## The idea in 30 seconds

Your memory doesn't store things dot by dot. It **compresses** them, like a zip file. "Go round the circle in steps of two,
then do it again shifted by one" is much shorter than eight separate positions, so patterned paths are easier to remember.
Researchers (Dehaene's lab in Paris) showed you can measure that compression exactly: the length of the shortest "mental
program" that draws the path predicts how hard it is to remember.

**Our question:** is that mental program written in words? If you secretly describe the pattern to yourself ("square, then
another square"), then keeping your inner voice busy should wipe out the advantage of simple paths. If the mind compresses
without words, as a big 2024 *Nature* paper argues, simple paths should stay easy even while you talk.

## One trial, step by step (this covers everything the brief asks for)

| Step | What happens | Brief's term |
|---|---|---|
| Start | Participant presses Start and begins the round's extra task (nothing, saying "the", or tapping) | |
| Lead-in | 500 ms with the extra task running | |
| **Fixation** | A **+** in the centre for **500 ms** | fixation time |
| **Stimuli** | All 8 stars flash one at a time in a set order, **200 ms each, one every 700 ms** (timing from Al Roumi et al., 2021) | stimulus type: spatial sequence |
| **Delay** | **2 s** retention gap, extra task still running | delay in recall |
| **Recall** | Click the stars in the same order (undo allowed) | recall |
| Confidence | "How sure are you?" 1 to 4 | |

**Interference** is the round type, and everyone does all three, in a rotated order:

| Round | What they do while watching and waiting | Why it's there |
|---|---|---|
| Just remember | Nothing | Baseline |
| Say "the" | Softly repeat "the" about twice a second (articulatory suppression) | Keeps the inner voice busy, so no silent describing |
| Tap along | Tap Space about twice a second | Just as distracting, but leaves the inner voice free. This is the fair comparison for "say the" |

Each person gets **5 of our 14 paths**: the easiest (K = 5) and the hardest (K = 16) for everyone, plus one of four sets
of three that cover the middle. They get the same 5 in every round, in random order, each rotated or mirrored at random so
people can't memorise positions. A full session is 15 test paths plus a few warm-ups, about 10 minutes.

## The key measure: path complexity (K)

K is the length of the shortest program that draws a path in Dehaene's geometry language (Amalric et al., 2017). The
language has moves like "step +2 around the circle" or "mirror across the vertical", plus "repeat" (which is cheap).

| Path | Looks like | Shortest program | K |
|---|---|---|---|
| repeat | 0 1 2 3 4 5 6 7, straight round the circle | "step +1, repeat 7 times" | 5 |
| 2squares | 0 2 4 6 then 7 1 3 5 | "a square of +2 steps, then the same square shifted by one" | 8 |
| irregular | 0 2 5 1 7 6 3 4 | no shortcut, every move written out | 16 |

Our 14 paths cover K = 5 to 16. Nine come straight from the published studies. Five fill the gaps in between. We wrote a
program (`analysis/lot_complexity.py`) that computes K and checks itself against all 11 values published in the original
paper. It matches every one.

**Why rotating or mirroring keeps K the same:** turning or flipping the whole octagon just swaps moves for equivalent ones
(+2 becomes −2, one mirror becomes another), and they all cost the same. Our program confirms this for every rotation
and reflection.

## Every metric we report

| Metric | Plain meaning | How it's computed | Report it like |
|---|---|---|---|
| **Accuracy** | How much of the path they got right | Share of the 8 positions recalled in the correct place (0 to 1) | "M = .72, SD = .11" per round |
| **Compression benefit** | How much harder each extra unit of complexity makes recall | Per person and round: the slope of accuracy against K, sign flipped so bigger means "patterns help more" | "accuracy fell by 3.1 points per complexity unit" |
| **Suppression flattening** | Does saying "the" shrink the pattern advantage? | Compression benefit when tapping minus when saying "the" | Paired t test, effect size dz, Bayes factor |
| **Dual-task cost** | How much each extra task hurts overall | Accuracy in "just remember" minus each other round | Paired t tests |
| **Boundary slowing** | People pause where a mental program starts a new chunk (for example between the two squares) | Average time between clicks entering a new chunk minus within a chunk, in ms | "clicks slowed by 70 ms at chunk boundaries" |
| **Metacognition** | Do people know when they got it right? | Correlation between confidence and accuracy, per person and round | Paired t test, saying "the" vs tapping |
| **Effort** (check) | Were "the" and tapping equally demanding? | 1 to 7 rating after each round | If similar, the comparison is fair |
| **Compliance** (check) | Did they really keep talking or tapping? | Mic loudness every 50 ms (no recording) and tap timing | % of trials that passed |
| **Inner voice score** | How much someone thinks in words | Mean of 12 published questionnaire items (Roebuck & Lupyan, 2020), 1 to 5 | Correlate with suppression flattening |
| **Best complexity measure** | Is K really the best predictor, or would something simpler do? | Compare K with 5 simpler measures (path length, crossings, and so on) by AIC, lower is better | "K fitted best (ΔAIC = 0)" |

## The statistics, in plain language

- **Paired t test**: everyone does every round, so we compare each person with themselves. Report t, df, p and **dz** (the
  effect size: 0.2 small, 0.5 medium, 0.8 large).
- **Repeated-measures ANOVA**: tests all three rounds at once (Greenhouse-Geisser corrected).
- **Bayes factor (BF10)**: how strongly the data favour "there is a difference" over "there isn't". BF10 > 3 is evidence
  **for** a difference, BF10 < 1/3 is evidence **against** one, in between means "not enough data to say". This is how we
  can report a no-difference result properly instead of just "not significant".
- **Mixed models** (GEE and a Bayesian GLMM): the same questions asked at the level of every single click, which uses all the
  data and also accounts for people getting better across rounds.
- **What 20 to 25 people can detect**: within-person effects of about dz ≥ 0.6. Group comparisons (men vs women, STEM vs
  not) need huge differences at this size, so we label them exploratory.

## What we expect, and what each result would mean

| If we find... | It means... |
|---|---|
| Accuracy drops as K rises (we expect this, it's very reliable) | People compress paths, replicating Dehaene's lab in a new recall format |
| The pattern advantage is **the same** under "the" and tapping (BF10 < 1/3) | The mind compresses **without words**. Supports Fedorenko et al. (2024, *Nature*): thinking doesn't need language |
| The pattern advantage **shrinks** only under "the" | People silently **describe** patterns to remember them. Language helps compression |
| It shrinks only for people with a strong inner voice | Different minds use different strategies: words for some, pure geometry for others |
| Saying "the" lowers accuracy overall but leaves the slope alone | The inner voice is busy, but compression doesn't depend on it |

Every row is an interesting, reportable conclusion. That's what makes this a strong design.

## What's new about our task (the bonus marks bit)

- Nobody has crossed **graded geometric complexity** with **saying "the" versus a matched tapping task**, or linked it to
  **inner-voice differences**. Our literature checks (two research agents plus three Gemini deep-research reports) found no
  study doing this.
- A 2026 preprint (Tabbane et al.) showed complexity predicts recall of spatial sequences, but it used no interference and no
  inner-voice measure. We build on it and cite it honestly.
- We **verify** that people actually talk, using the microphone's loudness (never recording). Classic studies just trusted
  people. Our friend's task research even ruled out a task because "we can't check that people really speak aloud". We can.

## Questions you might get, and good answers

- **"Isn't this just the Corsi block task?"** The clicking is similar, but Corsi uses random paths and asks how many you can
  hold. We grade every path by an exact complexity score and ask *how* people compress them.
- **"Why say 'the'?"** It's the classic way to occupy the inner voice (Baddeley's phonological loop). A meaningless word
  blocks silent rehearsal without adding new information.
- **"Why have a tapping round?"** Doing any two things at once is harder. Tapping matches that general load, so only the
  *difference* between "the" and tapping can be blamed on the inner voice.
- **"How do you know they actually spoke?"** The mic checks loudness every 50 ms against a calibration of their own voice,
  and also logs the longest silence. Trials where they stopped are flagged and analysed both with and without them.
- **"Why do people get the same paths three times?"** So every round is compared on identical material. Rotating and
  mirroring stop them recognising positions, the round order is rotated across people, and the analysis accounts for
  improvement across rounds.
- **"What if you find nothing?"** Bayes factors let us say whether the data actively support "no difference", which is itself
  a meaningful conclusion (row 2 of the table above).
- **"What's the cross for?"** It's a fixation point, always in the exact centre, shown for 500 ms right before the first star.
  It brings everyone's eyes to the same spot, equally far from all 8 stars, so no star gets a head start, and it warns that
  the sequence is about to begin so nobody misses the first flash. It's a fixed setting, not something we vary.
- **"Why does each person only see 5 of the 14 paths?"** To keep the session to about 10 minutes, which means more people
  finish it and we can recruit more of them. Everyone gets the easiest and the hardest path, and each set of three covers
  the middle, so every person's paths still span the whole complexity range, and that range is what their compression
  score is measured on. Across people all 14 paths are used, so the path-level analyses (like which complexity measure
  fits best) still see every path. And each person sees the same 5 paths in all three rounds, so "the" versus tapping is
  always compared on identical paths.

## Limitations we own up to

- Saying "the" blocks silent rehearsal, not all of language, so we conclude about the inner voice specifically.
- About 20 to 25 people: great for within-person effects, too few for firm conclusions about gender or course.
- Mostly college students, so age effects are hard to see unless we also include school students (the form has options
  for Class 8 to 12) and some older participants.
- We don't track eye movements, so some people may rehearse by looking around.
- Simple shapes are also easy to name, so "easy to compress" and "easy to name" overlap a little.
- Each person does 5 paths per round, so one person's own scores (metacognition most of all, a correlation over just 5
  trials) are noisy. The group tests and the mixed models are what to lean on.

## Key references

Amalric et al. (2017), *PLOS Computational Biology* · Al Roumi et al. (2021), *Neuron* · Planton et al. (2021), *PLOS
Computational Biology* · Fedorenko, Piantadosi & Gibson (2024), *Nature* · Baddeley, Lewis & Vallar (1984) · Roebuck &
Lupyan (2020), *Behavior Research Methods* · Nedergaard & Lupyan (2024), *Psychological Science* · Tabbane et al. (2026),
bioRxiv. Full list with DOIs in `report/refs.bib`.
