/* ============================================================================
   ONLIVE QUIZ — ลูกเล่น/เอฟเฟคบนจอ (FX)
   ----------------------------------------------------------------------------
   ใช้ทั้งจอผู้จัดและมือถือผู้เล่น
     FX.onJoin(el, { nickname, avatar })   → ป้ายชื่อเด้งเข้ามาแบบเกมตอบคำถามสด + ประกาย
     FX.burst(x,y)                         → ประกายกระจาย
     FX.confetti(canvas, opts)             → คอนเฟตติ (ใช้ในพอดัม)
     FX.raiseHand / FX.sparkle              → ลูกเล่นเล็ก ๆ
     FX.parade(el, players)                → ขบวนตัวละครในห้องรอ
   ทุกฟังก์ชันเคารพ prefers-reduced-motion (จะไม่เล่นอนิเมชันหนัก)
   ============================================================================ */
(function () {
  const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function host() {
    let h = document.querySelector(".join-toast-host");
    if (!h) { h = document.createElement("div"); h.className = "join-toast-host"; document.body.appendChild(h); }
    return h;
  }

  /* ป้ายชื่อผู้เล่นเด้งเข้ามา (ใช้บนจอผู้จัดที่แชร์อยู่) */
  function onJoin(p) {
    if (!p || !p.nickname) return;
    const h = host();
    const av = window.Avatars ? Avatars.svg(p.avatar, { cls: "jt-av" }) : "";
    const el = document.createElement("div");
    el.className = "join-toast";
    // ให้ป้ายซ้อนกันแบบสุ่มเล็กน้อยเมื่อเข้าพร้อมกัน
    el.style.top = (14 + Math.random() * 12) + "%";
    el.style.left = (50 + (Math.random() * 10 - 5)) + "%";
    el.innerHTML = '<span class="jt-av">' + av + "</span>" +
      '<span class="jt-star">✦</span> <b>' + esc(p.nickname) + "</b> เข้าร่วมแล้ว!";
    h.appendChild(el);

    const burst = document.createElement("div");
    burst.className = "join-burst";
    burst.style.top = el.style.top;
    burst.style.left = el.style.left;
    const n = reduce() ? 0 : 10;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("i");
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const r = 70 + Math.random() * 110;
      s.style.setProperty("--bx", Math.cos(a) * r + "px");
      s.style.setProperty("--by", Math.sin(a) * r + "px");
      s.style.background = ["#f8d800", "#ffffff", "#ff5d8f", "#5fe0d4"][i % 4];
      burst.appendChild(s);
    }
    h.appendChild(burst);

    setTimeout(() => { el.remove(); }, 2200);
    setTimeout(() => { burst.remove(); }, 1000);
  }

  /* คอนเฟตติ (canvas) — ใช้ซ้ำได้ */
  function confetti(canvas, opts) {
    if (!canvas) return;
    const o = Object.assign({ ms: 3200, count: 140 }, opts || {});
    if (reduce()) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || canvas.clientWidth || 800);
    const h = Math.max(240, rect.height || canvas.clientHeight || 500);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#f8d800", "#ff4d7d", "#57b4ff", "#7ee081", "#c79bff", "#ffffff", "#ff9f7a"];
    const parts = [];
    for (let i = 0; i < o.count; i++) {
      parts.push({
        x: w * (0.15 + Math.random() * 0.7), y: h * (0.3 + Math.random() * 0.25),
        vx: (Math.random() - 0.5) * 9, vy: -6 - Math.random() * 9,
        s: 5 + Math.random() * 8, rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35, c: colors[(Math.random() * colors.length) | 0],
        shape: Math.random() < 0.3 ? "circle" : Math.random() < 0.35 ? "star" : "rect"
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
        else if (p.shape === "star") {
          g.beginPath();
          for (let k = 0; k < 5; k++) {
            const a1 = (Math.PI * 2 * k) / 5 - Math.PI / 2;
            const a2 = a1 + Math.PI / 5;
            g.lineTo(Math.cos(a1) * p.s * 0.7, Math.sin(a1) * p.s * 0.7);
            g.lineTo(Math.cos(a2) * p.s * 0.3, Math.sin(a2) * p.s * 0.3);
          }
          g.closePath(); g.fill();
        } else g.fillRect(-p.s * 0.5, -p.s * 0.35, p.s, p.s * 0.7);
        g.restore();
      });
      if (el < o.ms) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  /* เอฟเฟคตอนจบ: ชื่อผู้ชนะลอยขึ้นกลางจอ */
  function winnerBanner(name, rank) {
    const h = host();
    const el = document.createElement("div");
    el.className = "join-toast winner";
    el.style.top = "8%";
    el.innerHTML = '<span class="jt-star">🏆</span> <b>' + esc(name) + "</b>";
    h.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* พลุฉลองเต็มจอ — จรวดพุ่งขึ้นแล้วแตกเป็นประกาย (canvas ลอยทับทั้งหน้า ไม่บังการคลิก)
     FX.fireworks({ ms: 12000, rate: 520, sound: true }) → คืนฟังก์ชันสำหรับหยุด */
  let fwStop = null;
  function fireworks(opts) {
    const o = Object.assign({ ms: 12000, rate: 520, sound: true }, opts || {});
    if (fwStop) { fwStop(); fwStop = null; }
    if (reduce()) return () => { };
    const canvas = document.createElement("canvas");
    canvas.className = "fx-fireworks";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    const g = canvas.getContext && canvas.getContext("2d");
    if (!g) { canvas.remove(); return () => { }; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0;
    const fit = () => {
      w = window.innerWidth || 1280; h = window.innerHeight || 720;
      canvas.width = w * dpr; canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);

    const HUES = [48, 340, 205, 130, 275, 18, 175];
    const rockets = [], sparks = [];
    let raf = 0, dead = false, lastLaunch = 0, lastSound = 0;
    const start = performance.now();

    function launch(t) {
      const x = w * (0.1 + Math.random() * 0.8);
      rockets.push({
        x, y: h + 10, vx: (Math.random() - 0.5) * 2.2,
        vy: -(h * 0.0125 + 6 + Math.random() * 4),
        ty: h * (0.12 + Math.random() * 0.38), hue: HUES[(Math.random() * HUES.length) | 0], trail: []
      });
      if (o.sound && window.Snd && t - lastSound > 900) { lastSound = t; try { Snd.play("firework"); } catch (e) { } }
    }
    function explode(r) {
      const n = 46 + ((Math.random() * 40) | 0);
      const ring = Math.random() < 0.3;
      const hue2 = HUES[(Math.random() * HUES.length) | 0];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const sp = ring ? 5.2 + Math.random() * 0.6 : 1.5 + Math.random() * 5.2;
        sparks.push({
          x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, decay: 0.011 + Math.random() * 0.012,
          hue: i % 3 === 0 ? hue2 : r.hue, size: 1.6 + Math.random() * 1.9, tw: Math.random() < 0.3
        });
      }
    }
    function frame(t) {
      if (dead) return;
      const el = t - start;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      if (el < o.ms && t - lastLaunch > o.rate * (0.55 + Math.random() * 0.9)) {
        lastLaunch = t; launch(t);
        if (Math.random() < 0.35) launch(t);
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.trail.push([r.x, r.y]); if (r.trail.length > 9) r.trail.shift();
        r.x += r.vx; r.y += r.vy; r.vy += 0.11;
        g.strokeStyle = "hsla(" + r.hue + ",100%,78%,.85)"; g.lineWidth = 2.4; g.lineCap = "round";
        g.beginPath(); g.moveTo(r.trail[0][0], r.trail[0][1]); g.lineTo(r.x, r.y); g.stroke();
        if (r.y <= r.ty || r.vy >= -1) { explode(r); rockets.splice(i, 1); }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.vx *= 0.972; p.vy = p.vy * 0.972 + 0.055;
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        const al = p.tw ? p.life * (0.45 + Math.random() * 0.55) : p.life;
        g.fillStyle = "hsla(" + p.hue + ",100%," + (58 + p.life * 30) + "%," + al + ")";
        g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + p.life * 0.6), 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = "source-over";
      if (el < o.ms || rockets.length || sparks.length) raf = requestAnimationFrame(frame);
      else stop();
    }
    function stop() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      canvas.remove();
      if (fwStop === stop) fwStop = null;
    }
    raf = requestAnimationFrame(frame);
    fwStop = stop;
    return stop;
  }
  function stopFireworks() { if (fwStop) { fwStop(); fwStop = null; } }

  window.FX = { onJoin, confetti, winnerBanner, fireworks, stopFireworks, reduce };
})();
