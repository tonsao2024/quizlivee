/* หน้าผู้จัด — เปิดห้อง / คุมเกม / เฉลย / กระดานคะแนน */
(function () {
  const { $, $$, toast, esc, fmt, param } = U;

  let roomId = param("room");
  const quizParam = param("quiz");
  let pin = "";
  let snap = null;
  let offset = 0;
  let pollInt = null;
  let tickInt = null;
  let statsInt = null;
  let channel = null;
  let renderedKey = "";
  let autoRevealedKey = "";
  let busy = false;
  let qrFocusReturn = null;
  const COLOR = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const QUESTION_BACKGROUNDS = ["aurora", "sunset", "ocean", "forest", "galaxy", "candy", "midnight", "coral", "mint", "gold"];
  function setQuestionBackground(el, question) {
    if (!el) return;
    QUESTION_BACKGROUNDS.forEach((key) => el.classList.remove("qbg-" + key));
    const key = QUESTION_BACKGROUNDS.includes(question && question.background) ? question.background : "aurora";
    el.classList.add("qbg-" + key);
  }

  const show = (id) => $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */
  (async function boot() {
    const user = await API.currentUser().catch(() => null);
    if (!user) { location.replace("index.html#host"); return; }
    $("#btn-logout").classList.remove("hidden");
    $("#btn-logout").addEventListener("click", async () => { await API.signOut(); location.href = "index.html"; });

    if (roomId) { startRun(); return; }

    if (quizParam) {
      try {
        const r = await API.createRoom(quizParam, false);
        roomId = r.room_id;
        history.replaceState({}, "", "host.html?room=" + roomId);
        startRun();
      } catch (e) { toast(e.message, "err", 4000); showPick(); }
      return;
    }
    showPick();
  })();

  async function showPick() {
    show("s-pick");
    const list = $("#pick-list");
    list.innerHTML = '<div class="loader"></div>';
    try {
      const quizzes = await API.listQuizzes();
      if (!quizzes.length) {
        list.innerHTML = '<p class="muted small">ยังไม่มีชุดคำถาม — <a href="admin.html" style="color:#b8a6ff">ไปสร้างชุดแรก</a></p>';
        return;
      }
      list.innerHTML = quizzes.map((q) =>
        '<div class="quiz-card"><div class="row"><div class="quiz-emoji">' + esc((q.title || "?").trim().charAt(0)) + "</div>" +
        '<div><div style="font-weight:800">' + esc(q.title) + "</div>" +
        '<div class="tiny muted">' + q.question_count + " ข้อ" + (Number(q.max_players) > 0 ? " · สูงสุด " + q.max_players + " คน" : " · ไม่มีเพดานต่อชุด (โควตารวมทุกห้อง 120 คน)") + "</div></div></div>" +
        '<button class="btn btn-primary btn-block" data-quiz="' + q.id + '">เปิดห้องเล่นสด</button></div>'
      ).join("");
      $$("[data-quiz]", list).forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "กำลังเปิดห้อง…";
        try {
          const r = await API.createRoom(b.dataset.quiz, false);
          location.href = "host.html?room=" + r.room_id;
        } catch (e) { toast(e.message, "err"); b.disabled = false; b.textContent = "เปิดห้องเล่นสด"; }
      }));
    } catch (e) {
      list.innerHTML = '<p class="muted small">โหลดรายการไม่สำเร็จ: ' + esc(e.message) + "</p>";
    }
  }

  /* ------------------------------------------------------------------ */
  /* run loop                                                           */
  /* ------------------------------------------------------------------ */
  function startRun() {
    bindActions();
    pollInt = setInterval(fetchSnapshot, 2500);
    tickInt = setInterval(tickTimer, 120);
    fetchSnapshot();
  }

  async function fetchSnapshot() {
    try {
      const s = await API.hostSnapshot(roomId);
      if (s.error) throw Object.assign(new Error(s.error), { code: s.error });
      snap = s;
      pin = s.pin;
      if (s.server_now) offset = new Date(s.server_now).getTime() - Date.now();
      if (!channel) channel = API.subscribeRoom(pin, () => { });
      render();
    } catch (e) {
      if (e.code === "forbidden" || e.message === "forbidden") {
        toast("คุณไม่มีสิทธิ์ในห้องนี้", "err"); setTimeout(() => location.href = "admin.html", 1200);
      } else if (e.code === "room_not_found") {
        toast("ไม่พบห้องนี้", "err"); setTimeout(() => location.href = "admin.html", 1200);
      } else console.warn(e);
    }
  }

  function broadcast() { if (channel) channel.send(); }

  /* ------------------------------------------------------------------ */
  /* render                                                             */
  /* ------------------------------------------------------------------ */
  function render() {
    if (!snap) return;
    $("#top-quiz").textContent = snap.quiz_title;
    $("#top-quiz").classList.remove("hidden");

    showMode = snap.show_options || "text";     // ค่าโหมดแสดงตัวเลือกมาจากเซิร์ฟเวอร์เสมอ
    const st = snap.status;
    // PIN แสดงจุดเดียวในห้องรอ (ใต้ QR) — ชิปบนแถบบนโผล่หลังเกมเริ่มแล้วเท่านั้น
    $("#top-pin").textContent = snap.pin;
    $("#top-pin").classList.toggle("hidden", st === "lobby");
    if (st !== "lobby" && qrOpen()) closeQr(false);
    document.body.dataset.stage = st;
    const pill = $("#top-status");
    pill.classList.remove("hidden");
    const label = { lobby: "รอผู้เข้าร่วม", question: "กำลังถาม", reveal: "เฉลย", leaderboard: "กระดานคะแนน", ended: "จบเกม" }[st] || st;
    pill.className = "pill " + (st === "lobby" ? "pill-warn" : st === "ended" ? "" : "pill-live");
    pill.innerHTML = (st === "lobby" || st === "ended" ? "" : '<i class="dot"></i>') + label;

    announceJoins(snap.players || []);

    const key = st + ":" + snap.current_index + ":" + (snap.question ? snap.question.id : "");
    const changed = key !== renderedKey;

    if (st === "lobby") { if (changed) { renderLobby(); show("s-lobby"); } updateLobby(); }
    else if (st === "question") { if (changed) { renderQuestion(); show("s-question"); } updateQuestion(); }
    else if (st === "reveal") { if (changed) { renderReveal(); show("s-reveal"); } }
    else if (st === "leaderboard") { if (changed) { renderLb(); show("s-lb"); } }
    else if (st === "ended") { if (changed) { renderEnded(); show("s-ended"); } }

    if (changed) {
      renderedKey = key;
      if (st !== "ended") stopCelebration();
      if (st === "lobby") lbPrev = null;
      stageSound(st);
      scheduleAuto();
      paintAuto();
      if (st === "question") startStatsPolling();
      else stopStatsPolling();
      if (st === "reveal" || st === "ended") stopStatsPolling();
    }
  }

  /* ---------- เสียงประกอบเวที ---------- */
  /* เพลงเปลี่ยนตามฉากอัตโนมัติ:
       ห้องรอ → เพลงห้องรอ · ถามคำถาม → สุ่มเพลง A/B/C ที่เลือกไว้ (ไม่ซ้ำติดกัน)
       เฉลย → เพลงลุ้น · กระดานคะแนน → เพลงคึกคัก · จบเกม → เพลงฉลอง (เริ่มตอนเปิดตัวแชมป์) */
  function sceneMusic(st) {
    if (!window.Snd) return;
    if (st === "lobby") Snd.music("lobby");
    else if (st === "question") Snd.questionMusic(snap ? snap.current_index : 0);
    else if (st === "reveal") Snd.music("reveal");
    else if (st === "leaderboard") Snd.music("leaderboard");
    else if (st === "ended") Snd.music("ended");
  }
  function stageSound(st) {
    if (!window.Snd) return;
    try {
      if (st === "lobby") sceneMusic(st);
      else if (st === "question") {
        Snd.resetCountdown();
        sceneMusic(st);
        Snd.play("suspense");
        setTimeout(() => { try { Snd.play("start"); } catch (e) { } }, 380);
      } else if (st === "reveal") {
        sceneMusic(st);
        Snd.play("drumroll", 700);
        setTimeout(() => { try { Snd.play("reveal"); } catch (e) { } }, 520);
      } else if (st === "leaderboard") { sceneMusic(st); Snd.play("whoosh"); }
      else if (st === "ended") {
        Snd.stopMusic();          // เงียบไว้ให้ลุ้น — เพลงฉลองเริ่มตอนเปิดตัวแชมป์
      }
    } catch (e) { }
  }

  /* ---------- lobby ---------- */
  function shortUrl() { return U.publicUrl().replace(/^https?:\/\//, "").replace(/\/$/, ""); }
  function renderLobby() {
    const url = U.joinUrl(pin);
    const qr = U.qrSvg(url);
    $("#qr").innerHTML = qr;
    $("#qr-pin").textContent = pin;   // PIN แสดงจุดเดียว: ใต้ QR Code
    $("#joinurl").innerHTML = '<span class="joinurl-label">ลิงก์เข้าร่วม</span><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(shortUrl()) + "</a>";
    $("#qr-modal-code").innerHTML = qr;
    $("#qr-modal-pin").textContent = pin;
    $("#qr-modal-url").textContent = shortUrl();
    $("#lobby-quiz").textContent = snap.quiz_title + " · " + snap.question_count + " ข้อ";
    $("#chk-late").checked = !!snap.allow_late;
    const grid = $("#players");           // เริ่มรอบใหม่ → วาดการ์ดผู้เล่นใหม่ทั้งหมด
    if (grid) { grid.innerHTML = ""; grid.className = "players-grid empty"; }
    paintAuto();
  }
  function openQr() {
    const modal = $("#qr-modal");
    if (!modal || !modal.classList.contains("hidden")) return;
    qrFocusReturn = document.activeElement;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("qr-open");
    $("#qr").setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => $("#qr-modal-close").focus());
    if (window.Snd) { try { Snd.play("pop"); } catch (e) { /* เสียงไม่ควรขวางการขยาย QR */ } }
  }
  function closeQr(restoreFocus) {
    const modal = $("#qr-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("qr-open");
    $("#qr").setAttribute("aria-expanded", "false");
    const target = qrFocusReturn;
    qrFocusReturn = null;
    if (restoreFocus !== false && target && target.isConnected && typeof target.focus === "function") target.focus();
  }
  const qrOpen = () => !$("#qr-modal").classList.contains("hidden");

  let seenPlayers = null;        // Set ของ id ที่เคยเห็นแล้ว (ไว้เล่นเอฟเฟค "ชื่อเด้งเข้ามา")

  /* เล่นเอฟเฟค "ชื่อผู้เล่นเด้งเข้ามา" (แบบเกมตอบคำถามสด) เมื่อมีคนเข้าห้องใหม่ */
  function announceJoins(players) {
    if (!seenPlayers) { seenPlayers = new Set((players || []).map((p) => p.id)); return; }
    const fresh = (players || []).filter((p) => !seenPlayers.has(p.id));
    fresh.forEach((p, i) => {
      seenPlayers.add(p.id);
      setTimeout(() => {
        if (window.FX) FX.onJoin({ nickname: p.nickname, avatar: p.avatar });
        if (window.Snd) Snd.announce();
      }, i * 420);
    });
  }

  /* การ์ดผู้เล่นในห้องรอ: ใหญ่ มีสี + ตัวละคร ให้ผู้เล่นมองหาตัวเองบนจอผู้จัดได้ง่าย
     อัปเดตแบบ "เฉพาะส่วนต่าง" — คนเดิมไม่ถูกวาดใหม่ (ไม่กระพริบทุกครั้งที่ poll) */
  function hashStr(str) {
    let h = 2166136261; const t = String(str || "?");
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function avatarOf(p) {
    return window.Avatars ? Avatars.svg(p.avatar && Object.keys(p.avatar).length ? p.avatar : Avatars.fromName(p.nickname)) : esc(U.initials(p.nickname));
  }
  function updateLobby() {
    const players = snap.players || [];
    $("#lobby-count").textContent = players.length + (snap && snap.max_players > 0 ? " / " + snap.max_players + " คน" : " คน · โควตารวมทุกห้อง 120 คน");
    const grid = $("#players");
    if (!players.length) {
      grid.className = "players-grid empty";
      grid.textContent = "ยังไม่มีใครเข้าห้อง — แชร์ PIN ให้ผู้เข้าอบรม";
    } else {
      if (grid.classList.contains("empty")) { grid.textContent = ""; }
      const n = players.length;
      grid.className = "players-grid size-" + (n <= 10 ? "xl" : n <= 24 ? "lg" : n <= 48 ? "md" : "sm");
      const have = new Map();
      $$(".player-chip", grid).forEach((el) => have.set(el.dataset.id, el));
      const firstPaint = have.size === 0;
      players.forEach((p, i) => {
        const id = String(p.id != null ? p.id : p.nickname);
        const avKey = JSON.stringify(p.avatar || null);
        let el = have.get(id);
        if (!el) {
          el = document.createElement("div");
          el.className = "player-chip pc" + (hashStr(id + p.nickname) % 8) + (firstPaint ? "" : " enter");
          el.dataset.id = id;
          el.setAttribute("role", "listitem");
          el.innerHTML = '<span class="av" aria-hidden="true"></span><span class="nm"></span>';
          grid.appendChild(el);
        }
        have.delete(id);
        if (el.dataset.av !== avKey) { el.dataset.av = avKey; el.querySelector(".av").innerHTML = avatarOf(p); }
        const nm = el.querySelector(".nm");
        if (nm.textContent !== p.nickname) { nm.textContent = p.nickname; el.title = p.nickname; }
      });
      have.forEach((el) => el.remove());          // คนที่ออกจากห้องไปแล้ว
    }
    $("#btn-start").disabled = players.length === 0;
    syncShowSeg();
  }

  /* ---------- ตั้งค่าการแสดงตัวเลือก ---------- */
  let showMode = "text";
  function syncShowSeg() {
    const mode = snap ? (snap.show_options || "text") : "text";
    showMode = mode;
    $$("#seg-show button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    const note = $("#seg-note");
    if (note) note.textContent = mode === "shape"
      ? "· ผู้เล่นเห็นแค่สัญลักษณ์/สี"
      : "· ผู้เล่นเห็นข้อความตัวเลือกครบ";
  }
  function applyShapeMode() {
    const shapeOnly = showMode === "shape";
    $$("#h-answers .host-ans").forEach((el) => el.classList.toggle("only-shape", shapeOnly));
    $$("#r-answers .host-ans").forEach((el) => el.classList.remove("only-shape"));
  }

  /* ---------- question ---------- */
  function renderQuestion() {
    const q = snap.question;
    if (!q) return;
    setQuestionBackground($("#s-question"), q);
    $("#q-idx").textContent = "ข้อ " + (q.index + 1) + " / " + snap.question_count;
    $("#h-prompt").innerHTML = esc(q.prompt) +
      (q.image_url ? '<img class="qimg" src="' + esc(q.image_url) + '" alt="" style="margin-top:14px">' : "");
    $("#h-answers").innerHTML = q.options.map((opt, i) =>
      '<div class="host-ans ' + COLOR[i % 6] + '"><span class="sh">' + U.shapes(i) + '</span><span class="lbl">' + esc(opt) + "</span></div>"
    ).join("");
    applyShapeMode();
    $("#q-points").textContent = "ให้ " + fmt(q.points) + " คะแนน · " + q.time_limit + " วินาที";
    $("#answered-n").textContent = "0";
    $("#answered-bar").style.width = "0%";
  }

  function updateQuestion() {
    const total = snap.player_count || 0;
    const answered = snap.answered || 0;
    $("#answered-n").textContent = answered + (total ? " / " + total : "");
    $("#answered-bar").style.width = (total ? Math.min(100, (answered / total) * 100) : 0) + "%";
    // โหมดอัตโนมัติ: ทุกคนตอบครบแล้ว ไม่ต้องรอหมดเวลา → เฉลยเลย
    if (auto.on && snap.status === "question" && total > 0 && answered >= total) {
      const key = "auto:" + snap.current_index;
      if (autoRevealedKey !== key) { autoRevealedKey = key; setTimeout(doReveal, 1200); }
    }
  }

  /* ---------- reveal ---------- */
  function renderReveal() {
    const q = snap.question;
    if (!q) return;
    setQuestionBackground($("#s-reveal"), q);
    const correct = snap.correct_index;
    $("#r-title").textContent = "เฉลยข้อ " + (q.index + 1) + " / " + snap.question_count;
    $("#r-prompt").textContent = q.prompt;
    const shapeOnly = showMode === "shape";
    $("#r-answers").innerHTML = q.options.map((opt, i) =>
      '<div class="host-ans ' + COLOR[i % 6] + (i === correct ? " is-correct" : " not-correct") + '">' +
      '<span class="sh">' + U.shapes(i) + "</span>" +
      '<span class="lbl">' + esc(opt) + "</span>" +
      (i === correct ? '<span style="margin-left:auto">✓</span>' : "") + "</div>"
    ).join("");
    const rnote = $("#r-mode-note");
    if (rnote) {
      rnote.textContent = shapeOnly
        ? "โหมดสัญลักษณ์สี — ข้อนี้ผู้เล่นตอบด้วยสัญลักษณ์ ตอนเฉลยจึงแสดงข้อความเต็มให้ทุกคนเห็นคำตอบ"
        : "";
      rnote.classList.toggle("hidden", !shapeOnly);
    }

    const dist = snap.distribution || {};
    const counts = q.options.map((_, i) => Number(dist[String(i)] || 0));
    const max = Math.max(1, ...counts);
    $("#r-bars").innerHTML = q.options.map((opt, i) =>
      '<div class="bar-row"><div>' +
      '<div class="bar-name">' + U.shapes(i) + " " + esc(opt) + "</div>" +
      '<div class="bar-wrap"><div class="bar-fill ' + COLOR[i % 6] + '" ' +
      'style="width:' + (counts[i] / max * 100) + '%;background:var(--a' + ((i % 6) + 1) + ')"></div></div>' +
      "</div>" +
      '<div class="n">' + counts[i] + "</div></div>"
    ).join("");
    $("#r-stat").textContent = "ตอบถูก " + (snap.correct || 0) + " / " + (snap.answered || 0) + " คน";
    $("#r-count").textContent = (snap.player_count || 0) + " คนในห้อง";
    $("#btn-next").textContent = (q.index + 1 >= snap.question_count) ? "จบเกม →" : "ข้อต่อไป →";
  }

  /* ---------- leaderboard (แท่งอันดับแข่งกัน) ---------- */
  /* จำอันดับ/คะแนนของ "ครั้งก่อนที่โชว์กระดาน" ไว้ → ครั้งนี้เริ่มวาดจากตำแหน่งเดิม
     แล้วให้แท่งวิ่งสลับขึ้น–ลงไปยังอันดับใหม่ พร้อมคะแนนไหลขึ้นและป้าย ▲▼ */
  const LB_MAX = 8;
  let lbPrev = null;             // Map(id → { rank, score })
  let lbTimers = [];
  const pid = (p) => String(p.id != null ? p.id : p.nickname);
  function countUp(el, from, to, ms) {
    if (!el) return;
    if (from === to || (window.FX && FX.reduce())) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderLb() {
    lbTimers.forEach(clearTimeout); lbTimers = [];
    const all = snap.players || [];
    const top = all.slice(0, LB_MAX);
    const el = $("#h-lb");
    $("#lb-count").textContent = all.length + " คน";
    $("#lb-sub").textContent = "หลังข้อ " + (snap.current_index + 1) + " / " + snap.question_count;
    const last = snap.current_index + 1 >= snap.question_count;
    $("#btn-next2").textContent = last ? "จบเกม →" : "ข้อต่อไป →";
    if (!top.length) { el.innerHTML = '<p class="muted small tc" style="color:#fff">ยังไม่มีผู้เล่น</p>'; return; }

    const prev = lbPrev;
    const max = Math.max(1, ...top.map((p) => Number(p.score) || 0));
    const info = top.map((p, i) => {
      const old = prev ? prev.get(pid(p)) : null;
      const oldRank = old ? old.rank : null;                       // อันดับเดิม (นับจาก 0) ในทั้งห้อง
      const oldScore = old ? old.score : 0;
      return {
        p, i, oldScore,
        from: !prev ? i : (oldRank == null || oldRank >= LB_MAX ? LB_MAX + 0.4 : oldRank),   // เข้ามาใหม่ → พุ่งมาจากข้างล่าง
        delta: !prev || oldRank == null ? 0 : oldRank - i,
        isNew: !!prev && (oldRank == null || oldRank >= LB_MAX),
        gain: (Number(p.score) || 0) - oldScore
      };
    });

    el.innerHTML = info.map((r) => {
      const p = r.p, i = r.i;
      const medal = i === 0 ? " t1" : i === 1 ? " t2" : i === 2 ? " t3" : "";
      return '<div class="res-row lb-row lc' + (hashStr(pid(p) + p.nickname) % 8) + medal + '" data-id="' + esc(pid(p)) + '">' +
        '<div class="lb-rank">' + (i + 1) + "</div>" +
        '<span class="lb-av">' + avatarOf(p) + "</span>" +
        '<div class="lb-main">' +
        '<div class="lb-name"><span class="nm">' + esc(p.nickname) + "</span>" +
        '<span class="lb-move"></span>' +
        (p.streak >= 3 ? '<span class="lb-streak">🔥 ' + p.streak + "</span>" : "") + "</div>" +
        '<div class="lb-track"><i class="lb-fill" style="width:' + (prev ? Math.max(3, (r.oldScore / max) * 100) : 3) + '%"></i></div>' +
        "</div>" +
        '<div class="lb-gain"></div>' +
        '<div class="lb-score mono">' + fmt(prev ? r.oldScore : 0) + "</div></div>";
    }).join("");

    const rows = $$(".lb-row", el);
    const reduce = window.FX && FX.reduce();
    const gapPx = parseFloat((window.getComputedStyle(el).rowGap || "0")) || 0;
    const stepPx = rows[0] ? rows[0].offsetHeight + gapPx : 0;

    // 1) วางแต่ละแท่งไว้ที่ "อันดับเดิม" ก่อน
    rows.forEach((row, k) => {
      const r = info[k];
      if (!prev) { row.classList.add("lb-enter"); row.style.animationDelay = (k * 90) + "ms"; }
      else if (!reduce && stepPx && r.from !== r.i) {
        row.style.transition = "none";
        row.style.transform = "translateY(" + ((r.from - r.i) * stepPx) + "px)";
        if (r.isNew) row.style.opacity = "0";
        const rk = row.querySelector(".lb-rank");
        if (!r.isNew) rk.textContent = String(r.from + 1);
      }
    });
    void el.offsetWidth;

    // 2) แล้วปล่อยให้วิ่งไปอันดับใหม่ (คนอันดับล่างขยับก่อน ที่ 1 ขยับท้ายสุดให้ลุ้น)
    const startAt = prev ? 800 : 500;
    let anyUp = false;
    rows.forEach((row, k) => {
      const r = info[k];
      const delay = startAt + (prev ? (rows.length - 1 - k) * 130 : k * 90);
      lbTimers.push(setTimeout(() => {
        if (r.delta > 0 || r.isNew) row.classList.add("is-up");
        else if (r.delta < 0) row.classList.add("is-down");
        row.style.transition = "transform 1.05s cubic-bezier(.3,1.35,.45,1), opacity .5s ease";
        row.style.transform = "";
        row.style.opacity = "";
        row.querySelector(".lb-fill").style.width = Math.max(3, ((Number(r.p.score) || 0) / max) * 100) + "%";
        countUp(row.querySelector(".lb-score"), prev ? r.oldScore : 0, Number(r.p.score) || 0, 1000);
        if (prev && r.gain > 0) {
          const g = row.querySelector(".lb-gain");
          g.textContent = "+" + fmt(r.gain); g.classList.add("on");
        }
      }, delay));
      lbTimers.push(setTimeout(() => {
        row.querySelector(".lb-rank").textContent = String(k + 1);
        const mv = row.querySelector(".lb-move");
        if (r.isNew) { mv.textContent = "★ เข้าท็อป " + LB_MAX; mv.className = "lb-move up on"; }
        else if (r.delta > 0) { mv.textContent = "▲ " + r.delta; mv.className = "lb-move up on"; }
        else if (r.delta < 0) { mv.textContent = "▼ " + (-r.delta); mv.className = "lb-move down on"; }
        row.classList.add("landed");
      }, delay + 950));
      if (r.delta > 0 || r.isNew) anyUp = true;
    });
    if (prev && anyUp && window.Snd) {
      lbTimers.push(setTimeout(() => { try { Snd.play("whoosh"); } catch (e) { } }, startAt));
      lbTimers.push(setTimeout(() => { try { Snd.play("rankup"); } catch (e) { } }, startAt + rows.length * 130 + 700));
    }

    lbPrev = new Map(all.map((p, i) => [pid(p), { rank: i, score: Number(p.score) || 0 }]));
  }

  /* ---------- จบเกม ---------- */
  const END_MAX = 60;
  let podiumKey = "";
  let endTimers = [];
  /* ตารางสรุปยาวเกินจอ → เลื่อนขึ้น–ลงช้า ๆ เอง (หยุดเมื่อเอาเมาส์ไปชี้/เลื่อนเอง) */
  let endScrollInt = null;
  function startEndScroll() {
    stopEndScroll();
    const lb = $("#end-lb");
    if (!lb || (window.FX && FX.reduce())) return;
    let dir = 1, hold = 0, hover = false;
    lb.onmouseenter = () => { hover = true; };
    lb.onmouseleave = () => { hover = false; };
    endScrollInt = setInterval(() => {
      const maxTop = lb.scrollHeight - lb.clientHeight;
      if (maxTop <= 30 || hover) return;
      if (hold > 0) { hold--; return; }
      lb.scrollTop += dir;
      if (lb.scrollTop >= maxTop - 1 && dir > 0) { dir = -1; hold = 70; }
      else if (lb.scrollTop <= 0 && dir < 0) { dir = 1; hold = 70; }
    }, 45);
  }
  function stopEndScroll() { if (endScrollInt) { clearInterval(endScrollInt); endScrollInt = null; } }
  function stopCelebration() {
    stopEndScroll();
    endTimers.forEach(clearTimeout); endTimers = [];
    if (window.FX && FX.stopFireworks) FX.stopFireworks();
    if (window.Podium && Podium.cancel) Podium.cancel();
  }
  function celebrate(ms) {
    if (window.FX && FX.fireworks) FX.fireworks({ ms: ms || 14000, rate: 480, sound: true });
  }
  function renderEnded() {
    const all = snap.players || [];
    const list = all.slice(0, END_MAX);
    const key = "end:" + roomId + ":" + all.length;
    const fresh = podiumKey !== key;
    const lb = $("#end-lb");
    // สองคอลัมน์ซ้าย–ขวา (เรียงลงมาทีละคอลัมน์) ให้เห็นได้เกือบทุกคนในจอเดียว
    const perCol = list.length <= 5 ? list.length : Math.ceil(list.length / 2);
    lb.style.gridTemplateRows = "repeat(" + Math.max(1, perCol) + ", auto)";
    lb.classList.toggle("one-col", list.length <= 5);
    renderRows(lb, list, fresh);
    $("#end-total").textContent = all.length + " คน" + (all.length > END_MAX ? " · แสดง " + END_MAX + " อันดับแรก" : "");
    if (!fresh) return;                     // ไม่ต้องเล่นแอนิเมชันซ้ำทุกครั้งที่ poll
    podiumKey = key;
    stopCelebration();
    let champAt = 0;
    if (window.Podium) {
      const r = Podium.render($("#end-podium"), all, { caption: "ยินดีด้วยกับผู้ชนะ" });
      champAt = (r && r.champAt) || 0;
    }
    const champ = all[0];
    const at = (ms, fn) => endTimers.push(setTimeout(fn, ms));
    // พลุ + เพลงฉลอง เริ่มพร้อมการเปิดตัวแชมป์
    at(champAt + 250, () => { celebrate(15000); sceneMusic("ended"); });
    if (champ && window.FX) at(champAt + 2200, () => FX.winnerBanner(champ.nickname));
    // ตารางสรุปค่อย ๆ เผยทีละแถวหลังรู้ผลแชมป์ (ไม่สปอยล์ก่อน)
    at(champAt + 1600, () => {
      $$("#end-lb .res-row").forEach((row, i) => {
        row.style.animationDelay = Math.min(i * 70, 2800) + "ms";
        row.classList.remove("wait"); row.classList.add("drop");
      });
    });
    // ฉลองเสร็จ → ย่อบัลลังก์ลง ให้ตารางสรุปมีที่แสดงได้หลายคนขึ้น แล้วค่อย ๆ เลื่อนให้เห็นครบทุกคน
    const hero = $("#s-ended .end-hero");
    if (hero) hero.classList.remove("small");
    at(champAt + 7000, () => { if (hero) hero.classList.add("small"); });
    at(champAt + 12000, startEndScroll);
  }

  function renderRows(el, rows, hidden) {
    if (!rows.length) { el.innerHTML = '<p class="muted small tc">ยังไม่มีผู้เล่น</p>'; return; }
    const keep = !hidden && el.querySelector(".res-row.wait");     // ยังรอเผยอยู่ → อย่าเผยก่อนเวลา
    el.innerHTML = rows.map((p, i) => {
      const cls = i === 0 ? "t1" : i === 1 ? "t2" : i === 2 ? "t3" : "";
      return '<div class="res-row' + (hidden || keep ? " wait" : "") + (i < 3 ? " top3" : "") + '">' +
        '<div class="rank ' + cls + '">' + (i + 1) + "</div>" +
        '<span class="res-av">' + (window.Avatars ? Avatars.svg(p.avatar || Avatars.fromName(p.nickname)) : "") + "</span>" +
        '<div class="nm" title="' + esc(p.nickname) + '">' + esc(p.nickname) + "</div>" +
        '<div class="tiny muted ok-n">ถูก ' + p.correct_count + " ข้อ</div>" +
        '<div class="mono sc">' + fmt(p.score) + "</div></div>";
    }).join("");
  }

  /* ---------- โหมดเล่นอัตโนมัติ ---------- */
  /* เปิดแล้วเกมเดินเองทั้งรอบ: หมดเวลา → เฉลย (ค้าง N วิ) → กระดานคะแนน (ค้าง ~5 วิ) → ข้อถัดไป … → ประกาศผู้ชนะ
     ผู้จัดกดปุ่มเองแทรกได้ตลอด และกด "หยุดอัตโนมัติ" ได้ทุกเมื่อ */
  const AUTO_KEY = "onlive.host.auto.v1";
  const auto = Object.assign({ on: false, revealSec: 6, lbSec: 5 }, (() => {
    try { return JSON.parse(localStorage.getItem(AUTO_KEY) || "{}") || {}; } catch (e) { return {}; }
  })());
  auto.on = !!auto.on;
  auto.revealSec = Math.max(2, Math.min(60, Number(auto.revealSec) || 6));
  auto.lbSec = Math.max(0, Math.min(60, Number(auto.lbSec) >= 0 ? Number(auto.lbSec) : 5));
  let autoTimer = null, autoTick = null;
  function saveAuto() { try { localStorage.setItem(AUTO_KEY, JSON.stringify(auto)); } catch (e) { } }
  function clearAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (autoTick) { clearInterval(autoTick); autoTick = null; }
    const bar = $("#auto-bar");
    if (bar) bar.classList.add("hidden");
  }
  function runAuto(sec, label, fn) {
    const bar = $("#auto-bar"), fill = $("#auto-bar-fill"), text = $("#auto-bar-text");
    const endAt = Date.now() + sec * 1000;
    const paint = () => { text.textContent = label + " ใน " + Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) + " วินาที"; };
    bar.classList.remove("hidden");
    fill.style.transition = "none"; fill.style.width = "0%";
    void fill.offsetWidth;
    fill.style.transition = "width " + sec + "s linear"; fill.style.width = "100%";
    paint();
    autoTick = setInterval(paint, 250);
    const fire = () => {
      if (busy) { autoTimer = setTimeout(fire, 300); return; }     // กำลังส่งคำสั่งอื่นอยู่ → รอแป๊บ
      clearAuto();
      fn();
    };
    autoTimer = setTimeout(fire, sec * 1000);
  }
  function scheduleAuto() {
    clearAuto();
    if (!auto.on || !snap) return;
    const st = snap.status;
    const last = snap.current_index + 1 >= snap.question_count;
    if (st === "reveal") {
      if (last) runAuto(auto.revealSec, "ประกาศผู้ชนะ", () => next());
      else if (auto.lbSec > 0) runAuto(auto.revealSec, "ไปกระดานคะแนน", goLeaderboard);
      else runAuto(auto.revealSec, "ข้อต่อไป", () => next());
    } else if (st === "leaderboard") {
      runAuto(auto.lbSec > 0 ? auto.lbSec : 5, last ? "ประกาศผู้ชนะ" : "ข้อต่อไป", () => next());
    }
  }
  function setAuto(on) {
    auto.on = !!on; saveAuto(); paintAuto(); scheduleAuto();
    // เปิดกลางข้อที่หมดเวลาไปแล้ว → เฉลยต่อให้เลย
    if (auto.on) autoRevealedKey = "";
  }
  function paintAuto() {
    $$("#seg-auto button").forEach((b) => b.classList.toggle("on", (b.dataset.auto === "1") === auto.on));
    const opts = $("#auto-opts"); if (opts) opts.classList.toggle("hidden", !auto.on);
    const rs = $("#sel-reveal-sec"), ls = $("#sel-lb-sec");
    if (rs) rs.value = String(auto.revealSec);
    if (ls) ls.value = String(auto.lbSec);
    const note = $("#auto-note");
    if (note) note.textContent = auto.on
      ? "▶ เล่นอัตโนมัติ: กดเริ่มครั้งเดียว เกมเดินเองจนประกาศผู้ชนะ (หมดเวลา/ตอบครบ → เฉลย " + auto.revealSec + " วิ" +
        (auto.lbSec > 0 ? " → อันดับ " + auto.lbSec + " วิ" : "") + " → ข้อต่อไป)"
      : "โหมดกดเอง: ผู้จัดกดเฉลย/ข้อต่อไปเองทุกขั้น";
    const start = $("#btn-start");
    if (start) start.textContent = auto.on ? "▶ เริ่มเกม (อัตโนมัติ)" : "เริ่มเกม →";
    const chip = $("#btn-auto-top");
    if (chip) {
      const st = snap ? snap.status : "";
      chip.classList.toggle("hidden", !snap || st === "lobby" || st === "ended");
      chip.classList.toggle("on", auto.on);
      chip.textContent = auto.on ? "▶ อัตโนมัติ: เปิด" : "⏸ อัตโนมัติ: ปิด";
    }
    const lbl = $("#lbl-chk-auto");
    if (lbl) lbl.classList.toggle("hidden", auto.on);       // โหมดอัตโนมัติเฉลยเองเสมอ
  }
  async function goLeaderboard() {
    if (busy || !snap || snap.status !== "reveal") return;
    busy = true;
    try { await API.setStatus(roomId, "leaderboard"); broadcast(); await fetchSnapshot(); }
    catch (e) { toast(e.message, "err"); }
    busy = false;
  }

  /* ---------- timer / stats ---------- */
  function tickTimer() {
    if (!snap || snap.status !== "question" || !snap.question_ends_at) return;
    const left = Math.max(0, new Date(snap.question_ends_at).getTime() - (Date.now() + offset));
    $("#host-timer").textContent = Math.ceil(left / 1000);
    $("#host-timer").style.color = left < 5000 ? "#ff8fa0" : "";
    $("#host-timer").classList.toggle("urgent", left < 5000);
    if (window.Snd) Snd.countdown(left);
    if (left <= 0 && (auto.on || $("#chk-auto").checked)) {
      const key = "auto:" + snap.current_index;
      if (autoRevealedKey !== key) { autoRevealedKey = key; doReveal(); }
    }
  }

  function startStatsPolling() {
    stopStatsPolling();
    statsInt = setInterval(async () => {
      if (!snap || snap.status !== "question" || !snap.question) return;
      try {
        const s = await API.hostStats(roomId, snap.question.id);
        if (s.error) return;
        snap.answered = s.answered;
        snap.correct = s.correct;
        snap.distribution = s.distribution;
        updateQuestion();
      } catch (e) { /* เงียบไว้ */ }
    }, 2500);   // ลดภาระฐานข้อมูล: ตัวเลข "ตอบแล้ว" ไม่จำเป็นต้องละเอียดระดับวินาที
  }
  function stopStatsPolling() { if (statsInt) { clearInterval(statsInt); statsInt = null; } }

  /* ------------------------------------------------------------------ */
  /* actions                                                            */
  /* ------------------------------------------------------------------ */
  function bindActions() {
    $("#btn-start").addEventListener("click", () => { if (window.Snd) Snd.unlock(); next(); });
    $("#btn-reveal").addEventListener("click", doReveal);
    $("#btn-next").addEventListener("click", () => next());
    $("#btn-next2").addEventListener("click", () => next());
    $("#btn-lb").addEventListener("click", goLeaderboard);

    /* โหมดเล่นอัตโนมัติ */
    $$("#seg-auto button").forEach((b) => b.addEventListener("click", () => {
      setAuto(b.dataset.auto === "1");
      if (window.Snd) Snd.play("click");
    }));
    $("#sel-reveal-sec").addEventListener("change", (e) => { auto.revealSec = Math.max(2, +e.target.value || 6); saveAuto(); paintAuto(); });
    $("#sel-lb-sec").addEventListener("change", (e) => { auto.lbSec = Math.max(0, +e.target.value || 0); saveAuto(); paintAuto(); });
    $("#btn-auto-top").addEventListener("click", () => {
      setAuto(!auto.on);
      toast(auto.on ? "เปิดเล่นอัตโนมัติ" : "หยุดเล่นอัตโนมัติ — กดปุ่มเองได้เลย", "ok", 1800);
    });
    $("#auto-bar-pause").addEventListener("click", () => { setAuto(false); toast("หยุดเล่นอัตโนมัติ — กดปุ่มเองได้เลย", "ok", 1800); });
    paintAuto();

    /* QR ขยายเต็มจอ — แยก overlay จาก layout เวที และรองรับเมาส์/สัมผัส/คีย์บอร์ด */
    $("#qr").addEventListener("click", openQr);
    $("#qr-modal-close").addEventListener("click", () => closeQr());
    $("#qr-modal").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeQr();
    });
    $("#btn-fireworks").addEventListener("click", () => { celebrate(9000); if (window.Snd) Snd.play("cheer"); });
    $("#btn-finish").addEventListener("click", async () => {
      await API.setStatus(roomId, "ended"); broadcast(); fetchSnapshot();
    });
    const restartBtn = $("#btn-restart-same");
    if (restartBtn) restartBtn.addEventListener("click", async () => {
      if (busy) return;
      if (!confirm("เริ่มรอบใหม่ในห้องเดิม? คะแนนทั้งหมดจะถูกรีเซ็ต แต่ผู้เล่นยังอยู่ในห้อง (ไม่ต้องสแกน QR ใหม่)")) return;
      busy = true;
      restartBtn.disabled = true;
      try {
        const r = await API.restartRoom(roomId);
        if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
        podiumKey = "";
        renderedKey = "";
        autoRevealedKey = "";
        lbPrev = null;
        stopCelebration();
        seenPlayers = null;              // ให้เอฟเฟคชื่อเด้งทำงานใหม่ในรอบถัดไป
        broadcast();
        await fetchSnapshot();
        toast("เริ่มรอบใหม่แล้ว · ผู้เล่น " + (r.players || 0) + " คนยังอยู่ในห้อง", "ok", 3200);
        if (window.Snd) { try { Snd.play("start"); } catch (e) { } }
      } catch (e) { toast(e.message, "err", 3600); }
      restartBtn.disabled = false;
      busy = false;
    });

    $("#btn-again").addEventListener("click", async () => {
      podiumKey = "";
      try {
        const r = await API.createRoom(snap.quiz_id, false);
        location.href = "host.html?room=" + r.room_id;
      } catch (e) { toast(e.message, "err"); }
    });
    $("#btn-copy").addEventListener("click", async () => {
      const url = U.joinUrl(pin);
      try { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว", "ok"); }
      catch (e) { prompt("คัดลอกลิงก์นี้:", url); }
    });
    $("#btn-open").addEventListener("click", () => window.open(U.joinUrl(pin), "_blank"));
    $$("#seg-show button").forEach((b) => b.addEventListener("click", async () => {
      const mode = b.dataset.mode;
      if (mode === showMode) return;
      showMode = mode;
      syncShowSeg();
      applyShapeMode();
      if (window.Snd) Snd.play("click");
      try { await API.setShowOptions(roomId, mode); broadcast(); }
      catch (e) { toast(e.message, "err"); fetchSnapshot(); }
    }));

    /* ปุ่มเปิด–ปิดเพลง/เอฟเฟคแบบเร็ว (แถบบนสุด ข้างปุ่มออก — ใช้ได้ทุกฉาก) */
    const bm = $("#btn-music"), bf = $("#btn-fx");
    const paintAudio = () => {
      if (!window.Snd) return;
      const m = !!Snd.get("music"), f = !!Snd.get("fx");
      if (bm) { bm.classList.toggle("off", !m); bm.innerHTML = icon(m, "music"); bm.title = m ? "ปิดเพลงพื้นหลัง" : "เปิดเพลงพื้นหลัง"; }
      if (bf) { bf.classList.toggle("off", !f); bf.innerHTML = icon(f, "fx"); bf.title = f ? "ปิดเอฟเฟคเสียง" : "เปิดเอฟเฟคเสียง"; }
    };
    const icon = (on, kind) => on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (kind === "music"
          ? '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/>'
          : '<path d="M4 9v6h3l4 4V5L7 9H4z"/><path d="M15 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>') + "</svg>"
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9v6h3l4 4V5L7 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>';
    if (bm) bm.addEventListener("click", () => {
      if (!window.Snd) return;
      Snd.unlock();
      Snd.set("music", !Snd.get("music"));
      if (Snd.get("music") && snap) {
        // เปิดกลับ → เล่นเพลงประจำฉากปัจจุบัน (ตอนจบเกม: เพลงฉลอง)
        sceneMusic(snap.status);
      }
      paintAudio();
    });
    if (bf) bf.addEventListener("click", () => {
      if (!window.Snd) return;
      Snd.unlock();
      Snd.set("fx", !Snd.get("fx"));
      if (Snd.get("fx")) Snd.play("click");
      paintAudio();
    });
    paintAudio();
    window.addEventListener("pointerdown", paintAudio, { once: true });

    $("#chk-late").addEventListener("change", async (e) => {
      try { await API.setAllowLate(roomId, e.target.checked); toast(e.target.checked ? "เปิดให้เข้าห้องกลางเกม" : "ปิดการเข้าห้องกลางเกม", "ok", 1800); }
      catch (err) { toast(err.message, "err"); }
    });

    document.addEventListener("keydown", (e) => {
      if (qrOpen()) {
        if (e.key === "Escape") { e.preventDefault(); closeQr(); return; }
        if (e.key === "Tab") {
          const focusable = $$("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])", $("#qr-modal"));
          if (!focusable.length) { e.preventDefault(); $("#qr-modal").focus(); return; }
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          return;
        }
        return; // ขณะ dialog เปิด ห้ามปุ่มลัดของเวทีทำงาน
      }
      // ปุ่ม/ลิงก์/ช่องกรอกที่โฟกัสอยู่ จัดการ Enter–Space ของตัวเอง (กันสั่งซ้ำสองครั้ง)
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName || "")) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (busy || !snap) return;
        if (snap.status === "lobby") next();
        else if (snap.status === "question") doReveal();
        else if (snap.status === "reveal" || snap.status === "leaderboard") next();
      }
    });
  }

  async function doReveal() {
    if (busy || !snap || snap.status !== "question") return;
    busy = true;
    try {
      await API.setStatus(roomId, "reveal");
      broadcast();
      await fetchSnapshot();
    } catch (e) { toast(e.message, "err"); }
    busy = false;
  }

  async function next() {
    if (busy) return;
    busy = true;
    try {
      const r = await API.nextQuestion(roomId);
      if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
      broadcast();
      await fetchSnapshot();
      if (r.finished) { show("s-ended"); renderEnded(); }
    } catch (e) { toast(e.message, "err", 3500); }
    busy = false;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchSnapshot();
  });

  /* เปิดให้เครื่องมือทดสอบฉีด snapshot แล้วเรนเดอร์ได้ (ไม่กระทบการใช้งานจริง) */
  window.__hostTest = {
    setSnap(s) { snap = s; pin = s.pin || pin; render(); },
    mode: () => showMode,
    auto: () => Object.assign({}, auto),
    setAuto
  };

  window.addEventListener("beforeunload", () => {
    if (channel) channel.close();
  });
})();
