/* ============================================================================
   ONLIVE QUIZ — บัลลังก์ผู้ชนะ (Podium) + ตัวละคร + คอนเฟตติ
   ----------------------------------------------------------------------------
   ใช้ในหน้าจอ "จบเกม" ทั้งจอผู้จัด (Podium.render) และมือถือผู้เล่น (Podium.mini)
   ตัวละครเป็น SVG ที่สร้างจากชื่อผู้เล่น (สี/ทรง/ของประดับ stable ต่อคน)
   ลำดับแอนิเมชัน: บัลลังก์โผล่ → ตัวละครค่อย ๆ ปรากฏ → มงกุฎลอยลง →
                   ผู้เล่นอันดับ 2/3 ขึ้นแท่น → คอนเฟตติ
   ลดการเคลื่อนไหวตาม prefers-reduced-motion ให้อัตโนมัติ
   ============================================================================ */
(function () {
  const PALETTES = [
    ["#ffb03a", "#ef7314"], ["#57b4ff", "#1f74d6"], ["#7ee081", "#12924f"],
    ["#ff8fb1", "#e0356d"], ["#c79bff", "#7a3fd4"], ["#5fe0d4", "#0e9aa7"],
    ["#ffd93d", "#d99b00"], ["#ff9f7a", "#d94f2b"]
  ];

  function hash(str) {
    let h = 2166136261;
    const s = String(str || "?");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  function escaped(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------------- ตัวละคร */
  /* ถ้ามีระบบ avatar (avatars.js) ให้วาดตัวละครที่ผู้เล่นตกแต่งเอง
     ไม่งั้นถอยไปใช้ตัวละครสุ่มจากชื่อ (คงที่ต่อคน) */
  function charSvg(name, opts) {
    const o = opts || {};
    if (window.Avatars) {
      const av = o.avatar && Object.keys(o.avatar || {}).length ? o.avatar : Avatars.fromName(name);
      return Avatars.svg(av, { cls: "char" });
    }
    const h = hash(name);
    const pal = PALETTES[h % PALETTES.length];
    const gid = "cg" + (h % 99991);
    const variant = h % 4;
    let extra = "";
    if (variant === 1) extra = '<line x1="60" y1="18" x2="60" y2="6" stroke="' + pal[1] + '" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="4" r="6" fill="#ffd93d"/>';
    else if (variant === 2) extra = '<path d="M45 74h30l-15 12z" fill="#ff5d8f"/>';
    else if (variant === 3) extra =
      '<circle cx="51" cy="43" r="9" fill="none" stroke="#20202a" stroke-width="2.6"/><circle cx="69" cy="43" r="9" fill="none" stroke="#20202a" stroke-width="2.6"/><line x1="60" y1="43" x2="60" y2="43" stroke="#20202a" stroke-width="2.6"/>';

    return '<svg class="char" viewBox="0 0 120 132" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + pal[0] + '"/><stop offset="1" stop-color="' + pal[1] + '"/>' +
      "</linearGradient></defs>" +
      '<ellipse cx="60" cy="124" rx="36" ry="7" fill="rgba(0,0,0,.22)"/>' +
      '<path d="M20 124c0-36 7-58 17-68 6-6 14-9 23-9s17 3 23 9c10 10 17 32 17 68z" fill="url(#' + gid + ')"/>' +
      '<circle cx="31" cy="98" r="10" fill="url(#' + gid + ')"/>' +
      '<circle cx="89" cy="98" r="10" fill="url(#' + gid + ')"/>' +
      '<circle cx="60" cy="44" r="28" fill="url(#' + gid + ')"/>' +
      '<circle cx="50" cy="42" r="5.6" fill="#fff"/><circle cx="70" cy="42" r="5.6" fill="#fff"/>' +
      '<circle cx="51" cy="43" r="2.7" fill="#20202a"/><circle cx="71" cy="43" r="2.7" fill="#20202a"/>' +
      '<path d="M50 56q10 8 20 0" stroke="#20202a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
      extra +
      "</svg>";
  }

  /* -------------------------------------------------------------- บัลลังก์ */
  const THRONE =
    '<svg class="throne-svg" viewBox="0 0 160 200" aria-hidden="true">' +
    "<defs>" +
    '<linearGradient id="thr-gold" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#fff0a8"/><stop offset=".42" stop-color="#ffd23f"/><stop offset="1" stop-color="#b87800"/>' +
    "</linearGradient>" +
    '<linearGradient id="thr-plush" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#8f1f9e"/><stop offset="1" stop-color="#4a0a54"/>' +
    "</linearGradient>" +
    "</defs>" +
    '<path d="M40 40c0-12 9-22 21-22h38c12 0 21 10 21 22v90H40z" fill="url(#thr-gold)"/>' +
    '<path d="M53 50c0-8 6-14 14-14h26c8 0 14 6 14 14v66H53z" fill="url(#thr-plush)"/>' +
    '<circle cx="80" cy="17" r="10" fill="url(#thr-gold)"/>' +
    '<circle cx="40" cy="34" r="8" fill="url(#thr-gold)"/>' +
    '<circle cx="120" cy="34" r="8" fill="url(#thr-gold)"/>' +
    '<rect x="32" y="126" width="96" height="20" rx="9" fill="url(#thr-gold)"/>' +
    '<rect x="20" y="108" width="16" height="34" rx="7" fill="url(#thr-gold)"/>' +
    '<rect x="124" y="108" width="16" height="34" rx="7" fill="url(#thr-gold)"/>' +
    '<rect x="42" y="146" width="15" height="40" rx="6" fill="url(#thr-gold)"/>' +
    '<rect x="103" y="146" width="15" height="40" rx="6" fill="url(#thr-gold)"/>' +
    '<rect x="32" y="178" width="96" height="13" rx="6" fill="url(#thr-gold)"/>' +
    '<circle cx="80" cy="72" r="9" fill="#ff4d7d"/>' +
    '<circle cx="80" cy="72" r="4" fill="#ffd23f"/>' +
    "</svg>";

  const CROWN =
    '<svg class="crown-svg" viewBox="0 0 100 70" aria-hidden="true">' +
    '<path d="M8 62h84l-6-44-20 18L50 6 34 36 14 18z" fill="#ffd23f" stroke="#b87800" stroke-width="4" stroke-linejoin="round"/>' +
    '<circle cx="50" cy="46" r="6" fill="#ff4d7d"/><circle cx="24" cy="44" r="4.5" fill="#5fe0d4"/><circle cx="76" cy="44" r="4.5" fill="#5fe0d4"/>' +
    "</svg>";

  /* ------------------------------------------------------------- คอนเฟตติ */
  function confetti(canvas, opts) {
    if (window.FX && FX.confetti && FX.confetti !== confetti) return FX.confetti(canvas, opts);
    if (!canvas) return;
    const o = Object.assign({ ms: 3600, count: 160 }, opts || {});
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || canvas.clientWidth || 800);
    const h = Math.max(240, rect.height || canvas.clientHeight || 500);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = ["#ffd23f", "#ff4d7d", "#57b4ff", "#7ee081", "#c79bff", "#ffffff", "#ff9f7a"];
    const parts = [];
    for (let i = 0; i < o.count; i++) {
      parts.push({
        x: w * (0.2 + Math.random() * 0.6), y: h * (0.35 + Math.random() * 0.2),
        vx: (Math.random() - 0.5) * 9, vy: -6 - Math.random() * 9,
        s: 5 + Math.random() * 8, rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35, c: colors[(Math.random() * colors.length) | 0],
        shape: Math.random() < 0.35 ? "circle" : "rect"
      });
    }
    const start = performance.now();
    let raf = 0;
    function frame(t) {
      const el = t - start;
      g.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.vy += 0.28; p.vx *= 0.995;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        const fade = el > o.ms - 700 ? Math.max(0, (o.ms - el) / 700) : 1;
        g.save();
        g.globalAlpha = fade;
        g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c;
        if (p.shape === "circle") { g.beginPath(); g.arc(0, 0, p.s * 0.5, 0, Math.PI * 2); g.fill(); }
        else g.fillRect(-p.s * 0.5, -p.s * 0.35, p.s, p.s * 0.7);
        g.restore();
      });
      if (el < o.ms) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  /* ------------------------------------------------------------ หน้าจอเต็ม */
  function render(el, players, opts) {
    if (!el) return;
    const o = opts || {};
    const list = (players || []).slice(0, 3);
    if (!list.length) { el.innerHTML = '<p class="muted small tc">ยังไม่มีผู้เล่น</p>'; return; }

    const slot = (p, rank) => {
      if (!p) return '<div class="pod pod-' + rank + ' empty"><div class="pod-figure"></div><div class="pod-base b' + rank + '"><span class="pod-rank">' + rank + '</span></div></div>';
      const isHero = rank === 1;
      return '<div class="pod pod-' + rank + '">' +
        '<div class="pod-figure">' +
        (isHero ? THRONE : "") +
        '<div class="pod-char">' + charSvg(p.nickname, { avatar: p.avatar }) + "</div>" +
        (isHero ? '<div class="pod-crown">' + CROWN + "</div>" : "") +
        (isHero ? '<div class="pod-sparkles"><i></i><i></i><i></i><i></i><i></i></div>' : "") +
        "</div>" +
        '<div class="pod-base b' + rank + '"><span class="pod-rank">' + rank + "</span></div>" +
        '<div class="pod-name">' + escaped(p.nickname) + "</div>" +
        '<div class="pod-score">' + (window.U ? U.fmt(p.score) : p.score) + "</div>" +
        "</div>";
    };

    el.innerHTML =
      '<div class="podium' + (o.animate === false ? "" : " go") + '">' +
      '<div class="podium-rays" aria-hidden="true"></div>' +
      '<canvas class="podium-confetti" aria-hidden="true"></canvas>' +
      '<div class="podium-row">' +
      slot(list[1], 2) + slot(list[0], 1) + slot(list[2], 3) +
      "</div>" +
      '<div class="podium-caption">' + escaped(o.animate === false ? (o.caption || "ผู้ชนะ") : "") + "</div>" +
      "</div>";

    clearTimers();
    if (o.animate === false) return;

    /* ลำดับเปิดตัวแบบให้ได้ลุ้น: อันดับ 3 → อันดับ 2 → (กลองรัว) → แชมป์ + มงกุฎ + พลุ
       คืนค่า "เวลาที่แชมป์เปิดตัว" (ms) ให้ผู้เรียกใช้นัดเอฟเฟคอื่นต่อได้ */
    const canvas = el.querySelector(".podium-confetti");
    const pod = (n) => el.querySelector(".pod-" + n);
    const snd = (name, arg) => { if (window.Snd) { try { Snd.play(name, arg); } catch (e) { } } };
    const at = (ms, fn) => { timers.push(setTimeout(fn, ms)); };
    const reveal = (n) => { const x = pod(n); if (x) x.classList.add("show"); };
    const has = (n) => !!list[n - 1];
    const cap = el.querySelector(".podium-caption");
    const say = (txt) => { if (cap) { cap.textContent = txt; cap.classList.remove("blink"); void cap.offsetWidth; cap.classList.add("blink"); } };

    let t = 700;
    if (cap) cap.classList.add("on");
    say("และผู้ชนะคือ…");
    if (has(3)) {
      at(t, () => { say("อันดับ 3"); snd("drumroll", 1300); });
      at(t + 1400, () => { reveal(3); snd("correct"); confetti(canvas, { ms: 2200, count: 50 }); });
      t += 4300;
    }
    if (has(2)) {
      at(t, () => { say("อันดับ 2"); snd("drumroll", 1500); });
      at(t + 1600, () => { reveal(2); snd("correct"); confetti(canvas, { ms: 2400, count: 70 }); });
      t += 4700;
    }
    at(t, () => { say("และแชมป์ได้แก่…"); snd("drumroll", 2400); snd("heartbeat"); });
    at(t + 1200, () => snd("heartbeat"));
    const champAt = t + 2600;
    at(champAt, () => {
      reveal(1);
      el.querySelector(".podium").classList.add("champ");
      snd("podium");
    });
    at(champAt + 1500, () => { snd("cheer"); confetti(canvas, { ms: 5200, count: 220 }); });
    at(champAt + 2400, () => say(o.caption || "ยินดีด้วยกับผู้ชนะ"));
    at(champAt + 3600, () => confetti(canvas, { ms: 3200, count: 110 }));
    return { champAt, doneAt: champAt + 3200 };
  }
  let timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* --------------------------------------------------------- มือถือผู้เล่น */
  function mini(el, player, opts) {
    if (!el || !player) return;
    const o = opts || {};
    const rank = Number(player.rank || 0);
    el.innerHTML =
      '<div class="podium-mini go rank' + rank + '">' +
      '<canvas class="mini-confetti" aria-hidden="true"></canvas>' +
      '<div class="mini-pedestal">' +
      (rank === 1 ? THRONE : "") +
      '<div class="mini-char">' + charSvg(player.nickname, { avatar: player.avatar }) + "</div>" +
      (rank === 1 ? '<div class="mini-crown">' + CROWN + "</div>" : "") +
      "</div>" +
      (o.caption ? '<div class="mini-caption">' + escaped(o.caption) + "</div>" : "") +
      "</div>";
    if (rank >= 1 && rank <= 3 && o.animate !== false) {
      // หน่วงให้หน้าจอแสดงก่อน เพื่อวัดขนาด canvas ได้ถูกต้อง
      setTimeout(() => confetti(el.querySelector(".mini-confetti"), { ms: 2600, count: 90 }), 420);
      if (window.Snd) setTimeout(() => Snd.play(rank === 1 ? "podium" : "correct"), 200);
    }
  }

  window.Podium = { render, mini, confetti, charSvg, cancel: clearTimers };
})();
