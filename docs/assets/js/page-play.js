/* หน้าผู้เล่น — เข้าห้อง / ตอบคำถาม / ดูเฉลยและอันดับ */
(function () {
  const { $, $$, toast, esc, fmt, param } = U;
  const pin = String(param("pin") || "").replace(/\D/g, "").slice(0, 6);
  const STORE = "onlive.player." + pin;
  const NICK_KEY = "onlive.nickname";
  const AV_KEY = "onlive.avatar";

  let token = null;
  let state = null;
  let player = null;
  let answeredQid = null;
  let lastAnswer = null;
  let lastAnswerQid = null;
  const answerForQuestion = (qid) => lastAnswerQid === qid ? lastAnswer : null;
  let offset = 0;             // เวลาเซิร์ฟเวอร์ - เวลามือถือ (ms)
  let timerInt = null;
  let pollInt = null;
  let channel = null;
  let syncTimer = null;
  let timerQid = null;
  let lbQid = null;
  let wakeLock = null;
  let avatar = null;              // ตัวละครที่ผู้เล่นตกแต่ง
  let avPicker = null;
  let avSaveTimer = null;
  const QUESTION_BACKGROUNDS = ["aurora", "sunset", "ocean", "forest", "galaxy", "candy", "midnight", "coral", "mint", "gold"];
  function setQuestionBackground(el, question) {
    if (!el) return;
    QUESTION_BACKGROUNDS.forEach((key) => el.classList.remove("qbg-" + key));
    const key = QUESTION_BACKGROUNDS.includes(question && question.background) ? question.background : "aurora";
    el.classList.add("qbg-" + key);
  }

  const showRaw = (id) => $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));
  /* ระหว่างที่ผู้เล่นกำลังแต่งตัวละคร (จอ s-avatar) ห้ามให้การ sync เบื้องหลัง
     สลับกลับไปจอห้องรอเอง — เดิมทุก ๆ 5 วินาที/ทุกครั้งที่มีคนเข้าห้อง จอจะ "เด้ง" ออก
     จำไว้ว่าควรกลับไปจอไหน แล้วค่อยไปเมื่อกด "เสร็จแล้ว" */
  let avatarOpen = false;
  const HOLD_WHILE_AVATAR = { "s-lobby": 1, "s-join": 1 };
  const show = (id) => {
    if (avatarOpen && HOLD_WHILE_AVATAR[id]) { prevScreen = id; return; }
    if (avatarOpen && id !== "s-avatar") avatarOpen = false;      // เกมเริ่มแล้ว → ไปจอเกมทันที
    showRaw(id);
  };
  const setScore = (n) => {
    const el = $("#myscore");
    if (n == null) return;
    el.style.display = "";
    el.textContent = fmt(n) + " คะแนน";
  };

  if (pin.length !== 6) { $("#err-text").textContent = "ลิงก์ไม่ถูกต้อง — ต้องมี PIN 6 หลัก"; show("s-error"); return; }
  initNetworkInfo();

  function initNetworkInfo() {
    const badge = $("#network-info");
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!badge || !connection) return; // ไม่มีการยิงทดสอบดาวน์โหลด/เพิ่ม traffic
    const update = () => {
      const type = String(connection.effectiveType || "").toUpperCase();
      const downlink = Number(connection.downlink);
      const rtt = Number(connection.rtt);
      const details = [];
      if (type) details.push(type);
      if (Number.isFinite(downlink) && downlink > 0) details.push((downlink >= 10 ? Math.round(downlink) : downlink.toFixed(1)) + " Mbps");
      if (!details.length && Number.isFinite(rtt) && rtt > 0) details.push("RTT " + Math.round(rtt) + " ms");
      if (!details.length) return;
      badge.textContent = "เน็ต " + details.join(" · ");
      badge.classList.remove("hidden");
      badge.classList.toggle("network-slow", connection.effectiveType === "slow-2g" || connection.effectiveType === "2g" || (downlink > 0 && downlink < 1));
      badge.title = "ข้อมูลโดยประมาณจากเบราว์เซอร์ ไม่ได้ทดสอบดาวน์โหลดจริง";
    };
    update();
    if (connection.addEventListener) connection.addEventListener("change", update);
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */
  $("#pin-label").textContent = pin;
  $("#nick").value = localStorage.getItem(NICK_KEY) || "";
  avatar = readAvatar();

  const saved = readStore();
  if (saved && saved.token) {
    token = saved.token;
    $("#who").textContent = saved.nickname || "";
    sync();
  } else {
    show("s-join");
    setTimeout(() => $("#nick").focus(), 250);
  }

  /* ------------------------------ ตัวละคร ------------------------------ */
  function readAvatar() {
    try {
      const raw = JSON.parse(localStorage.getItem(AV_KEY) || "null");
      if (raw && window.Avatars) return Avatars.normalize(raw);
    } catch (e) { }
    // ยังไม่เคยตกแต่ง → ตั้งต้นจากชื่อที่เคยใช้ (หรือสุ่มน่ารัก ๆ ให้ก่อน)
    const nick = localStorage.getItem(NICK_KEY) || "";
    return window.Avatars ? (nick ? Avatars.fromName(nick) : Avatars.random()) : null;
  }
  function saveAvatar(a) {
    avatar = a;
    try { localStorage.setItem(AV_KEY, JSON.stringify(a)); } catch (e) { }
    paintAvatars();
    // ส่งขึ้นเซิร์ฟเวอร์แบบหน่วง ไม่ให้ยิงถี่ตอนกดเลือก
    avDirty = true;
    if (token) {
      clearTimeout(avSaveTimer);
      avSaveTimer = setTimeout(pushAvatar, 600);
    }
  }
  let paintedAv = "";
  function paintAvatars() {
    const key = avatar ? JSON.stringify(avatar) : "";
    if (key === paintedAv) return;               // ไม่วาดซ้ำถ้าตัวละครเหมือนเดิม (กันกระพริบ)
    paintedAv = key;
    const svg = avatar && window.Avatars ? Avatars.svg(avatar) : "";
    const j = $("#join-av"), l = $("#lobby-av");
    if (j) j.innerHTML = svg;
    if (l) l.innerHTML = svg;
  }
  let avDirty = false;            // มีการแก้ตัวละครที่ยังไม่ได้ยืนยันกับเซิร์ฟเวอร์
  function pushAvatar() {
    clearTimeout(avSaveTimer); avSaveTimer = null;
    if (!token || !avatar) { avDirty = false; return; }
    const sent = JSON.stringify(avatar);
    API.setAvatar(token, avatar)
      .then(() => { if (JSON.stringify(avatar) === sent) avDirty = false; })
      .catch(() => { });
  }

  function buildPicker() {
    if (!window.Avatars) return;
    avPicker = Avatars.picker($("#av-picker"), avatar, (a) => {
      saveAvatar(a);
      const note = $("#av-note");
      if (note) {
        note.textContent = "บันทึกตัวละครแล้ว ✓ (" + Avatars.label(a) + ")";
        setTimeout(() => { if (note.textContent.startsWith("บันทึก")) note.textContent = ""; }, 1600);
      }
    });
  }

  function openAvatar(fromScreen) {
    prevScreen = fromScreen || "s-lobby";
    if (!avPicker) buildPicker();
    else if (avPicker) avPicker.set(avatar);
    avatarOpen = true;
    showRaw("s-avatar");
    if (window.Snd) { Snd.unlock(); Snd.play("pop"); }
  }
  let prevScreen = "s-lobby";
  paintAvatars();                 // แสดงตัวละครตั้งแต่จอใส่ชื่อ

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }
  function writeStore(v) {
    try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { }
  }
  function clearStore() { try { localStorage.removeItem(STORE); } catch (e) { } }

  /* ------------------------------------------------------------------ */
  /* join                                                               */
  /* ------------------------------------------------------------------ */
  $("#btn-join").addEventListener("click", join);
  $("#nick").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#nick").addEventListener("blur", () => {
    // ถ้ายังไม่เคยเลือกตัวละคร ให้ตั้งต้นตามชื่อที่พิมพ์
    if (window.Avatars && !localStorage.getItem(AV_KEY) && $("#nick").value.trim()) {
      avatar = Avatars.fromName($("#nick").value.trim());
      paintAvatars();
    }
  });
  $("#btn-customize").addEventListener("click", () => openAvatar("s-join"));
  const c2 = $("#btn-customize2");
  if (c2) c2.addEventListener("click", () => openAvatar("s-lobby"));
  $("#btn-av-done").addEventListener("click", () => {
    if (avatar && token) pushAvatar();
    avatarOpen = false;
    show(prevScreen);
    if (window.Snd) Snd.play("click");
  });

  async function join() {
    const nick = $("#nick").value.trim().replace(/\s+/g, " ");
    if (!nick) { toast("กรุณาใส่ชื่อเล่น", "err"); $("#nick").focus(); return; }
    const btn = $("#btn-join");
    btn.disabled = true; btn.textContent = "กำลังเข้าห้อง…";
    try {
      if (window.Avatars && !avatar) avatar = Avatars.fromName(nick);
      const r = await API.joinRoom(pin, nick, avatar);
      token = r.token;
      avDirty = false;                             // ตัวละครถูกส่งไปพร้อมการเข้าห้องแล้ว
      writeStore({ token: r.token, nickname: r.nickname, pin });
      localStorage.setItem(NICK_KEY, r.nickname);
      $("#who").textContent = r.nickname;
      if (r.avatar && window.Avatars && Object.keys(r.avatar).length) { /* ใช้ของเดิมที่เคยตั้งไว้ */ }
      paintAvatars();
      if (window.Snd) { Snd.unlock(); Snd.play("join"); Snd.music("lobby"); }
      await sync();
      startPolling();
      subscribe();
    } catch (e) {
      toast(e.message, "err", 4200);
      btn.disabled = false; btn.textContent = "เข้าร่วมเกม";
    }
  }

  /* ------------------------------------------------------------------ */
  /* sync + routing                                                     */
  /* ------------------------------------------------------------------ */
  function queueSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 220);
  }

  async function sync() {
    if (!token) return;
    try {
      const r = await API.resume(token);
      player = r.player;
      state = r.state;
      // อย่าเอาตัวละครจากเซิร์ฟเวอร์ (ที่อาจยังเป็นของเก่า) มาทับของที่ผู้เล่นกำลังแต่งอยู่
      if (!avatarOpen && !avDirty && player && player.avatar && window.Avatars && Object.keys(player.avatar).length) {
        avatar = Avatars.normalize(player.avatar);
        paintAvatars();
      }
      if (state && state.server_now) offset = new Date(state.server_now).getTime() - Date.now();
      setScore(player.score);
      $("#who").textContent = player.nickname;
      route(r.answered_current);
    } catch (e) {
      if (e.code === "player_not_found" || e.code === "room_not_found") {
        clearStore();
        $("#err-text").textContent = e.code === "room_not_found"
          ? "ห้องนี้ปิดไปแล้ว" : "ไม่พบข้อมูลผู้เล่น กรุณาเข้าห้องใหม่";
        show("s-error");
        stopAll();
      } else {
        console.warn(e);
      }
    }
  }

  let roundSeen = -1;            // current_index สูงสุดที่เคยเห็นในรอบนี้
  function resetRound() {
    answeredQid = null; lastAnswer = null; lastAnswerQid = null; timerQid = null;
    lbQid = null; roundSeen = -1; lastStage = "";
    const podiumEl = $("#end-podium");
    if (podiumEl) { podiumEl.innerHTML = ""; delete podiumEl.dataset.done; }
    setScore(0);
  }

  let lastStage = "";
  function stageSound(key, st) {
    if (lastStage === key) return;
    lastStage = key;
    if (!window.Snd) return;
    try {
      if (st === "question") {
        Snd.resetCountdown();
        Snd.questionMusic(state && typeof state.current_index === "number" ? state.current_index : 0);   // สุ่มเพลงจากรายการที่เลือก ไม่ซ้ำติดกัน
        Snd.play("suspense");
        setTimeout(() => { try { Snd.play("start"); } catch (e) { } }, 420);
      } else if (st === "reveal") {
        Snd.music("reveal");
        const answer = answerForQuestion(state && state.question && state.question.id);
        const right = answer && typeof answer.is_correct === "boolean" ? answer.is_correct : null;
        Snd.play("drumroll", 620);
        setTimeout(() => {
          try {
            Snd.play(right === true ? "correct" : right === false ? "wrong" : "reveal");
            if (right === true && answer && answer.streak >= 3) setTimeout(() => Snd.play("streak"), 520);
          } catch (e) { }
        }, 520);
      } else if (st === "leaderboard") { Snd.music("leaderboard"); Snd.play("whoosh"); }
      else if (st === "lobby") { Snd.music("lobby"); }
      else if (st === "ended") {
        Snd.stopMusic(); Snd.play("drumroll", 900);
        setTimeout(() => { try { if (state && state.status === "ended") Snd.music("ended"); } catch (e) { } }, 3200);
      }
    } catch (e) { }
  }

  function route(answeredFromServer) {
    if (!state) return;
    const st = state.status;
    if (typeof state.current_index === "number" && state.current_index > roundSeen) roundSeen = state.current_index;

    if (st === "lobby") {
      // ผู้ดำเนินรายการเริ่มรอบใหม่ในห้องเดิม → ล้างสถานะรอบเก่าของเครื่องนี้
      if (roundSeen >= 0) { resetRound(); setScore(player && player.score ? player.score : 0); }
      stageSound("lobby", st);
      show("s-lobby");
      $("#lobby-count").textContent = (state.player_count || 0) + (state.max_players > 0 ? " / " + state.max_players + " คนในห้อง" : " คนในห้อง · โควตารวมทุกห้อง 120 คน");
      $("#lobby-title").textContent = "เข้าห้องแล้ว!";
      paintAvatars();
      return;
    }

    if (st === "question") {
      const q = state.question;
      if (!q) { show("s-lobby"); return; }
      if (answeredFromServer || answeredQid === q.id) {
        show("s-answered");
        const answer = answerForQuestion(q.id);
        if (answer) {
          $("#ans-points").textContent = (answer.points > 0 ? "+" : "") + fmt(answer.points);
          $("#ans-score").textContent = fmt(answer.score) + " คะแนน";
        } else {
          $("#ans-points").textContent = "";
          if (player) $("#ans-score").textContent = fmt(player.score) + " คะแนน";
        }
        return;
      }
      if (timerQid !== q.id) { timerQid = q.id; answeredQid = null; lastAnswer = null; lastAnswerQid = null; stageSound("question:" + q.id, st); renderQuestion(); }
      show("s-question");
      return;
    }

    if (st === "reveal") { renderReveal(); stageSound("reveal:" + state.current_index, st); show("s-reveal"); return; }

    if (st === "leaderboard") {
      stageSound("lb:" + state.current_index, st);
      show("s-leaderboard");
      if (lbQid !== state.current_index) { lbQid = state.current_index; loadLeaderboard(); }
      return;
    }

    if (st === "ended") {
      stageSound("ended", st);
      renderEnded();
      show("s-ended");
      stopTimer();
      // ยังคง polling + realtime ไว้ เพื่อรับรู้เมื่อผู้ดำเนินรายการ "เริ่มรอบใหม่ในห้องเดิม"
      ensureLive();
      return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* question screen                                                    */
  /* ------------------------------------------------------------------ */
  function renderQuestion() {
    const q = state.question;
    setQuestionBackground($("#s-question"), q);
    $("#q-index").textContent = "ข้อ " + (q.index + 1) + " / " + state.question_count;
    $("#q-prompt").innerHTML = esc(q.prompt) +
      (q.image_url ? '<img class="qimg" src="' + esc(q.image_url) + '" alt="">' : "");

    const box = $("#q-answers");
    const n = q.options.length;
    const shapeOnly = ((q && q.show_options) || state.show_options || "text") === "shape";
    box.className = "answers" + (n === 2 ? " count-2" : n === 3 ? " count-3" : "") + (shapeOnly ? " ans-only-shape" : "");
    box.innerHTML = q.options.map((opt, i) =>
      '<button class="ans c' + (i + 1) + '" data-i="' + i + '" aria-label="ตัวเลือกที่ ' + (i + 1) + '">' +
      '<span class="shape">' + U.shapes(i) + "</span>" +
      '<span class="lbl">' + esc(opt) + "</span></button>"
    ).join("");
    $$(".ans", box).forEach((b) => b.addEventListener("click", () => choose(+b.dataset.i)));

    startTimer(q);
    requestWakeLock();
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { } }
  }

  function startTimer(q) {
    stopTimer();
    const total = (q.time_limit || 20) * 1000;
    const endsAt = state.question_ends_at ? new Date(state.question_ends_at).getTime() : Date.now() + total;
    const ring = $("#ring");
    const num = $("#tnum");
    const tick = () => {
      const left = Math.max(0, endsAt - (Date.now() + offset));
      num.textContent = Math.ceil(left / 1000);
      const frac = Math.max(0, Math.min(1, left / total));
      ring.setAttribute("stroke-dashoffset", String(226.2 * (1 - frac)));
      if (window.Snd) Snd.countdown(left);
      if (left <= 0) {
        stopTimer();
        $$(".ans").forEach((b) => { b.disabled = true; b.classList.add("dim"); });
        if (!answeredQid) {
          toast("หมดเวลาข้อนี้แล้ว", "err", 2000);
          queueSync();
        }
      }
    };
    tick();
    timerInt = setInterval(tick, 100);
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  async function choose(i) {
    if (answeredQid) return;
    const q = state.question;
    answeredQid = q.id;
    stopTimer();
    const btns = $$("#q-answers .ans");
    btns.forEach((b, ix) => {
      b.disabled = true;
      if (ix === i) b.classList.add("chosen");
      else b.classList.add("dim");
    });
    if (navigator.vibrate) { try { navigator.vibrate(28); } catch (e) { } }
    if (window.Snd) Snd.play("click");

    try {
      const r = await API.submitAnswer(token, q.id, i);
      lastAnswer = r;
      lastAnswerQid = q.id;
      setScore(r.score);
      $("#ans-points").textContent = (r.points > 0 ? "+" : "") + fmt(r.points);
      $("#ans-score").textContent = fmt(r.score) + " คะแนน";
      show("s-answered");
    } catch (e) {
      if (e.code === "already_answered") { show("s-answered"); }
      else if (e.code === "time_up" || e.code === "not_open") { toast("หมดเวลาข้อนี้แล้ว", "err"); queueSync(); }
      else { toast(e.message, "err", 4000); answeredQid = null; }
    }
  }

  /* ------------------------------------------------------------------ */
  /* reveal / leaderboard / end                                         */
  /* ------------------------------------------------------------------ */
  function renderReveal() {
    const q = state.question;
    setQuestionBackground($("#s-reveal"), q);
    const correct = q && state.correct_index != null ? state.correct_index : null;
    const truth = q && correct != null ? q.options[correct] : "";
    const answer = answerForQuestion(q && q.id);
    let right = null;
    if (answer && typeof answer.is_correct === "boolean") right = answer.is_correct;

    const icon = $("#reveal-icon");
    icon.className = "verdict " + (right === true ? "ok" : right === false ? "no" : "none");
    const title = $("#reveal-title");
    title.textContent = right === true ? "ถูกต้อง!" : right === false ? "ยังไม่ถูก" : "เฉลย";
    title.style.color = right === true ? "var(--a4)" : right === false ? "var(--a1)" : "var(--ink)";
    $("#reveal-truth").innerHTML = truth
      ? '<span class="answer-label">คำตอบที่ถูก คือ</span><b class="answer-value">' + esc(truth) + "</b>"
      : "";
    if (answer) {
      $("#reveal-score").textContent = "+" + fmt(answer.points) + " → " + fmt(answer.score) + " คะแนน";
    } else if (player) {
      // แสดงคะแนนรวมเท่านั้นเมื่อไม่มีคำตอบข้อนี้บนเครื่อง (ห้ามใช้ผลของข้อก่อน)
      $("#reveal-score").textContent = "คะแนนรวม " + fmt(player.score) + " คะแนน";
    } else {
      $("#reveal-score").textContent = "";
    }
    if (player) {
      const rank = Number(player.rank) || 0;
      const rankEl = $("#reveal-rank");
      rankEl.className = "pill reveal-rank" + (rank === 1 ? " rank-gold" : rank === 2 ? " rank-silver" : rank === 3 ? " rank-bronze" : " rank-other");
      rankEl.textContent = (rank === 1 ? "👑 " : rank === 2 ? "🥈 " : rank === 3 ? "🥉 " : "") + "อันดับ " + rank;
    }
  }

  async function loadLeaderboard() {
    try {
      const r = await API.leaderboard(pin, 10);
      $("#lb-total").textContent = r.total + " คน";
      renderList($("#lb-list"), r.players, player && player.nickname);
    } catch (e) { console.warn(e); }
  }

  function renderList(el, rows, me) {
    if (!rows || !rows.length) { el.innerHTML = '<p class="muted small tc">ยังไม่มีข้อมูล</p>'; return; }
    el.innerHTML = rows.map((p) => {
      const isMe = me && p.nickname === me;
      const cls = p.rank === 1 ? "t1" : p.rank === 2 ? "t2" : p.rank === 3 ? "t3" : "";
      return '<div class="res-row' + (isMe ? " me" : "") + '">' +
        '<div class="rank ' + cls + '">' + (p.rank === 1 ? "👑 " : p.rank === 2 ? "🥈 " : p.rank === 3 ? "🥉 " : "") + p.rank + "</div>" +
        '<div style="flex:1; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + esc(p.nickname) + "</div>" +
        '<div class="mono" style="font-weight:800">' + fmt(p.score) + "</div>" +
        "</div>";
    }).join("");
  }

  function renderEnded() {
    if (!player) return;
    const rank = player.rank;
    const badge = $("#end-emoji");
    badge.textContent = rank;
    badge.className = "rankbadge" + (rank === 1 ? " gold" : rank === 2 ? " silver" : rank === 3 ? " bronze" : "");
    const podiumEl = $("#end-podium");
    if (podiumEl && window.Podium && rank >= 1 && rank <= 3) {
      badge.style.display = "none";
      if (!podiumEl.dataset.done) {
        podiumEl.dataset.done = "1";
        Podium.mini(podiumEl, player, { caption: "อันดับ " + rank + " จาก " + (state.player_count || 0) + " คน" });
        if (window.FX) setTimeout(() => FX.confetti(podiumEl.querySelector(".mini-confetti") || podiumEl, { ms: 2600, count: 80 }), 900);
      }
    } else {
      badge.style.display = "";
    }
    $("#end-title").textContent = rank === 1 ? "ยินดีด้วย! ที่ 1" : rank === 2 ? "ยินดีด้วย! ที่ 2" : rank === 3 ? "ยินดีด้วย! ที่ 3" : "จบเกมแล้ว";
    $("#end-score").textContent = fmt(player.score);
    $("#end-rank").textContent = "อันดับ " + rank + " จาก " + (state.player_count || 0) + " คน · ตอบถูก " +
      player.correct_count + " ข้อ";
    renderList($("#end-list"), state.final_leaderboard, player.nickname);
  }

  /* เปิดให้เครื่องมือทดสอบเรียก route() ได้ (ไม่กระทบการใช้งานจริง) */
  window.__playTest = { route: (st, opts) => { state = st; renderQuestion(); }, choose };

  /* ------------------------------------------------------------------ */
  /* polling + realtime + lifecycle                                     */
  /* ------------------------------------------------------------------ */
  function startPolling() {
    stopPolling();
    pollInt = setInterval(sync, 5000);
  }
  function stopPolling() { if (pollInt) { clearInterval(pollInt); pollInt = null; } }

  function subscribe() {
    if (channel) return;
    channel = API.subscribeRoom(pin, queueSync);
  }

  function ensureLive() {
    startPolling();
    subscribe();
  }

  function stopAll() {
    stopPolling(); stopTimer();
    if (channel) { channel.close(); channel = null; }
    releaseWakeLock();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && token) sync();
  });

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) { /* ไม่รองรับก็ข้ามไป */ }
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) { }
  }
})();
