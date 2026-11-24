'use strict';
/*
  CONSTELLATIONS: does the mind's compression code need words?
  Eight "stars" sit on a regular octagon. A path of flashes is shown, and the participant clicks the stars in the same order.
  Paths are graded by language-of-thought (LoT) complexity (minimal description length; Amalric et al., 2017).
  Three within-subject blocks, order counterbalanced:
    none: just remember
    as:   articulatory suppression, saying "the" softly about twice a second during encoding and retention
          (the microphone measures loudness only, nothing is recorded)
    tap:  rhythmic tapping on Space or a touch pad, about twice a second (matched dual-task control)
  Every trial applies a random rotation/reflection, which keeps LoT complexity but changes the absolute locations.
  URL options: ?demo short version (rows flagged mode=demo), ?pid=X experimenter ID, ?order=0..5 block order,
               ?rescue download sessions saved on this device (for example after a closed tab).
*/

const CFG = {
  SHEET_URL: '',                    // Google Apps Script web-app URL (see apps-script.gs). Empty means CSV download only.
  LEAD_MS: 1000,                    // secondary task runs this long before the first flash
  ON_MS: 200, OFF_MS: 500,          // 200 ms flash, 700 ms SOA (Al Roumi et al., 2021, behavioural training phase)
  RETENTION_MS: 2000,
  PRACTICE_PER_BLOCK: 2,
  MIN_COVERAGE: 0.8,                // compliance: share of windows with voice (as) or a tap (tap)
  R: 72,                            // star ring radius (SVG units, viewBox ±100)
};
const QS = new URLSearchParams(location.search);
const DEMO = QS.has('demo');
const TOUCH = matchMedia('(pointer: coarse)').matches;
const IN_APP = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|MicroMessenger/i.test(navigator.userAgent);

// Stimulus set: 9 published octagon sequences (Amalric et al., 2017, S1 Text Fig 2; Al Roumi et al., 2021) plus
// 5 sequences filling K = 9, 11 to 14 (seeded random draw from all 5040 origin-fixed sequences).
// k = LoT minimal description length, computed by analysis/lot_complexity.py (reproduces all published values and is
// invariant under the rotations/reflections applied on each trial). Vertices 0 to 7 clockwise from the top.
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
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: CSV + upload still work */ } };

let onKey = null;
document.addEventListener('keydown', e => { if (onKey && !e.repeat) onKey(e); });
let focusLosses = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) focusLosses++; });

const show = html => { $stage.innerHTML = html; return frame(); };

// A card with one or more buttons; resolves with the index of the button chosen.
// onPick runs inside the click/keypress handler itself, which Safari needs before it will start audio.
function choose(html, labels, onPick) {
  return new Promise(async res => {
    await show(`<div class="card">${html}<div class="row">${labels.map((l, i) =>
      `<button class="${i ? '' : 'primary'}" data-i="${i}">${l}${i ? '' : ' <kbd>Enter</kbd>'}</button>`).join('')}</div></div>`);
    const pick = i => { onKey = null; onPick?.(i); res(i); };
    $stage.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => pick(+b.dataset.i); });
    onKey = e => { if (e.key === 'Enter') { e.preventDefault(); pick(0); } };
  });
}
const screen = (html, btn = 'Continue', onPick) => choose(html, [btn], onPick);

function form(html, submit = 'Continue') {
  return new Promise(async res => {
    await show(`<form class="card" id="f">${html}<div class="row"><button class="primary">${submit}</button></div></form>`);
    $stage.querySelectorAll('label').forEach(l => {
      const f = l.nextElementSibling;
      if (!l.control && f?.name && f.matches('input, select')) { f.id ||= `f_${f.name}`; l.htmlFor = f.id; }
    });
    el('f').onsubmit = e => { e.preventDefault(); res(Object.fromEntries(new FormData(e.target))); };
  });
}
const pickOne = '<option value="">Choose one</option>';

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

// rotation r (0 to 7) and optional mirror: a symmetry of the octagon, so LoT complexity is unchanged
const transform = (v, rot, mirror) => v.map(x => (((mirror ? -x : x) + rot) % 8 + 8) % 8);

// ---------- microphone: loudness only, never recorded ----------
const Mic = { ctx: null, an: null, buf: null, stream: null, thr: Infinity };
const level = () => {
  if (!Mic.an) return 0;
  Mic.an.getFloatTimeDomainData(Mic.buf);
  let s = 0;
  for (const x of Mic.buf) s += x * x;
  return Math.sqrt(s / Mic.buf.length);
};
const db = rms => 20 * Math.log10(Math.max(rms, 1e-6));
const meterPct = rms => Math.max(0, Math.min(100, (db(rms) + 70) / 60 * 100)); // -70 dBFS is empty, -10 dBFS is full

// Call from inside a click or keypress handler: Safari and iOS only start audio from a user gesture.
function wakeAudio() {
  try {
    Mic.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    Mic.ctx.resume?.().catch(() => {});   // not awaited: on some browsers this promise never settles
  } catch { /* no Web Audio: the session runs without the mic check */ }
}

async function openMic(deviceId) {
  Mic.stream?.getTracks().forEach(t => t.stop());
  if (!Mic.ctx) throw Object.assign(new Error('no audio context'), { name: 'NoWebAudio' });
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
  const stream = await Promise.race([
    navigator.mediaDevices.getUserMedia({ audio }),
    sleep(30000).then(() => { throw Object.assign(new Error('timeout'), { name: 'Timeout' }); }),
  ]);
  Mic.stream = stream;
  Mic.an = Mic.ctx.createAnalyser();
  Mic.an.fftSize = 1024;
  Mic.buf = new Float32Array(Mic.an.fftSize);
  Mic.ctx.createMediaStreamSource(stream).connect(Mic.an);
}

// Collects loudness for `ms` while driving the live meter; returns all samples.
async function listen(ms) {
  const fill = el('meter').firstElementChild, ls = [], t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const l = level();
    ls.push(l);
    fill.style.width = `${meterPct(l)}%`;
    await sleep(50);
  }
  return ls;
}

async function micPicker() {
  const mics = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'audioinput');
  if (mics.length < 2) return '';
  const current = Mic.stream?.getAudioTracks()[0]?.getSettings?.().deviceId;
  return `<label>Microphone</label><select id="micsel">${mics.map((d, i) =>
    `<option value="${d.deviceId}" ${d.deviceId === current ? 'selected' : ''}>${d.label || `Microphone ${i + 1}`}</option>`).join('')}</select>`;
}

// Quiet period, then soft speech. The threshold sits halfway (in dB) between room and voice, and above the room's peaks.
async function soundCheck() {
  await show(`<div class="card" style="text-align:center"><h2>Sound check</h2>
    <p id="cue"><b>Step 1:</b> stay quiet for a moment…</p>
    <div class="row"><div class="meter calib" id="meter" style="visibility:visible"><div></div></div></div></div>`);
  const quiet = await listen(2500);
  el('cue').innerHTML = '<b>Step 2:</b> now softly say “the… the… the…”';
  const talk = await listen(4000);
  const base = quantile(quiet, 0.5), peak = quantile(quiet, 0.95), voice = quantile(talk, 0.9);
  const thr = Math.max(10 ** ((db(base) + db(voice)) / 40), peak * 1.25);
  return { ok: voice > thr * 1.25 && voice > 0.002, base, voice, thr };
}

// While the browser's permission popup is open, say so on screen (it is easy to miss) and offer a way out.
async function askForMic(deviceId) {
  let settled = false;
  const pending = openMic(deviceId).finally(() => { settled = true; });
  const hint = sleep(400).then(() => settled ? new Promise(() => {}) : show(`<div class="card"><h2>One sec…</h2>
    <p>Your browser should be asking to use the microphone. Look for a small popup near the address bar and click <b>Allow</b>.</p>
    <div class="row"><button id="skipmic">Skip the mic check</button></div></div>`).then(() => new Promise(res => { el('skipmic').onclick = () => res(true); })));
  const skipped = await Promise.race([pending.then(() => false), hint]);
  if (skipped) {
    Mic.an = null;
    pending.then(() => { Mic.stream?.getTracks().forEach(t => t.stop()); Mic.an = null; }).catch(() => {});
  }
  return skipped;
}

async function micSetup() {
  const why = `<p>In one round you'll softly repeat the word <b>“the”</b>, a classic memory-research trick to keep your inner voice
    busy. Let's make sure your mic can hear you. A quiet, normal voice is perfect.</p>
    <p class="muted">We only measure how loud things are, live in your browser. Nothing is recorded, saved or sent anywhere.</p>`;
  if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
    await screen(`<h2>No mic here, no problem</h2><p>${IN_APP ? 'This page opened inside an app (like WhatsApp or Instagram), and those can\'t use the microphone. For the full experience, open the link in Chrome or Safari.' : 'This browser can\'t use the microphone.'}
      You can still play: just say “the” softly when we ask.</p>`, 'Keep going');
    return { mic_ok: 0, mic_error: 'unsupported' };
  }
  if (await choose(`<h2>Quick mic check</h2>${why}`, ['Turn on my mic', 'I don\'t have a mic'], wakeAudio) === 1) return { mic_ok: 0, mic_error: 'declined' };
  for (let tries = 1; ; tries++) {
    let skipped;
    try { skipped = await askForMic(el('micsel')?.value); } catch (e) {
      const blocked = e.name === 'NotAllowedError' || e.name === 'SecurityError';
      const skip = await choose(`<h2>Hmm, the mic didn't switch on</h2>
        <p>${blocked ? 'Looks like microphone access is blocked.' : 'Your browser didn\'t hand us the microphone.'}
        Click the lock or mic icon next to the web address, allow the microphone, then hit Try again.</p>`, ['Try again', 'Skip the mic check'], wakeAudio);
      if (skip) return { mic_ok: 0, mic_error: e.name || 'error', mic_attempts: tries };
      continue;
    }
    if (skipped) return { mic_ok: 0, mic_error: 'prompt_skipped', mic_attempts: tries };
    const s = await soundCheck();
    if (s.ok) {
      Mic.thr = s.thr;
      el('cue').innerHTML = '<b>Got it! We can hear you nicely.</b> ✓';
      await sleep(1200);
      const nMics = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'audioinput').length;
      return { mic_ok: 1, mic_base: r3(s.base), mic_voice: r3(s.voice), mic_thr: r3(s.thr), mic_attempts: tries, mic_devices: nMics };
    }
    const picker = await micPicker();
    const skip = await choose(`<h2>Almost there!</h2>
      <p>Your voice and the room sound pretty similar to us. Try getting a little closer to the mic or speaking a touch
      louder${picker ? ', or pick a different microphone below' : ''}.</p>${picker}`, ['Try again', 'Skip the mic check'], wakeAudio);
    if (skip) { Mic.an = null; return { mic_ok: 0, mic_error: 'too_quiet', mic_attempts: tries }; }
  }
}

// ---------- secondary tasks ----------
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
      fill.style.width = `${meterPct(l)}%`;
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
  const hint = { none: 'Ready when you are.', as: 'Press Start, then begin a soft <b>“the… the… the…”</b>', tap: `Press Start, then begin tapping ${TOUCH ? 'the pad' : '<kbd>Space</kbd>'}.` }[cond];
  setMsg(`<div class="muted">${hint}</div><button class="primary" id="start">Start <kbd>Enter</kbd></button>`);
  return new Promise(res => {
    const go = () => { onKey = null; wakeAudio(); res(); };   // also revives audio if the browser paused it
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
  const labels = ['Total guess', 'Not sure', 'Fairly sure', 'Certain'];
  setMsg(`How sure are you about that one?<div class="row" style="margin-top:.4rem">${labels.map((l, i) =>
    `<button data-c="${i + 1}">${l} <kbd>${i + 1}</kbd></button>`).join('')}</div>`);
  return new Promise(res => {
    const pick = c => { onKey = null; res(c); };
    document.querySelectorAll('[data-c]').forEach(b => { b.onclick = () => pick(+b.dataset.c); });
    onKey = e => { if ('1234'.includes(e.key)) pick(+e.key); };
  });
}

const cheer = n => n === 8 ? 'Perfect! ✦' : n >= 6 ? 'Great memory!' : n >= 3 ? 'Nice effort!' : 'Tricky one! On to the next.';

async function runTrial(item, cond, meta) {
  const rot = Math.floor(Math.random() * 8), mirror = Math.random() < 0.5;
  const seq = transform(item.v, rot, mirror);
  await show(skyHTML());
  await waitStart(cond);
  setMsg({ none: 'Watch closely…', as: 'Keep it going: “the… the… the…”', tap: 'Keep that steady beat…' }[cond]);
  const mon = monitor(cond);
  let on = await frame();
  await until(on, CFG.LEAD_MS);
  for (const v of seq) {
    lit(v, true); on = await frame(); await until(on, CFG.ON_MS);
    lit(v, false); on = await frame(); await until(on, CFG.OFF_MS);
  }
  await until(on, CFG.RETENTION_MS);
  const sec = mon.stop();
  setMsg(`${cond === 'none' ? '' : 'You can stop now. '}<b>Your turn!</b> Click the stars in the order they lit up.
    <div class="row" style="margin-top:.4rem"><button id="undo">Undo <kbd>⌫</kbd></button></div>`);
  const r = await recall(seq.length);
  const conf = await confidence();
  const s = score(seq, r.resp);
  const n = Math.round(s.acc_pos * seq.length);
  const warn = sec.sec_ok === 0 ? (cond === 'as' ? 'We lost you for a moment there. Keep a soft “the… the…” going until it\'s your turn.' : 'Keep the beat going until it\'s your turn.') : '';
  setMsg(`<b>${n} / ${seq.length}</b> in the right order. ${cheer(n)}
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
const COND_COLOR = { none: '#4A4A4A', as: '#A63049', tap: '#34704F' };   // ink, berry, green from the page palette
const COND_LABEL = { none: 'Just remember', as: 'Saying “the”', tap: 'Tapping' };
const BLOCK_INTRO = {
  none: `<h2>Round: just remember</h2><p>Nice and simple. Watch the stars quietly and remember the order.</p>`,
  as: `<h2>Round: say “the”</h2><p>This round has a little twist. From the moment you press Start until the stars ask for your
    answer, softly repeat <b>“the… the… the…”</b>, about twice a second. A quiet, normal voice is perfect.</p>
    <p class="muted">Why? Repeating a word keeps your inner voice busy, a classic trick in memory research. It feels a bit funny
    for a round or two, then it's easy. The bar under the stars turns green when we can hear you.</p>`,
  tap: `<h2>Round: tap along</h2><p>From the moment you press Start until the stars ask for your answer, keep tapping
    ${TOUCH ? 'the pad under the stars' : '<kbd>Space</kbd> with your left hand'} at a steady beat, about twice a second.
    ${TOUCH ? '' : 'Click the stars with your right hand.'}</p>`,
};

async function demoIntro() {
  await screen(`<h1>Constellations ✦ <span class="tag">demo</span></h1>
    <p>A quick taste of the game, about 4 minutes: one warm-up and two paths in each of the three rounds.
    No details needed, and nothing you do here is saved.</p>
    <p class="muted">The real version starts with a few questions about you and takes about 20 minutes.</p>`, 'Let\'s play');
  return { pid: 'DEMO', mode: 'demo', started: new Date().toISOString(), in_app: +IN_APP,
    pointer: TOUCH ? 'coarse' : 'fine', screen_px: `${window.screen.width}x${window.screen.height}` };
}

async function consentAndDemographics() {
  await form(`<h1>Constellations ✦</h1>
    ${IN_APP ? '<p class="note">Heads up: this page opened inside an app. For the mic to work, open the link in Chrome or Safari.</p>' : ''}
    <p>Welcome! This is a little memory game for our cognitive psychology project. Stars light up one by one, and your job
    is to click them back in the same order. It takes about <b>20 minutes</b> and there are no trick questions.</p>
    <p>In one round you'll softly repeat a word while you play, and in another you'll tap a key. Find a comfy spot where speaking
    quietly is fine, ideally with a laptop and a mouse.</p>
    <p class="muted">Taking part is completely voluntary and you can stop anytime by closing the tab. We save your clicks, timings and
    answers. In one round we check how loud the room is through your mic, and we never record any audio. We ask for your email
    to spot duplicate entries, and because our course instructor asked us to include it in the data we hand in. Only our group
    and the instructor see it. It never appears in our report, and nothing in the report can identify you.
    Please take part just once.</p>
    <label><input type="checkbox" name="consent" required>I agree to take part. Let's go!</label>`, 'Start');
  const f = await form(`<h2>A little about you</h2>
    <label>Email</label><input name="email" type="email" required autocomplete="email">
    <label>Age</label><input name="age" type="number" min="10" max="99" required>
    <label>Gender</label><select name="gender" required>${pickOne}
      <option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select>
    <label>Course or programme (for example, B.Sc. Psychology)</label><input name="course" required maxlength="80">
    <label>Field of study</label><select name="stream" required>${pickOne}
      <option value="stem">Science, engineering, technology or maths</option>
      <option value="health">Medicine or health sciences</option>
      <option value="commerce">Commerce, management or economics</option>
      <option value="arts">Arts, humanities or social sciences</option>
      <option value="other">Other, or not a student</option></select>
    <label>Year of study</label><select name="year" required>${pickOne}
      <option>1</option><option>2</option><option>3</option><option>4</option><option>5+</option>
      <option>Postgraduate</option><option>Not a student</option></select>
    <label>Highest level of maths you've studied</label><select name="maths" required>${pickOne}
      <option value="1">Up to Class 10 or GCSE</option><option value="2">Class 12 or A-level</option>
      <option value="3">Some university maths</option><option value="4">A maths-heavy degree (engineering, physics, maths…)</option></select>
    <label>How many languages can you speak fluently?</label><input name="languages_n" type="number" min="1" max="10" required>
    <label>Is English your first language?</label><select name="english_l1" required>${pickOne}
      <option value="1">Yes</option><option value="0">No</option></select>
    <label>Hours of sleep last night</label><input name="sleep_h" type="number" min="0" max="16" step="0.5" required>
    <label>Video gaming per week</label><select name="gaming_hpw" required>${pickOne}
      <option value="0">None</option><option value="2">1 to 3 hours</option><option value="5.5">4 to 7 hours</option>
      <option value="11">8 to 14 hours</option><option value="20">15 hours or more</option></select>
    <label>What will you click with?</label><select name="input" required>${pickOne}
      <option value="mouse">Mouse</option><option value="trackpad">Trackpad</option><option value="touch">Touchscreen</option></select>`);
  document.documentElement.requestFullscreen?.().catch(() => {});
  return {
    pid: QS.get('pid') || Math.random().toString(36).slice(2, 8).toUpperCase(), mode: DEMO ? 'demo' : 'live',
    started: new Date().toISOString(), ...f, in_app: +IN_APP,
    pointer: TOUCH ? 'coarse' : 'fine', screen_px: `${window.screen.width}x${window.screen.height}`,
  };
}

const instructions = () => screen(`<h2>How to play</h2>
  <p>Eight stars sit in a circle. A few of them light up <b>one after another</b>, making a path of 8 flashes. Watch closely,
  then click the stars back in the <b>same order</b>.</p>
  <p>Some paths are easy and some are tricky, and that's totally normal. You'll play three rounds: one where you just
  remember, one where you softly say “the” while you watch, and one where you tap a key. Each round starts with a quick warm-up.</p>
  <p class="muted">Memory only please: no pointing at the screen, tracing with the cursor or writing things down. Your brain does all the work!</p>`, 'Got it');

// single-item mental demand (NASA-TLX style), 1 to 7: checks that suppression and tapping were similarly demanding
async function effortRating() {
  const f = await form(`<h2>Round complete, nice work! ✦</h2><label>How mentally demanding was that round?</label>
    <div class="likert" style="grid-template-columns:repeat(7,1fr)">${[1, 2, 3, 4, 5, 6, 7].map(v => `<div class="h">${v === 1 ? 'Very low' : v === 7 ? 'Very high' : v}</div>`).join('')}
    ${[1, 2, 3, 4, 5, 6, 7].map(v => `<input type="radio" name="effort" value="${v}" required aria-label="${v}">`).join('')}</div>`);
  return +f.effort;
}

async function strategyQuestions() {
  const opts = (name, list) => list.map(([v, t]) => `<label style="font-weight:400"><input type="radio" name="${name}" value="${v}" required>${t}</label>`).join('');
  return form(`<h2>Almost done! How did you do it?</h2>
    <label>Which best describes how you remembered the paths?</label>
    ${opts('strategy', [['shape', 'I saw a shape or pattern'], ['words', 'I described it to myself in words or numbers'],
      ['positions', 'I remembered the positions one by one'], ['motion', 'As a movement or rhythm'], ['mixed', 'A mix, or something else']])}
    <label>While saying “the”, could you still describe the paths to yourself in words or numbers?</label>
    ${opts('as_words', [[1, 'Not at all'], [2, 'A little'], [3, 'Somewhat'], [4, 'Mostly'], [5, 'Completely']])}
    <label>Did you ever stop saying “the” to remember better? (Totally fine if you did, just be honest!)</label>
    ${opts('as_paused', [['no', 'No'], ['sometimes', 'Sometimes'], ['often', 'Often']])}
    <label>Did you notice that some paths followed a pattern, like a square or a zigzag?</label>
    ${opts('noticed', [['1', 'Yes'], ['0', 'No']])}`);
}

async function irq() {
  if (!IRQ.length) return {};
  const head = `<div></div>${[1, 2, 3, 4, 5].map(h => `<div class="h">${h}</div>`).join('')}`;
  const rows = IRQ.map(q => `<div>${q.text}</div>${[1, 2, 3, 4, 5].map(v => `<input type="radio" name="${q.id}" value="${v}" required aria-label="${v}">`).join('')}`).join('');
  const f = await form(`<h2>Last bit: your inner voice</h2><p class="muted">No right or wrong answers here. Everyone's inner world is
    different, and that's what makes this interesting.<br>1 = strongly disagree · 2 = disagree · 3 = neutral · 4 = agree · 5 = strongly agree</p>
    <div class="likert">${head}${rows}</div>`, 'Finish');
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
    <line x1="30" y1="10" x2="30" y2="${H - 20}" stroke="#555"/><text x="${W / 2}" y="${H - 4}" fill="#555" font-size="10" text-anchor="middle">trickier paths →</text>
    <text x="0" y="14" fill="#555" font-size="9">100%</text>${lines}</svg>
    <div class="muted" style="font-size:.85rem">${CONDS.map(c => `<span style="color:${COND_COLOR[c]}">■</span> ${COND_LABEL[c]}`).join(' &nbsp; ')}</div>`;
}

async function main() {
  if (QS.has('rescue')) return rescue();
  const P = DEMO ? await demoIntro() : await consentAndDemographics();
  const t0 = performance.now();
  if (!DEMO) window.onbeforeunload = e => { e.preventDefault(); e.returnValue = ''; };   // "are you sure?" if the tab is closed mid-game
  await instructions();
  Object.assign(P, await micSetup());
  const orderIdx = QS.has('order') ? Math.abs(+QS.get('order') || 0) % 6 : Math.floor(Math.random() * 6);
  const order = ORDERS[orderIdx].map(i => CONDS[i]);
  P.block_order = order.join('>');
  const rows = [], nTest = order.length * TEST_SEQS.length;
  const backup = () => DEMO || store(`constellations_partial_${P.pid}`, { participant: P, trials: rows.map(r => ({ ...P, ...r })) });
  let done = 0;
  for (const [b, cond] of order.entries()) {
    await screen(BLOCK_INTRO[cond], 'Warm up');
    for (let i = 0; i < (DEMO || b > 0 ? 1 : CFG.PRACTICE_PER_BLOCK); i++) {
      rows.push(await runTrial(randomPerm(), cond, { phase: 'practice', block: b + 1, trial: i + 1 }));
      backup();
    }
    await screen(`${BLOCK_INTRO[cond]}<p><b>Warm-up done, you've got this!</b> Now for real: ${TEST_SEQS.length} paths.</p>`, 'Begin');
    for (const [i, item] of shuffle(TEST_SEQS).entries()) {
      rows.push(await runTrial(item, cond, { phase: 'test', block: b + 1, trial: i + 1 }));
      $bar.style.width = pct(++done / nTest);
      backup();
    }
    P[`effort_${cond}`] = await effortRating();
  }
  if (!DEMO) Object.assign(P, await strategyQuestions(), await irq());
  P.duration_min = +((performance.now() - t0) / 60000).toFixed(1);
  P.focus_losses = focusLosses;
  Mic.stream?.getTracks().forEach(t => t.stop());   // switch the mic off as soon as we're done with it
  window.onbeforeunload = null;
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

// ?rescue: list every session saved on this device (finished or not) with a download button each
async function rescue() {
  let keys = [];
  try { keys = Object.keys(localStorage).filter(k => k.startsWith('constellations_')).sort(); } catch { /* storage blocked */ }
  await show(`<div class="card"><h1>Rescue saved sessions</h1>
    <p class="muted">Sessions saved on this device. “partial” means the tab closed before the end.</p>
    ${keys.length ? keys.map((k, i) => `<div class="row"><button data-k="${i}">Download ${k.replace('constellations_', '')}</button></div>`).join('')
      : '<p>Nothing saved on this device yet.</p>'}</div>`);
  $stage.querySelectorAll('[data-k]').forEach(b => {
    b.onclick = () => { const p = JSON.parse(localStorage.getItem(keys[+b.dataset.k])); download(`${keys[+b.dataset.k]}.csv`, toCSV(p.trials)); };
  });
}

async function finish(P, rows) {
  const payload = { participant: P, trials: rows };
  if (!DEMO) {
    store(`constellations_${P.pid}`, payload);
    try { localStorage.removeItem(`constellations_partial_${P.pid}`); } catch { /* storage blocked */ }
  }
  const test = rows.filter(r => r.phase === 'test');
  const acc = c => { const a = test.filter(r => r.cond === c).map(r => r.acc_pos); return a.length ? pct(mean(a)) : 'n/a'; };
  await show(`<div class="card"><h1>You did it! Thank you ✦</h1>
    <table><tr>${CONDS.map(c => `<th>${COND_LABEL[c]}</th>`).join('')}</tr><tr>${CONDS.map(c => `<td>${acc(c)}</td>`).join('')}</tr></table>
    ${curveSVG(test)}
    <p class="muted">What was this about? Your memory doesn't store a path dot by dot. It <b>compresses</b> it, like a zip file:
    “a square, then the same square shifted” is much shorter than eight separate dots, so patterned paths are easier. The big
    question is whether that inner code is made of <b>words</b>. Saying “the” keeps your inner voice busy, while tapping is just as
    distracting but leaves your inner voice free. If simple paths lose their edge only while you say “the”, your memory's code runs
    on language. If not, your brain compresses without words. Pretty cool, right?</p>
    <p id="status" class="muted">Saving…</p>
    <div class="row"><button id="retry" hidden>Retry upload</button><button id="dl">Download my data (CSV)</button></div></div>`);
  const $status = el('status'), $retry = el('retry');
  el('dl').onclick = () => download(`constellations_${P.pid}.csv`, toCSV(rows));
  const attempt = async () => {
    $status.textContent = 'Saving…';
    const ok = await upload(payload);
    $retry.hidden = ok || !CFG.SHEET_URL;
    $status.textContent = ok ? `✓ Saved! You're participant ${P.pid}, and you can close this tab now.`
      : CFG.SHEET_URL ? 'We couldn\'t reach our database. Hit Retry, or download your data and send it to the researcher.'
      : `You're participant ${P.pid}. Please click Download and send the file to the researcher. Thanks a ton!`;
  };
  $retry.onclick = attempt;
  if (DEMO) $status.textContent = 'That was the demo, so nothing was saved. Ready for the real thing? Open the link without ?demo.';
  else await attempt();
}

main();
