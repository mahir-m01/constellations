'use strict';
/*
  CONSTELLATIONS — does the mind's compression code need words?
  8 "stars" on a regular octagon. A path of flashes is shown; the participant clicks the stars in the same order.
  Paths are graded by language-of-thought (LoT) complexity (minimal description length; Amalric et al., 2017).
  3 within-subject blocks (order counterbalanced):
    none — just remember
    as   — articulatory suppression: say "the" aloud ~2/s during encoding + retention (microphone loudness check, nothing recorded)
    tap  — rhythmic tapping on Space / touch pad ~2/s (matched dual-task control)
  Every trial applies a random rotation/reflection, which preserves LoT complexity but changes the absolute locations.
  ?demo → short version (rows flagged mode=demo) · ?pid=X → experimenter ID · ?order=0..5 → block order
*/

const CFG = {
  SHEET_URL: '',                    // Google Apps Script web-app URL (see apps-script.gs). Empty → CSV download only.
  LEAD_MS: 1000,                    // secondary task runs this long before the first flash
  ON_MS: 200, OFF_MS: 500,          // 200 ms flash, 700 ms SOA (Al Roumi et al., 2021, behavioural training phase)
  RETENTION_MS: 2000,
  PRACTICE_PER_BLOCK: 2,
  MIN_COVERAGE: 0.8,                // compliance: share of windows with voice (AS) or a tap (tap)
  R: 72,                            // star ring radius (SVG units, viewBox ±100)
};
const QS = new URLSearchParams(location.search);
const DEMO = QS.has('demo');
const TOUCH = matchMedia('(pointer: coarse)').matches;

// Stimulus set: 9 published octagon sequences (Amalric et al., 2017, S1 Text Fig 2; Al Roumi et al., 2021) plus
// 5 sequences filling K = 9, 11–14 (seeded random draw from the enumeration of all 5040 origin-fixed sequences).
// k = LoT minimal description length, computed by analysis/lot_complexity.py (reproduces all published values; invariant
// under the rotations/reflections applied on each trial). Vertices 0–7 clockwise from the top.
const SEQS = [
  { name: 'repeat', v: [0, 1, 2, 3, 4, 5, 6, 7], k: 5 },
  { name: '4segments', v: [0, 1, 7, 2, 6, 3, 5, 4], k: 7 },
  { name: '4diagonals', v: [0, 4, 1, 5, 2, 6, 3, 7], k: 7 },
  { name: '2crosses', v: [0, 4, 5, 1, 2, 6, 7, 3], k: 7 },
  { name: 'alternate', v: [0, 3, 2, 5, 4, 7, 6, 1], k: 7 },
  { name: '2arcs', v: [0, 1, 2, 3, 7, 6, 5, 4], k: 8 },
  { name: '2squares', v: [0, 2, 4, 6, 7, 1, 3, 5], k: 8 },
  { name: 'k9', v: [0, 1, 7, 6, 5, 4, 3, 2], k: 9 },
  { name: '2rectangles', v: [0, 5, 4, 1, 6, 3, 2, 7], k: 10 },
  { name: 'k11', v: [0, 3, 6, 1, 2, 5, 4, 7], k: 11 },
  { name: 'k12', v: [0, 4, 7, 2, 1, 3, 6, 5], k: 12 },
  { name: 'k13', v: [0, 5, 6, 3, 4, 7, 1, 2], k: 13 },
  { name: 'k14', v: [0, 5, 6, 4, 7, 1, 3, 2], k: 14 },
  { name: 'irregular', v: [0, 2, 5, 1, 7, 6, 3, 4], k: 16 },
];
// Internal Representations Questionnaire, Internal Verbalization factor (Roebuck & Lupyan, 2020, Table 2), verbatim.
const IRQ = [
  'I think about problems in my mind in the form of a conversation with myself',
  'If I am walking somewhere by myself, I often have a silent conversation with myself',
  "If I am walking somewhere by myself, I frequently think of conversations that I've recently had",
  'My inner speech helps my imagination',
  'I tend to think things through verbally when I am relaxing',
  'When thinking about a social problem, I often talk it through in my head',
  'I like to give myself some down time to talk through thoughts in my mind',
  'I hear words in my “mind\'s ear” when I think',
  'I rarely vocalize thoughts in my mind',
  'I often talk to myself internally while watching TV',
  "My memories often involve conversations I've had",
  'When I read, I tend to hear a voice in my “mind\'s ear”',
].map((text, i) => ({ id: `v${i + 1}`, text, factor: 'verbal', reverse: i === 8 }));

const CONDS = ['none', 'as', 'tap'];
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// ---------- utilities ----------
const $stage = document.getElementById('stage');
const $bar = document.querySelector('#bar > div');
const el = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));
const until = (t0, ms) => sleep(Math.max(0, t0 + ms - performance.now()));
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const pct = x => `${Math.round(x * 100)}%`;
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const r3 = x => Math.round(x * 1000) / 1000;

let onKey = null;
document.addEventListener('keydown', e => { if (onKey && !e.repeat) onKey(e); });
let focusLosses = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) focusLosses++; });

const show = html => { $stage.innerHTML = html; return frame(); };

function screen(html, btn = 'Continue') {
  return new Promise(async res => {
    await show(`<div class="card">${html}<div class="row"><button class="primary" id="go">${btn} <kbd>Enter</kbd></button></div></div>`);
    const go = () => { onKey = null; res(); };
    el('go').onclick = go;
    onKey = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  });
}

function form(html) {
  return new Promise(async res => {
    await show(`<form class="card" id="f">${html}<div class="row"><button class="primary">Continue</button></div></form>`);
    el('f').onsubmit = e => { e.preventDefault(); res(Object.fromEntries(new FormData(e.target))); };
  });
}

// ---------- scoring ----------
const levenshtein = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
const score = (seq, resp) => ({
  acc_pos: seq.filter((v, i) => resp[i] === v).length / seq.length,           // strict serial position
  lev_sim: 1 - levenshtein(seq, resp) / Math.max(seq.length, resp.length),     // order-tolerant similarity
  prefix: (seq.findIndex((v, i) => resp[i] !== v) + seq.length + 1) % (seq.length + 1), // correct run from the start
});

// rotation r (0–7) and optional mirror: a symmetry of the octagon, so LoT complexity is unchanged
const transform = (v, rot, mirror) => v.map(x => (((mirror ? -x : x) + rot) % 8 + 8) % 8);

// ---------- secondary tasks ----------
const Mic = { an: null, buf: null, thr: Infinity };
const level = () => { Mic.an.getFloatTimeDomainData(Mic.buf); let s = 0; for (const x of Mic.buf) s += x * x; return Math.sqrt(s / Mic.buf.length); };

// Starts monitoring the block's secondary task; stop() returns compliance statistics for the window.
function monitor(cond) {
  const t0 = performance.now(), levels = [], taps = [];
  const meter = el('meter'), fill = meter.firstElementChild;
  let timer = null;
  if (cond === 'as' && Mic.an) {
    meter.style.visibility = 'visible';
    timer = setInterval(() => {
      const l = level();
      levels.push([performance.now() - t0, l]);
      fill.style.width = `${Math.min(100, (l / Mic.thr) * 60)}%`;
      meter.classList.toggle('ok', l > Mic.thr);
    }, 50);
  }
  if (cond === 'tap') {
    meter.style.visibility = 'visible';
    const tap = () => { taps.push(performance.now() - t0); fill.style.width = '100%'; meter.classList.add('ok'); setTimeout(() => { fill.style.width = '0'; }, 120); };
    onKey = e => { if (e.key === ' ') { e.preventDefault(); tap(); } };
    if (TOUCH) { el('pad').style.display = 'flex'; el('pad').onpointerdown = tap; }
  }
  return {
    stop() {
      clearInterval(timer); onKey = null;
      meter.style.visibility = 'hidden'; el('pad').style.display = 'none';
      const dur = performance.now() - t0;
      if (cond === 'as') {
        if (!Mic.an) return { sec_coverage: '', sec_level: '', sec_ok: '' };
        const nWin = Math.floor(dur / 500);
        const voiced = new Set(levels.filter(([, l]) => l > Mic.thr).map(([t]) => Math.floor(t / 500)));
        const cov = [...voiced].filter(w => w < nWin).length / nWin;
        const on = [0, ...levels.filter(([, l]) => l > Mic.thr).map(([t]) => t), dur];
        const maxGap = Math.round(Math.max(...on.slice(1).map((t, i) => t - on[i])));
        return { sec_coverage: r3(cov), sec_level: r3(mean(levels.map(([, l]) => l))), sec_max_gap_ms: maxGap, sec_ok: +(cov >= CFG.MIN_COVERAGE) };
      }
      if (cond === 'tap') {
        const nWin = Math.floor(dur / 1000);
        const cov = new Set(taps.map(t => Math.floor(t / 1000)).filter(w => w < nWin)).size / nWin;
        const rate = taps.length / (dur / 1000);
        const iti = taps.slice(1).map((t, i) => t - taps[i]);
        const cv = iti.length > 1 ? Math.sqrt(mean(iti.map(x => (x - mean(iti)) ** 2))) / mean(iti) : '';
        return { sec_coverage: r3(cov), sec_rate: r3(rate), sec_cv: cv === '' ? '' : r3(cv), sec_ok: +(cov >= CFG.MIN_COVERAGE && rate >= 1) };
      }
      return {};
    },
  };
}

// 90th-percentile loudness over a window, with a live meter
async function capture(text, ms) {
  await show(`<div class="card" style="text-align:center"><h2>${text}</h2>
    <div class="row"><div class="meter" id="meter" style="visibility:visible"><div></div></div></div></div>`);
  const fill = el('meter').firstElementChild, ls = [], t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const l = level(); ls.push(l);
    fill.style.width = `${Math.min(100, l * 800)}%`;
    await sleep(50);
  }
  return quantile(ls, 0.9);
}

async function micSetup() {
  await screen(`<h2>Microphone check</h2>
    <p>In one block you'll softly repeat the word <b>“the”</b>. It's a classic memory-research trick to keep your inner voice
    busy. A quiet, normal voice is perfect; no need to be loud.</p>
    <p class="muted">The microphone is used only to measure
    <b>how loud</b> it is around you, live in your browser — <b>nothing is recorded, stored or sent</b>.</p>
    <p>Click Continue and allow microphone access when asked.</p>`);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = new AudioContext();
    await ctx.resume();
    Mic.an = ctx.createAnalyser();
    Mic.an.fftSize = 1024;
    Mic.buf = new Float32Array(Mic.an.fftSize);
    ctx.createMediaStreamSource(stream).connect(Mic.an);
  } catch {
    await screen(`<h2>No microphone</h2><p>That's OK — please still follow the “say the” instructions honestly when they appear.</p>`);
    return { mic_ok: 0 };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const base = await capture('Stay quiet for 3 seconds…', 3000);
    const voice = await capture('Now softly say “the… the… the…” in your normal voice', 4000);
    if (voice > 3 * base && voice > 0.01) {
      Mic.thr = base + 0.35 * (voice - base);
      return { mic_ok: 1, mic_base: r3(base), mic_voice: r3(voice), mic_thr: r3(Mic.thr), mic_attempts: attempt };
    }
    await screen(`<h2>Let's try that again</h2><p>We couldn't hear a clear difference between quiet and speaking.
      Move a little closer to the microphone or find a quieter spot.</p>`, 'Try again');
  }
  Mic.an = null;
  return { mic_ok: 0, mic_attempts: 3 };
}

// ---------- trial ----------
const xy = v => { const a = (90 - 45 * v) * Math.PI / 180; return [CFG.R * Math.cos(a), -CFG.R * Math.sin(a)]; };
const skyHTML = () => `<div class="sky" id="sky">
  <svg viewBox="-100 -100 200 200" aria-label="eight stars">
    ${[...Array(8)].map((_, v) => { const [x, y] = xy(v); return `<circle class="star" data-v="${v}" id="s${v}" cx="${x}" cy="${y}" r="7"/><text class="num" id="n${v}" x="${x}" y="${y}"></text>`; }).join('')}
  </svg>
  <div class="msg" id="msg"></div>
  <div class="meter" id="meter"><div></div></div>
  <div class="pad" id="pad">tap here</div></div>`;
const setMsg = html => { el('msg').innerHTML = html; };
const lit = (v, on) => el(`s${v}`).classList.toggle('lit', on);

function waitStart(cond) {
  const hint = { none: 'Watch the stars.', as: 'When you press Start, start softly saying <b>“the… the… the…”</b>', tap: `When you press Start, begin tapping ${TOUCH ? 'the pad' : '<kbd>Space</kbd>'} steadily.` }[cond];
  setMsg(`<div class="muted">${hint}</div><button class="primary" id="start">Start <kbd>Enter</kbd></button>`);
  return new Promise(res => {
    const go = () => { onKey = null; res(); };
    el('start').onclick = go;
    onKey = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  });
}

function recall(n) {
  return new Promise(res => {
    const resp = [], times = [], onset = performance.now();
    el('sky').classList.add('pick');
    const render = () => [...Array(8)].forEach((_, v) => { el(`n${v}`).textContent = resp.lastIndexOf(v) >= 0 ? resp.lastIndexOf(v) + 1 : ''; });
    const undo = () => { resp.pop(); times.pop(); render(); };
    const add = v => {
      if (resp.length >= n) return;
      resp.push(v); times.push(Math.round(performance.now() - onset)); render();
      if (resp.length === n) {
        onKey = null;
        el('sky').classList.remove('pick');
        setTimeout(() => res({ resp, times, rt: times.at(-1) }), 300);
      }
    };
    document.querySelectorAll('.star').forEach(s => { s.onpointerdown = () => add(+s.dataset.v); });
    el('undo').onclick = undo;
    onKey = e => { if (e.key === 'Backspace') { e.preventDefault(); undo(); } };
  });
}

function confidence() {
  const labels = ['Guess', 'Unsure', 'Fairly sure', 'Certain'];
  setMsg(`How sure are you that you got the order right?<div class="row" style="margin-top:.4rem">${labels.map((l, i) =>
    `<button data-c="${i + 1}">${l} <kbd>${i + 1}</kbd></button>`).join('')}</div>`);
  return new Promise(res => {
    const pick = c => { onKey = null; res(c); };
    document.querySelectorAll('[data-c]').forEach(b => { b.onclick = () => pick(+b.dataset.c); });
    onKey = e => { if ('1234'.includes(e.key)) pick(+e.key); };
  });
}

async function runTrial(item, cond, meta) {
  const rot = Math.floor(Math.random() * 8), mirror = Math.random() < 0.5;
  const seq = transform(item.v, rot, mirror);
  await show(skyHTML());
  await waitStart(cond);
  setMsg({ none: 'Remember the order…', as: 'Keep it going: “the… the… the…”', tap: 'Keep tapping steadily…' }[cond]);
  const mon = monitor(cond);
  let on = await frame();
  await until(on, CFG.LEAD_MS);
  for (const v of seq) {
    lit(v, true); on = await frame(); await until(on, CFG.ON_MS);
    lit(v, false); on = await frame(); await until(on, CFG.OFF_MS);
  }
  await until(on, CFG.RETENTION_MS);
  const sec = mon.stop();
  setMsg(`${cond === 'none' ? '' : '<b>Stop.</b> '}Click the stars in the order they lit up.
    <div class="row" style="margin-top:.4rem"><button id="undo">Undo <kbd>⌫</kbd></button></div>`);
  const r = await recall(seq.length);
  const conf = await confidence();
  const s = score(seq, r.resp);
  const warn = sec.sec_ok === 0 ? (cond === 'as' ? 'We lost you for a moment. Just keep a soft “the… the…” going until it\'s time to answer.' : 'Just keep a steady tap going until it\'s time to answer.') : '';
  setMsg(`<b>${Math.round(s.acc_pos * seq.length)} / ${seq.length}</b> in the right order
    ${warn ? `<div style="color:var(--bad)">${warn}</div>` : ''}`);
  await sleep(warn ? 2200 : 1100);
  return {
    ...meta, cond, seq_name: item.name, complexity: item.k ?? '', rot, mirror: +mirror,
    seq: seq.join(' '), canonical: item.v.join(' '), response: r.resp.join(' '),
    acc_pos: r3(s.acc_pos), lev_sim: r3(s.lev_sim), prefix: s.prefix, recall_rt_ms: r.rt, click_ms: r.times.join(' '), confidence: conf,
    sec_coverage: '', sec_level: '', sec_max_gap_ms: '', sec_rate: '', sec_cv: '', sec_ok: '', ...sec,
    focus_losses: focusLosses, t: new Date().toISOString(),
  };
}

const randomPerm = () => ({ name: 'practice', v: shuffle([...Array(8).keys()]), k: null });

// ---------- session ----------
const TEST_SEQS = DEMO ? SEQS.slice(0, 2) : SEQS;
const COND_COLOR = { none: '#6c8cff', as: '#ff6b6b', tap: '#3ecf8e' };
const COND_LABEL = { none: 'Just remember', as: 'Saying “the”', tap: 'Tapping' };
const BLOCK_INTRO = {
  none: `<h2>Block: just remember</h2><p>Simply watch the stars and remember the order. Stay silent.</p>`,
  as: `<h2>Block: say “the”</h2><p>This block has a little twist. From the moment you press Start until the stars ask for your
    answer, softly repeat the word <b>“the”</b>, about twice a second: “the… the… the…”. A quiet, normal voice is perfect.</p>
    <p class="muted">Why? Repeating a word keeps your inner voice busy, a classic trick in memory research. It feels a bit odd
    for the first round or two, then it's easy. The bar under the stars turns green when we can hear you.</p>`,
  tap: `<h2>Block: tap</h2><p>From the moment you press Start until the stars ask for your answer, keep tapping
    ${TOUCH ? 'the pad under the stars' : '<kbd>Space</kbd> with your left hand'} steadily, about <b>twice a second</b>.
    ${TOUCH ? '' : 'Click the stars with your right hand.'}</p>`,
};

async function consentAndDemographics() {
  await form(`<h1>Constellations</h1>
    <p>A short memory experiment for a cognitive psychology research project (about <b>20 minutes</b>). Stars light up one
    after another; you click them in the same order. In one block you'll softly repeat a word while you play, and in another
    you'll tap a key, so pick a spot where speaking quietly feels comfortable.</p>
    <p class="muted">Participation is voluntary; you can stop at any time by closing this tab. We record your clicks, response
    times, the answers on the next pages and — in one block — only the <b>loudness</b> level of your microphone (no audio is
    recorded). Your email is used only to identify duplicate entries and is removed before analysis; results are reported
    only as group averages.</p>
    <p class="muted">Please use a laptop with a mouse if possible, in a quiet place where you can speak aloud, and take part only once.</p>
    <label><input type="checkbox" name="consent" required>I agree to take part.</label>`);
  const f = await form(`<h2>About you</h2>
    <label>Email</label><input name="email" type="email" required autocomplete="email">
    <label>Age</label><input name="age" type="number" min="10" max="99" required>
    <label>Gender</label><select name="gender" required><option value="">—</option>
      <option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select>
    <label>Course / programme (e.g. B.Sc. Psychology)</label><input name="course" required maxlength="80">
    <label>Field of study</label><select name="stream" required><option value="">—</option>
      <option value="stem">Science / Engineering / Technology / Maths</option>
      <option value="health">Medicine / Health sciences</option>
      <option value="commerce">Commerce / Management / Economics</option>
      <option value="arts">Arts / Humanities / Social sciences</option>
      <option value="other">Other / not a student</option></select>
    <label>Year of study</label><select name="year" required><option value="">—</option>
      <option>1</option><option>2</option><option>3</option><option>4</option><option>5+</option>
      <option>Postgraduate</option><option>Not a student</option></select>
    <label>Highest level of mathematics you have studied</label><select name="maths" required><option value="">—</option>
      <option value="1">Up to Class 10 / GCSE</option><option value="2">Class 12 / A-level</option>
      <option value="3">Some university maths</option><option value="4">Maths-heavy degree (engineering, physics, maths…)</option></select>
    <label>How many languages can you speak fluently?</label><input name="languages_n" type="number" min="1" max="10" required>
    <label>Is English your first language?</label><select name="english_l1" required><option value="">—</option>
      <option value="1">Yes</option><option value="0">No</option></select>
    <label>Hours of sleep last night</label><input name="sleep_h" type="number" min="0" max="16" step="0.5" required>
    <label>Video gaming per week</label><select name="gaming_hpw" required><option value="">—</option>
      <option value="0">None</option><option value="2">1–3 h</option><option value="5.5">4–7 h</option>
      <option value="11">8–14 h</option><option value="20">15 h or more</option></select>
    <label>What will you click with?</label><select name="input" required><option value="">—</option>
      <option value="mouse">Mouse</option><option value="trackpad">Trackpad</option><option value="touch">Touchscreen</option></select>`);
  document.documentElement.requestFullscreen?.().catch(() => {});
  return {
    pid: QS.get('pid') || Math.random().toString(36).slice(2, 8).toUpperCase(), mode: DEMO ? 'demo' : 'live',
    started: new Date().toISOString(), ...f,
    pointer: TOUCH ? 'coarse' : 'fine', screen_px: `${window.screen.width}x${window.screen.height}`,
  };
}

const instructions = () => screen(`<h2>How to play</h2>
  <p>Eight stars sit in a circle. Some of them light up <b>one after another</b> — a path of 8 flashes.
  Remember the order, and after a short pause click the stars in the <b>same order</b>.</p>
  <p>Some paths are easier than others. There are three kinds of blocks: just remembering, remembering while saying
  “the” softly, and remembering while tapping. Each block starts with a short practice.</p>
  <p class="muted">Memory only — please don't point at the screen, trace the path with the cursor, or write anything down.</p>`);

// single-item mental demand (NASA-TLX style), 1–7: checks that suppression and tapping were similarly demanding
async function effortRating() {
  const f = await form(`<h2>Block finished</h2><label>How mentally demanding was this block?</label>
    <div class="likert" style="grid-template-columns:repeat(7,1fr)">${[1, 2, 3, 4, 5, 6, 7].map(v => `<div class="h">${v === 1 ? 'Very low' : v === 7 ? 'Very high' : v}</div>`).join('')}
    ${[1, 2, 3, 4, 5, 6, 7].map(v => `<input type="radio" name="effort" value="${v}" required aria-label="${v}">`).join('')}</div>`);
  return +f.effort;
}

async function strategyQuestions() {
  const opts = (name, list) => list.map(([v, t]) => `<label style="font-weight:400"><input type="radio" name="${name}" value="${v}" required>${t}</label>`).join('');
  return form(`<h2>A few questions about how you did it</h2>
    <label>Which best describes how you remembered the paths?</label>
    ${opts('strategy', [['shape', 'I saw a shape or pattern'], ['words', 'I described it to myself in words or numbers'],
      ['positions', 'I remembered the positions one by one'], ['motion', 'As a movement or rhythm'], ['mixed', 'Mixed / other']])}
    <label>While saying “the”, could you still describe the paths to yourself in words or numbers?</label>
    ${opts('as_words', [[1, 'Not at all'], [2, 'A little'], [3, 'Somewhat'], [4, 'Mostly'], [5, 'Completely']])}
    <label>Did you ever stop saying “the” to remember better?</label>
    ${opts('as_paused', [['no', 'No'], ['sometimes', 'Sometimes'], ['often', 'Often']])}
    <label>Did you notice that some paths followed a pattern (e.g. a square or a zig-zag)?</label>
    ${opts('noticed', [['1', 'Yes'], ['0', 'No']])}`);
}

async function irq() {
  if (!IRQ.length) return {};
  const head = `<div></div>${[1, 2, 3, 4, 5].map(h => `<div class="h">${h}</div>`).join('')}`;
  const rows = IRQ.map(q => `<div>${q.text}</div>${[1, 2, 3, 4, 5].map(v => `<input type="radio" name="${q.id}" value="${v}" required aria-label="${v}">`).join('')}`).join('');
  const f = await form(`<h2>About your inner experience</h2><p class="muted">There are no right answers — people differ a lot.<br>1 = strongly disagree · 2 = disagree · 3 = neutral · 4 = agree · 5 = strongly agree</p>
    <div class="likert">${head}${rows}</div>`);
  const out = Object.fromEntries(IRQ.map(q => [`irq_${q.id}`, +f[q.id]]));
  for (const factor of new Set(IRQ.map(q => q.factor))) {
    out[`irqf_${factor}`] = r3(mean(IRQ.filter(q => q.factor === factor).map(q => +f[q.id] * (q.reverse ? -1 : 1) + (q.reverse ? 6 : 0))));
  }
  return out;
}

// per-participant "compression curve": accuracy against LoT complexity, one line per block type
function curveSVG(test) {
  const ks = [...new Set(test.map(r => r.complexity).filter(k => k !== ''))].sort((a, b) => a - b);
  if (ks.length < 2) return '';
  const W = 320, H = 170, x = k => 30 + (k - ks[0]) / (ks.at(-1) - ks[0]) * (W - 45), y = a => H - 20 - a * (H - 35);
  const lines = CONDS.map(c => {
    const pts = ks.map(k => { const a = test.filter(r => r.cond === c && r.complexity === k).map(r => r.acc_pos); return a.length ? `${x(k)},${y(mean(a))}` : null; }).filter(Boolean);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${COND_COLOR[c]}" stroke-width="2"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px"><line x1="30" y1="${H - 20}" x2="${W - 10}" y2="${H - 20}" stroke="#555"/>
    <line x1="30" y1="10" x2="30" y2="${H - 20}" stroke="#555"/><text x="${W / 2}" y="${H - 4}" fill="#98a2b8" font-size="10" text-anchor="middle">path complexity →</text>
    <text x="4" y="14" fill="#98a2b8" font-size="10">100%</text>${lines}</svg>
    <div class="muted" style="font-size:.85rem">${CONDS.map(c => `<span style="color:${COND_COLOR[c]}">■</span> ${COND_LABEL[c]}`).join(' &nbsp; ')}</div>`;
}

async function main() {
  const P = await consentAndDemographics();
  const t0 = performance.now();
  await instructions();
  Object.assign(P, await micSetup());
  const orderIdx = QS.has('order') ? Math.abs(+QS.get('order') || 0) % 6 : Math.floor(Math.random() * 6);
  const order = ORDERS[orderIdx].map(i => CONDS[i]);
  P.block_order = order.join('>');
  const rows = [], nTest = order.length * TEST_SEQS.length;
  let done = 0;
  for (const [b, cond] of order.entries()) {
    await screen(BLOCK_INTRO[cond], 'Practice');
    for (let i = 0; i < (DEMO || b > 0 ? 1 : CFG.PRACTICE_PER_BLOCK); i++) rows.push(await runTrial(randomPerm(), cond, { phase: 'practice', block: b + 1, trial: i + 1 }));
    await screen(`${BLOCK_INTRO[cond]}<p><b>Now for real:</b> ${TEST_SEQS.length} paths.</p>`, 'Begin');
    for (const [i, item] of shuffle(TEST_SEQS).entries()) {
      rows.push(await runTrial(item, cond, { phase: 'test', block: b + 1, trial: i + 1 }));
      $bar.style.width = pct(++done / nTest);
    }
    P[`effort_${cond}`] = await effortRating();
  }
  Object.assign(P, await strategyQuestions(), await irq());
  P.duration_min = +((performance.now() - t0) / 60000).toFixed(1);
  P.focus_losses = focusLosses;
  await finish(P, rows.map(r => ({ ...P, ...r })));
}

// ---------- data ----------
const toCSV = rows => {
  const cols = [...new Set(rows.flatMap(Object.keys))];
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
};

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

async function upload(payload) {
  if (!CFG.SHEET_URL) return false;
  try {
    const r = await fetch(CFG.SHEET_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    return (await r.json()).ok === true;
  } catch { return false; }
}

async function finish(P, rows) {
  const payload = { participant: P, trials: rows };
  try { localStorage.setItem(`constellations_${P.pid}`, JSON.stringify(payload)); } catch { /* storage blocked: CSV + upload still available */ }
  const test = rows.filter(r => r.phase === 'test');
  const acc = c => { const a = test.filter(r => r.cond === c).map(r => r.acc_pos); return a.length ? pct(mean(a)) : '–'; };
  await show(`<div class="card"><h1>Thank you!</h1>
    <table><tr>${CONDS.map(c => `<th>${COND_LABEL[c]}</th>`).join('')}</tr><tr>${CONDS.map(c => `<td>${acc(c)}</td>`).join('')}</tr></table>
    ${curveSVG(test)}
    <p class="muted">What was this about? Your memory doesn't store a path dot by dot — it <b>compresses</b> it, like a zip file:
    “a square, then the same square shifted” is shorter than eight separate positions. Paths with a short description are easier to
    remember. The open question is whether that inner code is made of <b>words</b>. Saying “the” occupies your inner voice; tapping
    is just as distracting but leaves the inner voice free. If simple paths lose their advantage only while you say “the”, the
    compression code runs on language. If not, the mind compresses without words.</p>
    <p id="status" class="muted">Saving…</p>
    <div class="row"><button id="retry" hidden>Retry upload</button><button id="dl">Download data (CSV)</button></div></div>`);
  const $status = el('status'), $retry = el('retry');
  el('dl').onclick = () => download(`constellations_${P.pid}.csv`, toCSV(rows));
  const attempt = async () => {
    $status.textContent = 'Saving…';
    const ok = await upload(payload);
    $retry.hidden = ok || !CFG.SHEET_URL;
    $status.textContent = ok ? `✓ Saved (participant ${P.pid}). You can close this tab.`
      : CFG.SHEET_URL ? '⚠ Could not reach the database. Click Retry, or Download and send the file to the researcher.'
      : `Participant ${P.pid}: click Download and give the file to the researcher.`;
  };
  $retry.onclick = attempt;
  await attempt();
}

main();
