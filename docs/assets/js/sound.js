/* ============================================================================
   ONLIVE QUIZ — ระบบเสียง (สังเคราะห์ด้วย Web Audio ทั้งหมด ไม่ใช้ไฟล์เสียง)
   ----------------------------------------------------------------------------
   • เพลงพื้นหลัง (BGM) 3 แพ็ก  : ชิล (chill) / ตื่นเต้น (tension) / ไพเราะ (gentle)
   • เอฟเฟค					   : join / pop / start / correct / wrong / reveal /
                                   tick (นาฬิกา) / warn / timeup / podium / whoosh /
                                   streak / drumroll / heartbeat / suspense
   • เปิด–ปิดได้ทั้งระบบ + แยกเปิดปิด "เพลงพื้นหลัง" กับ "เอฟเฟค" ได้อิสระ
     และเลือกช่วงเสียงนาฬิกาเตือน (5 วินาที – 5 นาทีสุดท้าย) พร้อมความดัง
   • จำค่าใน localStorage · ตั้งค่าเริ่มต้นที่ config.js → SOUND

   ใช้งาน:
     Snd.play("correct");  Snd.music("tension");  Snd.countdown(leftMs);
     Snd.stopMusic();      Snd.set("on", false);  Snd.isOn();
     Snd.announce("ชื่อผู้เล่น");   // เสียง "แจ้งผู้เล่นเข้าห้อง" แบบเกมโชว์
   ============================================================================ */
(function () {
  const LS_KEY = "onlive.sound.v1";
  const cfgIn = (window.QUIZ_CONFIG && window.QUIZ_CONFIG.SOUND) || {};

  const DEFAULTS = {
    on: true,           // เปิดเสียงทั้งระบบ
    music: true,        // เพลงพื้นหลัง
    fx: true,           // เอฟเฟค
    volume: 0.8,        // ความดังรวม 0–1
    tickFromSeconds: 300, // เสียงนาฬิกาในช่วง N วินาทีสุดท้าย (300 = 5 นาทีสุดท้าย)
    pack: "chill",       // แพ็กเพลงพื้นหลัง: chill | tension | gentle
    gameTracks: ["q1", "q2", "q3"] // เพลงที่สุ่มใช้ระหว่างเล่น
  };

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  const cfg = Object.assign({}, DEFAULTS, cfgIn, loadSaved());
  if (!["chill", "tension", "gentle"].includes(cfg.pack)) cfg.pack = "chill";
  cfg.gameTracks = Array.isArray(cfg.gameTracks)
    ? ["q1", "q2", "q3"].filter((track) => cfg.gameTracks.includes(track))
    : DEFAULTS.gameTracks.slice();
  if (!cfg.gameTracks.length) cfg.gameTracks = DEFAULTS.gameTracks.slice();
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { } }

  /* ---------------------------------------------------------------- engine */
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, comp = null, master = null, musicBus = null, fxBus = null, noiseBuf = null;
  let unlocked = false;
  let musicWanted = "off";     // lobby | tension | off
  let musicTimer = null, stepIdx = 0, nextStepTime = 0;
  let gameTrackBag = [], lastGameTrack = "", lastQuestionIndex = null, lastQuestionTrack = "";
  let previewToken = 0;
  let lastTickSec = -1;
  let tensionLevel = 0;        // 0 = ปกติ, 1 = ตื่นเต้นสุด (ช่วงท้ายข้อ)

  function buildNoise() {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ensure() {
    if (ctx) return ctx;
    if (!AC) return null;
    try {
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 8;
      comp.attack.value = 0.004; comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = cfg.on ? clamp01(cfg.volume) : 0;
      musicBus = ctx.createGain(); musicBus.gain.value = 0.20;
      fxBus = ctx.createGain(); fxBus.gain.value = 0.55;
      musicBus.connect(comp); fxBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
      noiseBuf = buildNoise();
      return ctx;
    } catch (e) { return null; }
  }

  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  const fxOn = () => cfg.on && cfg.fx;
  const musicOn = () => cfg.on && cfg.music;

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === "suspended") {
      ctx.resume().then(() => { unlocked = true; ensureMusic(); }).catch(() => { });
    } else {
      unlocked = true;
      ensureMusic();
    }
  }
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, unlock, { passive: true })
  );

  /* --------------------------------------------------------------- helpers */
  function osc(type, freq, at, dur, gain, bus, opts) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(Math.max(20, freq), at);
    if (opts && opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), at + dur);
    const peak = Math.max(0.0001, gain == null ? 0.3 : gain);
    const a = (opts && opts.attack) || 0.008;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(a, dur * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    if (opts && opts.slide) g.gain.exponentialRampToValueAtTime(peak * opts.slide, at + dur); // ไม่ใช้ — กันพลาด
    o.connect(g); g.connect(bus || fxBus);
    o.start(at); o.stop(at + dur + 0.03);
    return o;
  }

  function noise(at, dur, gain, opts) {
    if (!noiseBuf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = (opts && opts.type) || "bandpass";
    f.frequency.setValueAtTime((opts && opts.freq) || 2200, at);
    if (opts && opts.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.to), at + dur);
    f.Q.value = (opts && opts.q) || 0.9;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain || 0.2), at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f); f.connect(g); g.connect((opts && opts.bus) || fxBus);
    src.start(at); src.stop(at + dur + 0.02);
  }

  /* ---------------------------------------------------------------- sounds */
  const SOUNDS = {
    click() {
      osc("square", 880, ctx.currentTime, 0.035, 0.05);
    },
    /* ผู้เล่นเข้าห้อง — "ป๊อป" สองชั้นแบบเกมโชว์ */
    join() {
      const t = ctx.currentTime;
      osc("sine", 520, t, 0.09, 0.22, null, { to: 990, attack: 0.004 });
      osc("square", 1320, t + 0.07, 0.09, 0.10);
      noise(t, 0.12, 0.05, { type: "highpass", freq: 3200 });
    },
    /* เสียงแจ้งชื่อผู้เล่น (ใช้คู่กับเอฟเฟคชื่อเด้งบนจอผู้จัด) */
    announce() {
      const t = ctx.currentTime;
      osc("triangle", 784, t, 0.11, 0.16);
      osc("triangle", 1175, t + 0.1, 0.16, 0.13);
    },
    pop() {
      const t = ctx.currentTime;
      osc("sine", 300, t, 0.08, 0.2, null, { to: 900, attack: 0.003 });
    },
    leave() {
      const t = ctx.currentTime;
      osc("square", 520, t, 0.1, 0.12);
      osc("square", 330, t + 0.09, 0.14, 0.12);
    },
    start() {
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        osc("triangle", f, t + i * 0.09, 0.16, 0.26));
      osc("sine", 261.6, t, 0.5, 0.12);
    },
    /* เสียงเริ่มข้อแบบ "ตื่นเต้น" — กลอง+ไรเซอร์ */
    suspense() {
      const t = ctx.currentTime;
      noise(t, 0.55, 0.14, { type: "bandpass", freq: 300, to: 5200, q: 1.2 });
      for (let i = 0; i < 6; i++) osc("square", 220 * Math.pow(1.18, i), t + i * 0.08, 0.07, 0.09);
      osc("sine", 70, t + 0.5, 0.3, 0.3, null, { to: 48, attack: 0.002 });
    },
    heartbeat() {
      const t = ctx.currentTime;
      osc("sine", 62, t, 0.16, 0.34, null, { to: 44, attack: 0.003 });
      osc("sine", 58, t + 0.22, 0.2, 0.24, null, { to: 40, attack: 0.003 });
    },
    correct() {
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        osc("triangle", f, t + i * 0.075, 0.22, 0.24));
      osc("sine", 1568, t + 0.3, 0.4, 0.09);
      noise(t, 0.18, 0.05, { type: "highpass", freq: 3000 });
    },
    wrong() {
      const t = ctx.currentTime;
      osc("sawtooth", 220, t, 0.18, 0.2, null, { to: 130, attack: 0.004 });
      osc("sawtooth", 180, t + 0.16, 0.3, 0.18, null, { to: 90, attack: 0.004 });
      noise(t, 0.2, 0.05, { type: "lowpass", freq: 700 });
    },
    streak() {
      const t = ctx.currentTime;
      [1046, 1318, 1568, 2093].forEach((f, i) => osc("square", f, t + i * 0.06, 0.12, 0.10));
      noise(t, 0.3, 0.06, { type: "highpass", freq: 5200 });
    },
    reveal() {
      const t = ctx.currentTime;
      noise(t, 0.5, 0.10, { type: "bandpass", freq: 400, to: 4200, q: 1.6 });
      [784, 988, 1319].forEach((f, i) => osc("triangle", f, t + 0.12 + i * 0.07, 0.3, 0.18));
    },
    warn() {
      const t = ctx.currentTime;
      osc("sine", 1180, t, 0.1, 0.16);
      osc("sine", 1180, t + 0.14, 0.1, 0.13);
    },
    /* นาฬิกา tick-tock (urgent = 3 วินาทีสุดท้าย เสียงถี่และสูงขึ้น) */
    tick(urgent) {
      const t = ctx.currentTime;
      const hi = urgent ? 2200 : 1500;
      noise(t, 0.028, urgent ? 0.20 : 0.13, { type: "bandpass", freq: hi, q: 3 });
      osc("square", urgent ? 1900 : 1150, t, 0.028, urgent ? 0.10 : 0.06);
    },
    timeup() {
      const t = ctx.currentTime;
      [880, 660, 440, 300].forEach((f, i) =>
        osc("square", f, t + i * 0.13, i === 3 ? 0.4 : 0.12, 0.20));
      noise(t, 0.5, 0.12, { type: "lowpass", freq: 1800, to: 300 });
    },
    whoosh() {
      const t = ctx.currentTime;
      noise(t, 0.42, 0.11, { type: "bandpass", freq: 600, to: 6000, q: 1.1 });
    },
    drumroll(ms) {
      const t = ctx.currentTime;
      const n = Math.max(6, Math.min(40, Math.round((ms || 900) / 55)));
      for (let i = 0; i < n; i++) {
        const k = i / n;
        noise(t + i * 0.055, 0.05, 0.03 + k * 0.09, { type: "bandpass", freq: 1800 + k * 900, q: 2 });
      }
    },
    podium() {
      const t = ctx.currentTime;
      // แฟนแฟร์: โด–มี–ซอล–โด ✧ + คอร์ดปิด + ปรบมือ
      const mel = [[523.25, 0], [659.25, 0.16], [783.99, 0.32], [1046.5, 0.48],
      [987.77, 0.78], [1046.5, 0.94], [1318.5, 1.12]];
      mel.forEach(([f, at]) => {
        osc("square", f, t + at, 0.24, 0.17);
        osc("triangle", f / 2, t + at, 0.28, 0.12);
      });
      [261.63, 329.63, 392.0, 523.25].forEach((f) => osc("triangle", f, t + 1.12, 1.5, 0.11));
      noise(t + 1.1, 1.1, 0.07, { type: "highpass", freq: 4200 });
    },
    /* พลุ: เสียงหวีดขึ้นฟ้า → ตูม → ประกายแตก */
    firework() {
      const t = ctx.currentTime;
      osc("sine", 420, t, 0.42, 0.05, null, { to: 1700, attack: 0.02 });
      noise(t + 0.42, 0.5, 0.2, { type: "lowpass", freq: 900, to: 120 });
      osc("sine", 110, t + 0.42, 0.34, 0.3, null, { to: 42, attack: 0.002 });
      for (let i = 0; i < 9; i++) {
        noise(t + 0.5 + Math.random() * 0.6, 0.04, 0.03 + Math.random() * 0.04,
          { type: "highpass", freq: 4200 + Math.random() * 3600 });
      }
    },
    /* อันดับขยับขึ้น (กระดานคะแนน) */
    rankup() {
      const t = ctx.currentTime;
      osc("triangle", 660, t, 0.1, 0.14, null, { to: 1320, attack: 0.004 });
      osc("square", 1760, t + 0.09, 0.08, 0.05);
    },
    /* ปรบมือ/เชียร์ (ใช้ตอนจบเกม) */
    cheer() {
      const t = ctx.currentTime;
      for (let i = 0; i < 26; i++) {
        noise(t + Math.random() * 1.4, 0.09 + Math.random() * 0.1, 0.02 + Math.random() * 0.05,
          { type: "bandpass", freq: 1200 + Math.random() * 2800, q: 1.4 });
      }
    }
  };

  function play(name, arg) {
    if (!fxOn()) return;
    if (!ensure()) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const run = () => { try { fn(arg); } catch (e) { /* เงียบไว้ ไม่ให้เกมพังเพราะเสียง */ } };
    if (ctx.state === "suspended") {
      ctx.resume().then(() => { unlocked = true; ensureMusic(); run(); }).catch(() => { });
    } else run();
  }

  /* --------------------------------------------------------------- เพลง BGM */
  const BPM = 112;
  const PROG = [                                // 4 ห้อง: C – G – Am – F
    { bass: 130.81, chord: [261.63, 329.63, 392.0] },
    { bass: 98.0, chord: [246.94, 293.66, 392.0] },
    { bass: 110.0, chord: [220.0, 261.63, 329.63] },
    { bass: 87.31, chord: [220.0, 261.63, 349.23] }
  ];
  /* เพลงตามฉาก — แต่ละเพลงมีจังหวะ/คอร์ด/ลวดลายของตัวเอง
       q1 q2 q3   : เพลงตื่นเต้น 3 เพลง สลับวนตามข้อ (ข้อ 1 → A, ข้อ 2 → B, ข้อ 3 → C, ข้อ 4 → A …)
       reveal     : ช่วงเฉลย (เบา ลุ้น ๆ)
       leaderboard: ช่วงประกาศอันดับ (คึกคัก)
       ended      : ฉลองผู้ชนะ                                                    */
  const PROG_B = [                              // Am – F – Dm – E  (ไล่ล่า)
    { bass: 110.0, chord: [220.0, 261.63, 329.63] },
    { bass: 87.31, chord: [174.61, 220.0, 261.63] },
    { bass: 73.42, chord: [220.0, 293.66, 349.23] },
    { bass: 82.41, chord: [207.65, 246.94, 329.63] }
  ];
  const PROG_C = [                              // Em – C – D – B  (เร่งเครื่อง)
    { bass: 82.41, chord: [246.94, 329.63, 392.0] },
    { bass: 65.41, chord: [261.63, 329.63, 392.0] },
    { bass: 73.42, chord: [220.0, 293.66, 369.99] },
    { bass: 61.74, chord: [246.94, 311.13, 369.99] }
  ];
  const PROG_WIN = [                            // C – F – G – C  (ฉลอง)
    { bass: 130.81, chord: [261.63, 329.63, 392.0] },
    { bass: 87.31, chord: [261.63, 349.23, 440.0] },
    { bass: 98.0, chord: [293.66, 392.0, 493.88] },
    { bass: 130.81, chord: [329.63, 392.0, 523.25] }
  ];
  const TRACKS = {
    q1: { bpm: 122, prog: PROG },
    q2: { bpm: 136, prog: PROG_B },
    q3: { bpm: 148, prog: PROG_C },
    reveal: { bpm: 96, prog: PROG_B },
    leaderboard: { bpm: 118, prog: PROG_WIN },
    ended: { bpm: 126, prog: PROG_WIN }
  };
  const TRACK_NAMES = { q1: "เพลง A", q2: "เพลง B", q3: "เพลง C" };
  function currentMode() { return musicWanted === "lobby" ? cfg.pack : musicWanted; }
  function stepLen() {
    const t = TRACKS[currentMode()];
    return 60 / (t ? t.bpm : BPM) / 4;          // 1/16 โน้ต
  }
  /** เลือกเพลงแบบสุ่มโดยไม่ซ้ำติดกัน และวนครบเพลงที่เลือกก่อนเริ่มชุดใหม่ */
  function drawQuestionTrack() {
    const selected = cfg.gameTracks.length ? cfg.gameTracks : DEFAULTS.gameTracks;
    if (!gameTrackBag.length) {
      gameTrackBag = selected.slice();
      for (let i = gameTrackBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameTrackBag[i], gameTrackBag[j]] = [gameTrackBag[j], gameTrackBag[i]];
      }
      if (gameTrackBag.length > 1 && gameTrackBag[gameTrackBag.length - 1] === lastGameTrack) {
        [gameTrackBag[0], gameTrackBag[gameTrackBag.length - 1]] =
          [gameTrackBag[gameTrackBag.length - 1], gameTrackBag[0]];
      }
    }
    lastGameTrack = gameTrackBag.pop();
    return lastGameTrack;
  }
  function questionTrack(index) {
    const qIndex = Number(index) || 0;
    if (qIndex !== lastQuestionIndex) {
      lastQuestionIndex = qIndex;
      lastQuestionTrack = drawQuestionTrack();
    }
    return lastQuestionTrack;
  }

  function scheduleStep(i, when) {
    const bar = Math.floor(i / 16) % 4;
    const s = i % 16;
    // จอพัก/ห้องรอ ใช้ "แพ็กเพลง" ที่ผู้ใช้เลือก · ฉากอื่นใช้เพลงประจำฉาก
    const mode = currentMode();
    const p = (TRACKS[mode] ? TRACKS[mode].prog : PROG)[bar];
    const fast = tensionLevel > 0;

    if (mode === "tension" || mode === "q1") {
      // เพลง A — เบสเดินทุก 1/8 + กระเดื่อง + ไฮแฮทถี่ (ช่วงท้ายข้อถี่ขึ้น + heartbeat)
      if (s % 2 === 0 || (fast && s % 3 === 0)) {
        osc("sawtooth", p.bass * (s % 8 === 4 ? 2 : 1), when, 0.16, 0.13, musicBus, { attack: 0.004 });
      }
      if (s % (fast ? 4 : 8) === 0) osc("sine", 82, when, 0.2, 0.28, musicBus, { to: 46, attack: 0.002 });
      if (s % (fast ? 1 : 2) === 1) noise(when, 0.035, fast ? 0.07 : 0.05, { type: "highpass", freq: 7000, bus: musicBus });
      if (s % 4 === 2) osc("triangle", p.chord[(i + bar) % 3], when, 0.12, 0.07, musicBus);
      if (fast && s % 8 === 4) osc("sine", 62, when, 0.14, 0.26, musicBus, { to: 44, attack: 0.003 });
    } else if (mode === "q2") {
      // เพลง B — ไล่ล่า: เบสออฟบีต + อาร์เปจจิโอสแควร์วิ่งขึ้น + สแนร์จังหวะ 2/4
      if (s % 4 === 0) osc("sine", 78, when, 0.18, 0.30, musicBus, { to: 44, attack: 0.002 });
      if (s % 4 === 2 || (fast && s % 4 === 3)) osc("sawtooth", p.bass * 2, when, 0.11, 0.11, musicBus, { attack: 0.004 });
      if (s % 8 === 4) noise(when, 0.09, 0.09, { type: "bandpass", freq: 1900, q: 0.8, bus: musicBus });
      const arp = [0, 1, 2, 1, 2, 0, 1, 2];
      if (s % 2 === 0 || fast) osc("square", p.chord[arp[(s >> 1) % 8]] * (s >= 8 ? 2 : 1), when, 0.08, 0.038, musicBus);
      if (s % 2 === 1) noise(when, 0.025, 0.04, { type: "highpass", freq: 8200, bus: musicBus });
      if (fast && s % 8 === 0) osc("sine", 62, when, 0.14, 0.26, musicBus, { to: 44, attack: 0.003 });
    } else if (mode === "q3") {
      // เพลง C — เร่งเครื่อง: เบสอ็อกเทฟกระโดด + กระเดื่องสี่จังหวะ + ลีดไต่ขึ้น
      osc("sawtooth", p.bass * (s % 2 ? 2 : 1), when, 0.09, s % 2 ? 0.07 : 0.12, musicBus, { attack: 0.003 });
      if (s % 4 === 0) osc("sine", 86, when, 0.16, 0.30, musicBus, { to: 46, attack: 0.002 });
      if (s % 8 === 4) noise(when, 0.11, 0.10, { type: "bandpass", freq: 2200, q: 0.7, bus: musicBus });
      if (s % 4 === 2) noise(when, 0.03, 0.05, { type: "highpass", freq: 9000, bus: musicBus });
      if (s === 0 || s === 3 || s === 6 || s === 10 || s === 12) {
        const k = [0, 1, 2, 1, 2][[0, 3, 6, 10, 12].indexOf(s)];
        osc("triangle", p.chord[k] * 2, when, 0.2, 0.085, musicBus);
      }
      if (bar === 3 && s >= 12) osc("square", 440 * Math.pow(1.122, s - 12), when, 0.07, 0.05, musicBus);
      if (fast && s % 2 === 1) noise(when, 0.03, 0.05, { type: "highpass", freq: 7000, bus: musicBus });
    } else if (mode === "reveal") {
      // เฉลย — เบสยาว + เสียงระฆังโปร่ง ๆ ให้ลุ้น
      if (s === 0) osc("sine", p.bass, when, 1.1, 0.17, musicBus, { attack: 0.04 });
      if (s % 4 === 0) osc("sine", p.chord[(s / 4) % 3] * 2, when, 0.6, 0.05, musicBus, { attack: 0.02 });
      if (s === 14) osc("triangle", p.chord[2] * 2, when, 0.25, 0.035, musicBus);
      if (s % 8 === 4) noise(when, 0.04, 0.02, { type: "highpass", freq: 8000, bus: musicBus });
    } else if (mode === "leaderboard") {
      // ประกาศอันดับ — คึกคัก มีตบมือจังหวะ 2 กับ 4
      if (s % 4 === 0) osc("sine", 80, when, 0.18, 0.26, musicBus, { to: 46, attack: 0.002 });
      if (s % 8 === 4) noise(when, 0.08, 0.08, { type: "bandpass", freq: 1500, q: 0.9, bus: musicBus });
      if (s % 4 === 0 || s % 4 === 3) osc("triangle", p.bass, when, 0.15, 0.15, musicBus);
      if (s % 2 === 0) osc("square", p.chord[(s / 2) % 3] * 2, when, 0.09, 0.035, musicBus);
      if (s % 2 === 1) noise(when, 0.025, 0.03, { type: "highpass", freq: 8500, bus: musicBus });
    } else if (mode === "ended") {
      // ฉลองผู้ชนะ — คอร์ดสว่าง + เมโลดี้กระโดด
      if (s % 4 === 0) osc("sine", 82, when, 0.18, 0.24, musicBus, { to: 46, attack: 0.002 });
      if (s % 8 === 4) noise(when, 0.09, 0.08, { type: "bandpass", freq: 1700, q: 0.8, bus: musicBus });
      if (s % 8 === 0) p.chord.forEach((f) => osc("triangle", f, when, 0.42, 0.05, musicBus, { attack: 0.01 }));
      if (s % 4 === 2) osc("triangle", p.bass, when, 0.16, 0.14, musicBus);
      const mel = [2, -1, 1, 2, -1, 0, 1, -1, 2, 1, 2, -1, 0, -1, 1, 2];
      if (mel[s] >= 0) osc("square", p.chord[mel[s]] * 2, when, 0.11, 0.04, musicBus);
      if (s % 2 === 1) noise(when, 0.025, 0.03, { type: "highpass", freq: 8800, bus: musicBus });
    } else if (mode === "gentle") {
      // ไพเราะ: เบา ๆ มีโน้ตสูงลอย ๆ
      if (s === 0) osc("sine", p.bass / 2, when, 0.9, 0.16, musicBus, { attack: 0.05 });
      if (s % 4 === 0) {
        const note = p.chord[(s / 4) % 3] * 2;
        osc("sine", note, when, 0.5, 0.055, musicBus, { attack: 0.04 });
      }
      if (s % 8 === 6) osc("triangle", p.chord[1] * 2, when, 0.3, 0.03, musicBus);
    } else {
      // ชิลล์ (ค่าเริ่มต้น): เบสทุกห้อง + อาร์เปจโน้ต + ไฮแฮทเบา ๆ
      if (s === 0 || s === 8) osc("sine", p.bass, when, 0.34, 0.20, musicBus, { attack: 0.01 });
      if (s % 2 === 0) {
        const note = p.chord[(s / 2) % 3] * (s % 8 === 6 ? 2 : 1);
        osc("triangle", note, when, 0.14, 0.075, musicBus);
      }
      if (s % 4 === 2) noise(when, 0.03, 0.028, { type: "highpass", freq: 8000, bus: musicBus });
    }
  }

  function pump() {
    if (!ctx) return;
    const ahead = ctx.currentTime + 0.25;
    let guard = 0;
    while (nextStepTime < ahead && guard++ < 64) {
      if (nextStepTime < ctx.currentTime - 0.3) nextStepTime = ctx.currentTime; // หลังกลับจากแท็บที่ถูกพัก
      scheduleStep(stepIdx, Math.max(nextStepTime, ctx.currentTime + 0.02));
      nextStepTime += stepLen();
      stepIdx = (stepIdx + 1) % 64;
    }
  }

  /* เริ่มตัวจัดลำดับโน้ต ถ้าบริบทรันอยู่แล้ว (เรียกซ้ำได้ปลอดภัย) */
  function ensureMusic() {
    if (musicTimer || !musicOn() || musicWanted === "off" || !ctx) return;
    if (ctx.state !== "running") return;          // จะเริ่มเองเมื่อผู้ใช้แตะหน้าจอ
    stepIdx = 0;
    nextStepTime = ctx.currentTime + 0.08;
    pump();
    musicTimer = setInterval(pump, 25);
  }

  function startMusic(mode) {
    if (mode !== musicWanted) {
      // เปลี่ยนฉาก → เริ่มเพลงใหม่ตั้งแต่ห้องแรก (ไม่ค้างกลางท่อนของเพลงเดิม)
      stepIdx = 0;
      if (ctx) nextStepTime = ctx.currentTime + 0.12;
    }
    musicWanted = mode;
    renderUI();
    if (!musicOn() || !ensure()) return;
    if (ctx.state === "suspended") { ctx.resume().then(ensureMusic).catch(() => { }); return; }
    ensureMusic();
  }

  function stopMusic() {
    previewToken++;
    musicWanted = "off";
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function music(mode) {
    previewToken++; // การเปลี่ยนฉากยกเลิกการคืนค่า preview ที่ตั้งเวลาไว้
    if (!mode || mode === "off") { stopMusic(); return; }
    if (!["q1", "q2", "q3"].includes(mode)) {
      lastQuestionIndex = null;
      lastQuestionTrack = "";
    }
    if (!musicOn()) { musicWanted = mode; renderUI(); return; }   // จำไว้ เปิดเพลงเมื่อผู้ใช้เปิดเสียง
    startMusic(mode);
  }

  function previewMusic(track) {
    if (!["q1", "q2", "q3"].includes(track)) return;
    const resumeMode = musicWanted;
    const token = ++previewToken;
    startMusic(track);
    setTimeout(() => {
      if (previewToken === token && musicWanted === track) {
        if (resumeMode === "off") stopMusic();
        else startMusic(resumeMode);
      }
    }, 5000);
  }

  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    } else if (musicOn() && musicWanted !== "off") {
      ensureMusic();
    }
  });

  /* ------------------------------------------------------------- countdown */
  function countdown(leftMs, opt) {
    const sec = Math.max(0, Math.ceil(Number(leftMs || 0) / 1000));
    if (!cfg.on) { lastTickSec = sec; return; }
    const from = Math.max(1, Number(cfg.tickFromSeconds) || 5);
    // ช่วงท้ายข้อ: เปิดโหมดตื่นเต้นของเพลง + ใจเต้นเป็นจังหวะ
    // (ถ้าตั้งนาฬิกาไว้ยาว เช่น 5 นาที → เพลงจะเร่งในช่วง 60 วินาทีสุดท้าย)
    tensionLevel = sec <= Math.min(from, 60) ? 1 : 0;
    if (sec !== lastTickSec) {
      if (sec > 0 && sec <= from) {
        if (sec === from && from >= 5) play("warn");
        const tickEvery = from > 60 ? (sec > 30 ? 5 : 1) : 1;   // ช่วงยาว ๆ ไม่ต้องติ๊กทุกวินาที
        if (sec % tickEvery === 0) play("tick", sec <= 10);
        if (from > 60 && sec > 10 && sec % 30 === 0) play("heartbeat");
      }
      if (sec === 0 && lastTickSec > 0) play("timeup");
      lastTickSec = sec;
    }
    if (opt && opt.silent) lastTickSec = sec;
  }
  function resetCountdown() { lastTickSec = -1; tensionLevel = 0; }

  /* -------------------------------------------------------------- settings */
  function applyVolume() {
    if (!master || !ctx) return;
    const v = cfg.on ? clamp01(cfg.volume) : 0;
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  function set(key, val) {
    if (!(key in cfg)) return;
    cfg[key] = key === "tickFromSeconds" ? Math.max(1, Math.min(300, Number(val) || 5))
      : key === "volume" ? clamp01(val)
        : key === "pack" ? (["chill", "tension", "gentle"].includes(val) ? val : "chill")
          : key === "gameTracks" ? ["q1", "q2", "q3"].filter((track) => Array.isArray(val) && val.includes(track))
            : !!val;
    if (key === "gameTracks") {
      if (!cfg.gameTracks.length) cfg.gameTracks = DEFAULTS.gameTracks.slice();
      gameTrackBag = [];
      lastQuestionIndex = null;
      lastQuestionTrack = "";
    }
    save();
    if (key === "on" || key === "volume") {
      applyVolume();
      if (!cfg.on) stopMusic();
      else if (cfg.music && musicWanted !== "off") startMusic(musicWanted);
    }
    if (key === "music") {
      if (!cfg.music) stopMusic();
      else if (cfg.on && musicWanted !== "off") startMusic(musicWanted);
    }
    if (key === "pack" && musicWanted !== "off") {
      // เปลี่ยนแพ็กทันที: ต้องรีสตาร์ทตัวจัดลำดับโน้ต (stepIdx เริ่มห้องใหม่)
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      ensureMusic();
    }  // เปลี่ยนแพ็กทันที
    renderUI();
  }
  const get = (key) => cfg[key];

  /* -------------------------------------------------------------------- UI */
  let uiEl = null;
  function iconSVG(on) {
    return on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h3.2L12 19V5L7.2 9H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h3.2L12 19V5L7.2 9H4z" fill="currentColor"/><path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  function renderUI() {
    if (!uiEl) return;
    const btn = uiEl.querySelector(".snd-btn");
    btn.classList.toggle("off", !cfg.on);
    btn.innerHTML = iconSVG(cfg.on);
    btn.title = cfg.on ? "เสียงเปิด — คลิกเพื่อตั้งค่า" : "เสียงปิด — คลิกเพื่อเปิด";
    const q = (s) => uiEl.querySelector(s);
    if (q("#snd-on")) q("#snd-on").checked = !!cfg.on;
    if (q("#snd-music")) { q("#snd-music").checked = !!cfg.music; q("#snd-music").disabled = !cfg.on; }
    if (q("#snd-fx")) { q("#snd-fx").checked = !!cfg.fx; q("#snd-fx").disabled = !cfg.on; }
    if (q("#snd-tick")) { q("#snd-tick").value = String(cfg.tickFromSeconds); }
    if (q("#snd-vol")) { q("#snd-vol").value = String(Math.round(cfg.volume * 100)); }
    if (q("#snd-pack")) q("#snd-pack").value = cfg.pack;
    uiEl.querySelectorAll("[data-game-track]").forEach((input) => { input.checked = cfg.gameTracks.includes(input.dataset.gameTrack); });
    const now = q("#snd-now");
    if (now) {
      const label = {
        off: "—", lobby: "ห้องรอ", tension: "ตื่นเต้น", reveal: "ช่วงเฉลย",
        leaderboard: "ประกาศอันดับ", ended: "ฉลองผู้ชนะ"
      }[musicWanted] || (TRACK_NAMES[musicWanted] ? "แข่งขัน · " + TRACK_NAMES[musicWanted] : musicWanted);
      now.textContent = "กำลังเล่น: " + label;
    }
  }

  function ui() {
    if (uiEl || !document.body) return;
    const wrap = document.createElement("div");
    wrap.className = "snd-fab";
    wrap.innerHTML =
      '<button class="snd-btn" type="button" aria-label="ตั้งค่าเสียง"></button>' +
      '<div class="snd-panel hidden">' +
      '<div class="snd-panel-title">เสียงและเพลง</div>' +
      '<div class="snd-now" id="snd-now"></div>' +
      '<label class="snd-row"><input type="checkbox" id="snd-on" /> <span>เปิดเสียงทั้งหมด</span></label>' +
      '<label class="snd-row"><input type="checkbox" id="snd-music" /> <span>เพลงพื้นหลัง</span></label>' +
      '<label class="snd-row"><input type="checkbox" id="snd-fx" /> <span>เอฟเฟคเสียง</span></label>' +
      '<label class="snd-row snd-row-col"><span>เพลงห้องรอ</span>' +
      '<select id="snd-pack">' +
      '<option value="chill">ชิล ๆ</option>' +
      '<option value="tension">ตื่นเต้น</option>' +
      '<option value="gentle">ไพเราะ เบา ๆ</option></select></label>' +
      '<div class="snd-game-music"><div class="snd-game-title">เพลงระหว่างเล่น · สุ่มวนโดยไม่ซ้ำติดกัน</div>' +
      '<div class="snd-track-row"><label><input type="checkbox" data-game-track="q1" /> เพลง A · ไล่ล่า</label><button type="button" data-preview-track="q1">ฟัง</button></div>' +
      '<div class="snd-track-row"><label><input type="checkbox" data-game-track="q2" /> เพลง B · เร่งจังหวะ</label><button type="button" data-preview-track="q2">ฟัง</button></div>' +
      '<div class="snd-track-row"><label><input type="checkbox" data-game-track="q3" /> เพลง C · ตื่นเต้น</label><button type="button" data-preview-track="q3">ฟัง</button></div></div>' +
      '<label class="snd-row snd-row-col"><span>เสียงนาฬิกาเตือนเมื่อเหลือ</span>' +
      '<select id="snd-tick">' +
      '<option value="5">5 วินาที</option><option value="10">10 วินาที</option>' +
      '<option value="30">30 วินาที</option><option value="60">1 นาที</option>' +
      '<option value="120">2 นาที</option><option value="180">3 นาที</option>' +
      '<option value="300">5 นาที (ค่าแนะนำ)</option></select></label>' +
      '<label class="snd-row snd-row-col"><span>ความดัง</span>' +
      '<input type="range" id="snd-vol" min="0" max="100" step="5" /></label>' +
      '<p class="snd-note">ติ๊กเลือกเพลงที่จะใช้ได้ตั้งแต่ 1 เพลงขึ้นไป · สุ่มสลับให้ครบเพลงที่เลือกก่อนวนซ้ำ<br>ปุ่ม “ฟัง” เล่นตัวอย่าง 5 วินาที · จำค่าไว้ในเครื่องนี้</p>' +
      "</div>";
    // วางไว้แถบบนสุด ข้างปุ่ม "ออก" (ถ้าหน้านั้นมีแถบบน) — ไม่งั้นลอยไว้มุมขวาบน
    const bar = document.querySelector(".topbar") || document.querySelector(".play-top");
    if (bar) {
      wrap.classList.add("snd-inline");
      const logout = bar.querySelector("#btn-logout");
      if (logout) bar.insertBefore(wrap, logout); else bar.appendChild(wrap);
    } else {
      document.body.appendChild(wrap);
    }
    uiEl = wrap;

    const panel = wrap.querySelector(".snd-panel");
    wrap.querySelector(".snd-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      unlock();
      panel.classList.toggle("hidden");
      if (!panel.classList.contains("hidden")) play("click");
    });
    document.addEventListener("click", (e) => {
      if (!panel.classList.contains("hidden") && !wrap.contains(e.target)) panel.classList.add("hidden");
    });
    wrap.querySelector("#snd-on").addEventListener("change", (e) => { unlock(); set("on", e.target.checked); if (e.target.checked) play("join"); });
    wrap.querySelector("#snd-music").addEventListener("change", (e) => set("music", e.target.checked));
    wrap.querySelector("#snd-fx").addEventListener("change", (e) => { set("fx", e.target.checked); if (e.target.checked) play("click"); });
    wrap.querySelector("#snd-tick").addEventListener("change", (e) => set("tickFromSeconds", e.target.value));
    wrap.querySelector("#snd-pack").addEventListener("change", (e) => set("pack", e.target.value));
    wrap.querySelectorAll("[data-game-track]").forEach((input) => input.addEventListener("change", () => {
      const selected = Array.from(wrap.querySelectorAll("[data-game-track]:checked"), (el) => el.dataset.gameTrack);
      if (!selected.length) { input.checked = true; return; }
      set("gameTracks", selected);
    }));
    wrap.querySelectorAll("[data-preview-track]").forEach((button) => button.addEventListener("click", () => {
      unlock(); previewMusic(button.dataset.previewTrack);
    }));
    wrap.querySelector("#snd-vol").addEventListener("input", (e) => set("volume", Number(e.target.value) / 100));

    renderUI();
  }

  /* ------------------------------------------------------------------ boot */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ui);
  } else { ui(); }

  window.Snd = {
    play, music, stopMusic, countdown, resetCountdown, unlock, ui,
    questionTrack, previewMusic,
    /** เพลงประจำข้อ: สุ่มจากเพลงที่เลือก โดยไม่ซ้ำติดกัน */
    questionMusic(index) { music(questionTrack(index)); },
    current: () => musicWanted,
    set, get, isOn: () => !!cfg.on,
    /** ตั้งค่าหน้าจอ projector: เปิดเพลงห้องรอทันทีหลังผู้ใช้คลิก */
    lobby() { music("lobby"); },
    /** เพลงตอนตอบคำถาม (ตื่นเต้นเสมอ) */
    tension() { music("tension"); },
    /** รวมเสียงประกาศผู้เล่นเข้าห้อง */
    announce() { play("join"); setTimeout(() => { try { play("announce"); } catch (e) { } }, 120); }
  };
})();
