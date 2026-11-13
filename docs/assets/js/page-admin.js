/* ห้องทำงานผู้จัด — สร้าง/แก้ไขชุดคำถาม และนำเข้า CSV/JSON */
(function () {
  const { $, $$, toast, esc, param } = U;
  const EMOJIS = ["🎯", "🧠", "🛡️", "⚙️", "💡", "📊", "🚀", "🌱", "🏥", "📚", "🔥", "🎓"];
  const BACKGROUNDS = [
    ["aurora", "แสงเหนือ"], ["sunset", "พระอาทิตย์ตก"], ["ocean", "มหาสมุทร"],
    ["forest", "ป่าเขียว"], ["galaxy", "กาแล็กซี"], ["candy", "ลูกกวาด"],
    ["midnight", "รัตติกาล"], ["coral", "ปะการัง"], ["mint", "มิ้นต์"], ["gold", "ทองอร่าม"]
  ];
  const validBackground = (value) => BACKGROUNDS.some(([key]) => key === value) ? value : "aurora";

  let user = null;
  let editing = null;          // {id,title,description,emoji}
  let questions = [];          // รายการคำถามที่กำลังแก้
  let pickingEmoji = "🎯";
  let importMode = "new";      // new | append
  let importTab = "csv";
  let parsed = [];
  let liveRooms = [];
  let roomStatusKnown = false;
  let roomStatusError = "";
  let deletingQuiz = false;
  let roomBusy = false;
  const quizTitles = {};       // quiz_id → ชื่อชุด ไว้แสดงในแผงห้อง

  const show = (id) => $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */
  (async function boot() {
    try { user = await API.currentUser(); } catch (e) { }
    if (!user) { location.replace("index.html#host"); return; }
    $("#who").textContent = user.email;
    $("#who").classList.remove("hidden");
    $("#btn-logout").addEventListener("click", async () => { await API.signOut(); location.href = "index.html"; });

    bindStatic();
    const quizId = param("quiz");
    if (quizId) { await openEditor(quizId); }
    else { await renderList(); show("s-list"); }
  })();

  /* ------------------------------------------------------------------ */
  /* list                                                               */
  /* ------------------------------------------------------------------ */
  /* ห้องที่ยังไม่จบ — ผู้จัดกลับเข้าห้องเดิมได้ และเห็นคำถามที่กำลังใช้งาน */
  const ST_LABEL = { lobby: "รอผู้เล่นเข้าห้อง", question: "กำลังถามข้อ", reveal: "เฉลยอยู่",
    leaderboard: "กระดานคะแนน", ended: "จบแล้ว" };
  const isRoomInProgress = (r) => r.status !== "lobby" || Number(r.current_index) >= 0;
  const roomsForQuiz = (id) => liveRooms.filter((r) => String(r.quiz_id) === String(id));

  async function refreshLiveRooms() {
    try {
      const rooms = await API.myRooms();
      liveRooms = (rooms || []).filter((r) => r && r.status && r.status !== "ended");
      roomStatusKnown = true;
      roomStatusError = "";
      return true;
    } catch (e) {
      liveRooms = [];
      roomStatusKnown = false;
      roomStatusError = e.message || "ตรวจสอบห้องที่เปิดอยู่ไม่สำเร็จ";
      return false;
    }
  }

  const roomQuizName = (r) => {
    const t = quizTitles[String(r && r.quiz_id)];
    return t || "ชุดคำถาม";
  };
  const roomWhen = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    try {
      return d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return d.toLocaleString(); }
  };

  function renderLiveRooms() {
    const box = $("#live-rooms");
    const panel = $("#live-rooms-panel");
    if (!box) return;
    if (!roomStatusKnown) {
      if (panel) panel.classList.remove("hidden");
      box.innerHTML = '<div class="card card-tight small" role="status">ตรวจสอบห้องที่เปิดอยู่ไม่สำเร็จ: ' +
        esc(roomStatusError) + " · ลองกดรีเฟรชหรือโหลดหน้าใหม่ก่อนแก้ไข/ลบคำถาม</div>";
      return;
    }
    const live = liveRooms;
    if (!live.length) {
      box.innerHTML = "";
      if (panel) panel.classList.add("hidden");
      return;
    }
    if (panel) panel.classList.remove("hidden");
    box.innerHTML = live.map((r) => {
      const st = r.status || "lobby";
      const pill = st === "lobby" ? "pill-warn" : st === "ended" ? "" : "pill-live";
      const when = roomWhen(r.created_at);
      return '<div class="card card-tight room-row" data-room-row="' + esc(r.id) + '">' +
        '<div class="room-row-main">' +
        '<div class="room-row-top">' +
        '<span class="room-pin">PIN <b>' + esc(r.pin) + "</b></span> " +
        '<span class="pill ' + pill + '">' + esc(ST_LABEL[st] || st) + "</span>" +
        "</div>" +
        '<div class="tiny muted room-quiz">ชุด “' + esc(roomQuizName(r)) + "”" + (when ? " · เปิดเมื่อ " + esc(when) : "") + "</div>" +
        "</div>" +
        '<div class="room-row-settings">' +
        '<label class="switch room-late" title="อนุญาตให้ผู้เล่นเข้าห้องหลังเกมเริ่มแล้ว">' +
        '<input type="checkbox" data-room-late="' + esc(r.id) + '"' + (r.allow_late ? " checked" : "") + " /> เข้าห้องกลางเกม</label>" +
        '<label class="room-field"><span>ตัวเลือกบนจอ</span>' +
        '<select data-room-show="' + esc(r.id) + '" aria-label="โหมดแสดงตัวเลือกของห้อง ' + esc(r.pin) + '">' +
        '<option value="text"' + ((r.show_options || "text") !== "shape" ? " selected" : "") + ">ข้อความ + สี</option>" +
        '<option value="shape"' + (r.show_options === "shape" ? " selected" : "") + ">สัญลักษณ์สีเท่านั้น</option>" +
        "</select></label></div>" +
        '<div class="room-row-actions">' +
        '<a class="btn btn-sm btn-primary" href="host.html?room=' + encodeURIComponent(r.id) + '">เข้าห้อง</a>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-room-close="' + esc(r.id) + '" data-pin="' + esc(r.pin) + '">ปิดห้อง</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-room-delete="' + esc(r.id) + '" data-pin="' + esc(r.pin) + '">ลบห้อง</button>' +
        "</div></div>";
    }).join("");
    bindRoomActions();
  }

  /* ปุ่มจัดการห้องในแผง "ห้องที่เปิดอยู่" */
  function bindRoomActions() {
    $$("[data-room-close]").forEach((b) => b.addEventListener("click", () => closeRoom(b.dataset.roomClose, b.dataset.pin, b)));
    $$("[data-room-delete]").forEach((b) => b.addEventListener("click", () => deleteRoom(b.dataset.roomDelete, b.dataset.pin, b)));
    $$("[data-room-show]").forEach((sel) => sel.addEventListener("change", async () => {
      const id = sel.dataset.roomShow;
      const mode = sel.value === "shape" ? "shape" : "text";
      sel.disabled = true;
      try {
        await API.setShowOptions(id, mode);
        const room = liveRooms.find((r) => String(r.id) === String(id));
        if (room) room.show_options = mode;
        toast(mode === "shape" ? "ตั้งค่าให้ผู้เล่นเห็นเฉพาะสัญลักษณ์สี" : "ตั้งค่าให้ผู้เล่นเห็นข้อความตัวเลือก", "ok", 2400);
      } catch (e) {
        toast(e.message || "บันทึกโหมดแสดงตัวเลือกไม่สำเร็จ", "err", 3600);
      } finally { sel.disabled = false; }
    }));
    $$("[data-room-late]").forEach((chk) => chk.addEventListener("change", async () => {
      const id = chk.dataset.roomLate;
      const want = chk.checked;
      chk.disabled = true;
      try {
        await API.setAllowLate(id, want);
        const room = liveRooms.find((r) => String(r.id) === String(id));
        if (room) room.allow_late = want;
        toast(want ? "เปิดให้เข้าห้องกลางเกมแล้ว" : "ปิดการเข้าห้องกลางเกมแล้ว", "ok", 2000);
      } catch (e) {
        chk.checked = !want;
        toast(e.message || "บันทึกการตั้งค่าไม่สำเร็จ", "err", 3600);
      } finally { chk.disabled = false; }
    }));
  }

  async function closeRoom(id, pinText, btn) {
    if (!id || roomBusy) return;
    if (!confirm("ปิดห้อง PIN " + (pinText || "") + " ใช่หรือไม่?\n\nผู้เล่นจะออกจากห้องนี้ คะแนน/คำตอบยังถูกเก็บไว้ดูย้อนหลังได้ และ PIN นี้จะว่างให้เปิดห้องใหม่")) return;
    roomBusy = true;
    if (btn) btn.disabled = true;
    try {
      await API.closeRoom(id);
      toast("ปิดห้อง " + (pinText || "") + " แล้ว", "ok", 3000);
      await renderList();
    } catch (e) {
      toast(e.message || "ปิดห้องไม่สำเร็จ", "err", 4200);
      if (btn) btn.disabled = false;
    } finally { roomBusy = false; }
  }

  async function deleteRoom(id, pinText, btn) {
    if (!id || roomBusy) return;
    if (!confirm("ลบห้อง PIN " + (pinText || "") + " ออกจากระบบใช่หรือไม่?\n\nรายชื่อผู้เล่น คะแนน และคำตอบของห้องนี้จะถูกลบทั้งหมด ไม่สามารถกู้คืนได้ (ชุดคำถามยังอยู่)")) return;
    roomBusy = true;
    if (btn) btn.disabled = true;
    try {
      await API.deleteRoom(id);
      toast("ลบห้อง " + (pinText || "") + " แล้ว", "ok", 3000);
      await renderList();
    } catch (e) {
      toast(e.message || "ลบห้องไม่สำเร็จ", "err", 4200);
      if (btn) btn.disabled = false;
    } finally { roomBusy = false; }
  }

  async function renderList() {
    show("s-list");
    const el = $("#quiz-list");
    el.innerHTML = '<div class="loader"></div>';
    const results = await Promise.allSettled([API.listQuizzes(), refreshLiveRooms()]);
    const quizResult = results[0];
    if (quizResult.status === "fulfilled") {
      (quizResult.value || []).forEach((q) => { quizTitles[String(q.id)] = q.title; });
    }
    renderLiveRooms();                 // ใช้ชื่อชุดในแผงห้อง (ถ้าโหลดชุดไม่สำเร็จยังแสดงชื่อสำรองได้)
    if (quizResult.status === "rejected") {
      el.innerHTML = '<p class="muted small">โหลดไม่สำเร็จ: ' + esc(quizResult.reason.message || quizResult.reason) + "</p>";
      return;
    }
    const list = quizResult.value || [];
    if (!list.length) {
      el.innerHTML = '<div class="card" style="grid-column:1/-1; text-align:center">' +
        '<p class="muted">ยังไม่มีชุดคำถาม</p>' +
        '<div class="row" style="justify-content:center; margin-top:12px; gap:8px">' +
        '<button class="btn btn-primary" onclick="document.getElementById(\'btn-new\').click()">+ สร้างชุดใหม่</button>' +
        '<button class="btn btn-ghost" onclick="document.getElementById(\'btn-import-open\').click()">นำเข้าคำถาม</button>' +
        "</div></div>";
      return;
    }
    el.innerHTML = list.map((q) => {
      const rooms = roomsForQuiz(q.id);
      const inProgress = rooms.some(isRoomInProgress);
      const roomStatus = rooms.length
        ? '<div class="quiz-live-note' + (inProgress ? " in-game" : "") + '">' +
          (inProgress ? "กำลังมีห้องเล่นอยู่" : "มีห้องรอผู้เล่น") + " · " + rooms.length + " ห้อง · PIN " +
          rooms.map((r) => esc(r.pin)).join(", ") +
          ' · <a href="#live-rooms-panel">จัดการห้อง</a></div>' 
        : "";
      const editDisabled = !roomStatusKnown || inProgress;
      const editHint = !roomStatusKnown ? "ตรวจสอบสถานะห้องไม่สำเร็จ กรุณาโหลดใหม่" :
        inProgress ? "จบเกมก่อนแก้ไข เพื่อไม่ให้คำถาม/คำตอบในห้องปัจจุบันเปลี่ยน" : "";
      return '<div class="quiz-card">' +
        '<div class="row"><div class="quiz-emoji">' + esc((q.title || "?").trim().charAt(0)) + "</div>" +
        '<div class="quiz-card-meta"><div class="quiz-title">' + esc(q.title) + "</div>" +
        '<div class="tiny muted">' + (Number(q.question_count) || 0) + " ข้อ" + (Number(q.max_players) > 0 ? " · จำกัด " + q.max_players + " คน/ห้อง" : " · ไม่จำกัดเพิ่มต่อชุด (รวมทุกห้องไม่เกิน 120 คน)") + (q.description ? " · " + esc(q.description) : "") + "</div>" +
        roomStatus + "</div></div>" +
        (editHint ? '<div class="quiz-edit-hint">' + esc(editHint) + "</div>" : "") +
        '<div class="quiz-card-actions">' +
        '<button class="btn btn-sm btn-primary" data-play="' + esc(q.id) + '">เล่นเลย</button>' +
        '<button class="btn btn-sm btn-ghost" data-edit="' + esc(q.id) + '"' +
          (editDisabled ? ' disabled title="' + esc(editHint) + '"' : "") + '>แก้ไข</button>' +
        '<button class="btn btn-sm btn-danger" data-delete="' + esc(q.id) + '" data-title="' + esc(q.title) + '"' +
          (!roomStatusKnown ? ' disabled title="' + esc(editHint) + '"' : "") + '>ลบ</button>' +
        "</div></div>";
    }).join("");
    $$("[data-play]", el).forEach((b) => b.addEventListener("click", () => {
      location.href = "host.html?quiz=" + b.dataset.play;
    }));
    $$("[data-edit]", el).forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
    $$("[data-delete]", el).forEach((b) => b.addEventListener("click", () => deleteQuiz(b.dataset.delete, b.dataset.title)));
  }

  /* ------------------------------------------------------------------ */
  /* editor                                                             */
  /* ------------------------------------------------------------------ */
  async function openEditor(id) {
    show("s-editor");
    $("#q-list").innerHTML = '<div class="loader"></div>';
    try {
      if (!(await refreshLiveRooms())) throw new Error("ตรวจสอบห้องที่เปิดอยู่ไม่สำเร็จ กรุณาลองโหลดหน้าใหม่ก่อนแก้ไข");
      const running = roomsForQuiz(id).filter(isRoomInProgress);
      if (running.length) {
        toast("ชุดนี้กำลังเล่นอยู่ในห้อง PIN " + running.map((r) => r.pin).join(", ") + " — จบเกมก่อนจึงจะแก้ไขได้", "err", 4500);
        await renderList();
        return;
      }
      const { quiz, questions: qs } = await API.getQuiz(id);
      editing = { id: quiz.id, title: quiz.title, description: quiz.description || "", emoji: quiz.emoji || "🎯", max_players: Number(quiz.max_players) || 0 };
      $("#btn-delete-quiz").classList.remove("hidden");
      pickingEmoji = editing.emoji;
      questions = qs.map((q) => ({
        prompt: q.prompt, image_url: q.image_url || "", options: q.options.slice(),
        correct_index: q.correct_index, time_limit: q.time_limit, points: q.points,
        show_options: q.show_options || "", background: validBackground(q.background)
      }));
      $("#quiz-title").value = editing.title;
      $("#quiz-desc").value = editing.description;
      $("#quiz-max-players").value = String(editing.max_players);
      renderEmojiRow();
      renderQuestions();
    } catch (e) {
      toast(e.message, "err", 4000);
      await renderList();
    }
  }

  function newQuiz(title) {
    editing = { id: null, title: title || "ชุดคำถามใหม่", description: "", emoji: "🎯", max_players: 0 };
    $("#btn-delete-quiz").classList.add("hidden");
    pickingEmoji = "🎯";
    questions = [];
    $("#quiz-title").value = editing.title;
    $("#quiz-desc").value = "";
    $("#quiz-max-players").value = "0";
    renderEmojiRow();
    addQuestion();
    show("s-editor");
  }
  /* เปิดให้เครื่องมือทดสอบ (และหน้าอื่น) เรียกใช้ได้ */
  window.AdminEditor = {
    newQuiz: (t) => newQuiz(t),
    questions: () => questions.map((q) => Object.assign({}, q)),
    addQuestion,
    collect: () => collect(),          // เปิดให้เครื่องมือทดสอบตรวจข้อมูลก่อนบันทึก
    load: (data) => {                  // ใช้ในทดสอบ: ใส่ชุดคำถามเข้า editor
      editing = data && data.id ? { id: data.id, title: data.title || "", description: data.description || "", emoji: data.emoji || "🎯", max_players: Number(data.max_players) || 0 } : { id: null, title: (data && data.title) || "ชุดใหม่", description: "", emoji: "🎯", max_players: Number(data && data.max_players) || 0 };
      $("#btn-delete-quiz").classList.toggle("hidden", !editing.id);
      pickingEmoji = editing.emoji;
      questions = (data && data.questions ? data.questions : []).map((q) => ({
        prompt: q.prompt || "", options: (q.options || ["", "", "", ""]).slice(),
        correct_index: q.correct_index || 0, time_limit: q.time_limit || 20,
        points: q.points || 1000, image_url: q.image_url || "", show_options: q.show_options || "",
        background: validBackground(q.background)
      }));
      $("#quiz-title").value = editing.title;
      $("#quiz-desc").value = editing.description || "";
      $("#quiz-max-players").value = String(editing.max_players);
      renderEmojiRow(); renderQuestions(); show("s-editor");
    }
  };

  function renderEmojiRow() {
    $("#emoji-row").innerHTML = EMOJIS.map((e) =>
      '<button data-emoji="' + e + '" class="' + (e === pickingEmoji ? "on" : "") + '">' + e + "</button>"
    ).join("");
    $$("[data-emoji]", $("#emoji-row")).forEach((b) => b.addEventListener("click", () => {
      pickingEmoji = b.dataset.emoji; renderEmojiRow();
    }));
  }

  function addQuestion() {
    questions.push({ prompt: "", image_url: "", options: ["", "", "", ""], correct_index: 0, time_limit: 20, points: 1000, show_options: "", background: "aurora" });
    renderQuestions();
    const list = $("#q-list");
    const last = list.lastElementChild;
    if (last && typeof last.scrollIntoView === "function") last.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderQuestions() {
    const list = $("#q-list");
    $("#q-count").textContent = "(" + questions.length + " ข้อ)";
    if (!questions.length) {
      list.innerHTML = '<p class="muted small tc" style="padding:20px">ยังไม่มีคำถาม — กด “+ เพิ่มข้อ” หรือนำเข้าไฟล์</p>';
      return;
    }
    /* กล่องตัวเลือก: แต่ละข้ออยู่ในการ์ดสีของตัวเอง ช่องพิมพ์ขยายความสูงตามข้อความ
       (ข้อความยาวแค่ไหนก็อ่านได้ครบ ไม่ถูกตัด) · กดที่ป้าย "ถูก" เพื่อเลือกคำตอบที่ถูก */
    list.innerHTML = questions.map((q, qi) => {
      const opts = q.options.map((o, oi) =>
        '<div class="opt-row oc' + ((oi % 6) + 1) + (q.correct_index === oi ? " is-correct" : "") + '">' +
        '<span class="opt-shape" aria-hidden="true">' + U.shapes(oi) + "</span>" +
        '<textarea rows="1" class="opt-text" data-q="' + qi + '" data-opt="' + oi + '" maxlength="200" ' +
        'placeholder="ตัวเลือกที่ ' + (oi + 1) + '" aria-label="ตัวเลือกที่ ' + (oi + 1) + '">' + esc(o) + "</textarea>" +
        '<label class="opt-correct" title="ตั้งเป็นคำตอบที่ถูก">' +
        '<input type="radio" name="correct-' + qi + '" data-qi="' + qi + '" data-oi="' + oi + '" ' +
        (q.correct_index === oi ? "checked" : "") + " />" +
        "<span>✓ ถูก</span></label>" +
        "</div>"
      ).join("");
      return '<div class="q-item" data-qi="' + qi + '">' +
        '<div class="q-head">' +
        '<div class="qnum">' + (qi + 1) + "</div>" +
        '<textarea class="q-prompt" data-q="' + qi + '" data-prompt="1" rows="2" placeholder="พิมพ์คำถาม…">' + esc(q.prompt) + "</textarea>" +
        '<div class="q-tools">' +
        '<button class="btn btn-icon btn-ghost" data-act="up" data-qi="' + qi + '" title="เลื่อนขึ้น">↑</button>' +
        '<button class="btn btn-icon btn-ghost" data-act="down" data-qi="' + qi + '" title="เลื่อนลง">↓</button>' +
        '<button class="btn btn-icon btn-danger" data-act="del" data-qi="' + qi + '" title="ลบข้อนี้">✕</button>' +
        "</div></div>" +
        '<div class="opt-label">ตัวเลือก <span>— กด “✓ ถูก” ที่ข้อที่เป็นคำตอบ</span></div>' +
        '<div class="opt-grid">' + opts + "</div>" +
        '<div class="q-foot">' +
        '<button class="btn btn-sm btn-ghost" data-act="addopt" data-qi="' + qi + '">+ ตัวเลือก</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="delopt" data-qi="' + qi + '">− ตัวเลือก</button>' +
        '<div class="spacer"></div>' +
        '<label class="q-num q-background-field"><span>พื้นหลังของคำถาม</span><div class="q-bg-pick">' +
        '<i class="q-bg-swatch qbg-' + validBackground(q.background) + '" data-q-bg-preview="' + qi + '" aria-hidden="true"></i>' +
        '<select data-q="' + qi + '" data-background="1" aria-label="เลือกพื้นหลังคำถามที่ ' + (qi + 1) + '">' +
        BACKGROUNDS.map(([key, label]) => '<option value="' + key + '"' + (validBackground(q.background) === key ? " selected" : "") + '>' + label + "</option>").join("") +
        "</select></div></label>" +
        '<select data-q="' + qi + '" data-show="1" class="q-show" title="การแสดงตัวเลือกของข้อนี้">' +
        '<option value=""' + (!q.show_options ? " selected" : "") + '>แสดงตามที่ผู้จัดตั้ง</option>' +
        '<option value="text"' + (q.show_options === "text" ? " selected" : "") + '>ข้อความ + สี</option>' +
        '<option value="shape"' + (q.show_options === "shape" ? " selected" : "") + '>สัญลักษณ์สีเท่านั้น</option>' +
        "</select>" +
        '<label class="q-num"><span>เวลา (วินาที)</span>' +
        '<input type="number" min="5" max="300" value="' + q.time_limit + '" data-q="' + qi + '" data-time="1" /></label>' +
        '<label class="q-num"><span>คะแนน</span>' +
        '<input type="number" min="100" max="4000" step="100" value="' + q.points + '" data-q="' + qi + '" data-points="1" /></label>' +
        "</div>" +
        "</div>";
    }).join("");

    // ช่องพิมพ์ขยายความสูงตามเนื้อหา → เห็นข้อความครบทุกบรรทัด
    const grow = (t) => {
      if (!t.scrollHeight) return;               // ยังไม่ถูกแสดงบนจอ
      t.style.height = "auto";
      t.style.height = (t.scrollHeight + 2) + "px";
    };
    const growAll = () => $$("textarea.opt-text, textarea.q-prompt", list).forEach(grow);
    $$("textarea.opt-text, textarea.q-prompt", list).forEach((t) => {
      t.addEventListener("input", () => grow(t));
      t.addEventListener("focus", () => grow(t));
    });
    $$("textarea.opt-text", list).forEach((t) => t.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();            // ตัวเลือกเป็นข้อความบรรทัดเดียว (ตัดบรรทัดอัตโนมัติ)
    }));
    growAll();
    if (window.requestAnimationFrame) requestAnimationFrame(growAll);
    setTimeout(growAll, 120);

    $$("[data-prompt]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].prompt = t.value;
    }));
    $$("[data-opt]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].options[+t.dataset.opt] = t.value.replace(/\s*\n+\s*/g, " ");
    }));
    $$("[data-show]", list).forEach((t) => t.addEventListener("change", () => {
      questions[+t.dataset.q].show_options = t.value;
    }));
    $$("[data-background]", list).forEach((t) => t.addEventListener("change", () => {
      const qi = +t.dataset.q;
      questions[qi].background = validBackground(t.value);
      const swatch = list.querySelector('[data-q-bg-preview="' + qi + '"]');
      if (swatch) swatch.className = "q-bg-swatch qbg-" + questions[qi].background;
    }));
    $$("[data-time]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].time_limit = clamp(+t.value || 20, 5, 300);
    }));
    $$("[data-points]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].points = clamp(+t.value || 1000, 100, 4000);
    }));
    $$('input[type="radio"]', list).forEach((r) => r.addEventListener("change", () => {
      questions[+r.dataset.qi].correct_index = +r.dataset.oi;
      const item = r.closest ? r.closest(".q-item") : null;
      if (item) $$(".opt-row", item).forEach((row, i) => row.classList.toggle("is-correct", i === +r.dataset.oi));
    }));
    $$("[data-act]", list).forEach((b) => b.addEventListener("click", () => {
      const qi = +b.dataset.qi;
      const act = b.dataset.act;
      if (act === "up" && qi > 0) { swap(qi, qi - 1); }
      else if (act === "down" && qi < questions.length - 1) { swap(qi, qi + 1); }
      else if (act === "del") {
        if (!confirm("ลบข้อ " + (qi + 1) + "?")) return;
        questions.splice(qi, 1); renderQuestions();
      } else if (act === "addopt") {
        if (questions[qi].options.length >= 6) { toast("สูงสุด 6 ตัวเลือก", "err"); return; }
        questions[qi].options.push(""); renderQuestions();
      } else if (act === "delopt") {
        if (questions[qi].options.length <= 2) { toast("อย่างน้อย 2 ตัวเลือก", "err"); return; }
        questions[qi].options.pop();
        if (questions[qi].correct_index >= questions[qi].options.length) questions[qi].correct_index = 0;
        renderQuestions();
      }
    }));
  }

  function swap(a, b) {
    const t = questions[a]; questions[a] = questions[b]; questions[b] = t;
    renderQuestions();
  }
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  /* ---------- save ---------- */
  function collect() {
    const title = $("#quiz-title").value.trim() || "ชุดคำถามไม่มีชื่อ";
    const desc = $("#quiz-desc").value.trim();
    const maxPlayers = clamp(Math.floor(Number($("#quiz-max-players").value) || 0), 0, 120);
    $("#quiz-max-players").value = String(maxPlayers);
    const cleaned = [];
    for (const q of questions) {
      const prompt = (q.prompt || "").trim();
      if (!prompt) continue;
      const opts = q.options.map((o) => (o || "").trim());
      const kept = [];
      let correct = -1;
      opts.forEach((o, i) => {
        if (o) { if (i === q.correct_index) correct = kept.length; kept.push(o); }
      });
      if (kept.length < 2) continue;
      if (correct < 0) correct = 0;
      cleaned.push({
        prompt, options: kept, correct_index: correct,
        time_limit: q.time_limit || 20, points: q.points || 1000, image_url: q.image_url || "",
        show_options: q.show_options === "shape" || q.show_options === "text" ? q.show_options : null,
        background: validBackground(q.background)
      });
    }
    return { title, desc, emoji: pickingEmoji, max_players: maxPlayers, questions: cleaned };
  }

  /* ฐานข้อมูลที่ยังไม่ได้รัน migration ล่าสุด (เช่นยังไม่มีคอลัมน์ max_players หรือ background)
     ระบบจะบันทึกให้ก่อนโดยใช้ค่าเริ่มต้น แล้วเตือนผู้จัดครั้งเดียวว่าควรอัปเดตสคีมา */
  let warnedSchemaGaps = "";
  function warnSchemaGaps() {
    const gaps = typeof API.schemaWarnings === "function" ? API.schemaWarnings() : [];
    const key = gaps.join(",");
    if (!gaps.length || key === warnedSchemaGaps) return;
    warnedSchemaGaps = key;
    toast("บันทึกให้แล้ว แต่ฐานข้อมูลยังไม่มีคอลัมน์ " + gaps.join(", ") +
      " — รัน migration ล่าสุดใน supabase/migrations เพื่อเปิดใช้ฟีเจอร์นี้เต็มรูปแบบ", "err", 6000);
  }

  async function save(silent) {
    const data = collect();
    if (!data.questions.length) { toast("ต้องมีอย่างน้อย 1 คำถามที่กรอกครบ", "err", 3600); return null; }
    const btns = [$("#btn-save"), $("#btn-save2"), $("#btn-play")];
    btns.forEach((b) => b && (b.disabled = true));
    try {
      if (editing.id) {
        if (!(await refreshLiveRooms())) {
          toast("ตรวจสอบห้องที่เปิดอยู่ไม่สำเร็จ จึงยังไม่บันทึกเพื่อป้องกันข้อมูลในเกมเสียหาย", "err", 4500);
          return null;
        }
        const running = roomsForQuiz(editing.id).filter(isRoomInProgress);
        if (running.length) {
          toast("ห้อง PIN " + running.map((r) => r.pin).join(", ") + " กำลังเล่นอยู่ — จบเกมก่อนจึงจะแก้ไขชุดนี้ได้", "err", 4500);
          return null;
        }
      }
      if (!editing.id) {
        const q = await API.createQuiz({ title: data.title, description: data.desc, emoji: data.emoji, max_players: data.max_players });
        editing.id = q.id;
        $("#btn-delete-quiz").classList.remove("hidden");
      } else {
        await API.updateQuiz(editing.id, { title: data.title, description: data.desc, emoji: data.emoji, max_players: data.max_players });
      }
      await API.replaceQuestions(editing.id, data.questions);
      if (!silent) toast("บันทึกแล้ว " + data.questions.length + " ข้อ", "ok");
      warnSchemaGaps();
      return editing.id;
    } catch (e) {
      toast(e.message, "err", 4200);
      return null;
    } finally {
      btns.forEach((b) => b && (b.disabled = false));
    }
  }

  /* ------------------------------------------------------------------ */
  /* import                                                             */
  /* ------------------------------------------------------------------ */
  let pendingSheet = null;     // { name, sheet } เมื่ออ่านจาก Excel

  function openImport(mode) {
    importMode = mode;
    parsed = [];
    pendingSheet = null;
    $("#import-text").value = "";
    $("#import-result").innerHTML = "";
    $("#file-info").innerHTML = "";
    $("#btn-import-run").textContent = "อ่านข้อมูล";
    show("s-import");
  }

  async function deleteQuiz(id, title) {
    if (!id || deletingQuiz) return;
    deletingQuiz = true;
    try {
      const rooms = await API.myRooms();
      liveRooms = (rooms || []).filter((r) => r && r.status && r.status !== "ended");
      roomStatusKnown = true;
      roomStatusError = "";
      renderLiveRooms();
      const linked = roomsForQuiz(id);
      const openRoomWarning = linked.length
        ? "\n\n⚠ มีห้องที่ยังไม่จบ " + linked.length + " ห้อง (PIN " + linked.map((r) => r.pin).join(", ") + ") — ห้องและผู้เล่นจะถูกปิด/ลบไปด้วยทันที"
        : "";
      const message = "ลบชุดคำถาม “" + (title || "ไม่มีชื่อ") + "” ใช่หรือไม่?\n\n" +
        "ระบบจะลบคำถาม ห้องที่สร้างจากชุดนี้ รายชื่อผู้เล่น คะแนน และคำตอบ/ประวัติห้องที่เกี่ยวข้องทั้งหมดด้วย ไม่สามารถกู้คืนได้" + openRoomWarning;
      if (!confirm(message)) return;
      await API.deleteQuiz(id);
      editing = null;
      toast("ลบชุดคำถามและข้อมูลห้องที่เกี่ยวข้องแล้ว", "ok", 3600);
      await renderList();
    } catch (e) {
      toast(e.message || "ลบชุดคำถามไม่สำเร็จ", "err", 4200);
    } finally {
      deletingQuiz = false;
    }
  }

  function bindStatic() {
    const clearModal = $("#clear-data-modal");
    const clearPass = $("#clear-data-password");
    const clearText = $("#clear-data-confirm");
    const clearBtn = $("#btn-clear-confirm");
    const updateClearButton = () => { clearBtn.disabled = !clearPass.value || clearText.value.trim() !== "ลบข้อมูลของฉัน"; };
    const closeClearModal = () => {
      clearModal.classList.add("hidden"); document.body.classList.remove("modal-open");
      clearPass.value = ""; clearText.value = ""; updateClearButton();
    };
    $("#btn-clear-data").addEventListener("click", () => {
      clearModal.classList.remove("hidden"); document.body.classList.add("modal-open");
      clearPass.focus();
    });
    $("#btn-clear-cancel").addEventListener("click", closeClearModal);
    clearModal.addEventListener("click", (e) => { if (e.target === clearModal) closeClearModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !clearModal.classList.contains("hidden")) closeClearModal(); });
    clearPass.addEventListener("input", updateClearButton);
    clearText.addEventListener("input", updateClearButton);
    clearBtn.addEventListener("click", async () => {
      if (clearBtn.disabled) return;
      clearBtn.disabled = true; clearBtn.textContent = "กำลังยืนยันและลบ…";
      try {
        const result = await API.purgeMyData(clearPass.value);
        closeClearModal();
        toast("ลบข้อมูลของบัญชีนี้แล้ว · " + (result.quizzes_removed || 0) + " ชุดคำถาม · " +
          (result.rooms_removed || 0) + " ห้อง · " + (result.players_removed || 0) + " ผู้เล่น", "ok", 5000);
        editing = null; liveRooms = []; roomStatusKnown = true; roomStatusError = "";
        await renderList();
      } catch (e) {
        toast(e.message || "ล้างข้อมูลไม่สำเร็จ", "err", 4500);
      } finally {
        clearBtn.textContent = "ยืนยันการลบถาวร";
        updateClearButton();
      }
    });
    $("#btn-new").addEventListener("click", () => newQuiz(""));
    const refreshRooms = $("#btn-refresh-rooms");
    if (refreshRooms) refreshRooms.addEventListener("click", async () => {
      refreshRooms.disabled = true;
      try { await renderList(); } finally { refreshRooms.disabled = false; }
    });
    $("#btn-import-open").addEventListener("click", () => openImport("new"));
    $("#btn-import-q").addEventListener("click", () => openImport("append"));
    $("#btn-back").addEventListener("click", async () => { await renderList(); });
    $("#btn-save").addEventListener("click", () => save());
    $("#btn-save2").addEventListener("click", () => save());
    $("#btn-play").addEventListener("click", async () => {
      const id = await save(true);
      if (id) location.href = "host.html?quiz=" + id;
    });
    $("#btn-add-q").addEventListener("click", addQuestion);
    $("#btn-delete-quiz").addEventListener("click", () => {
      if (!editing || !editing.id) return;
      deleteQuiz(editing.id, $("#quiz-title").value.trim() || editing.title);
    });
    $("#btn-import-back").addEventListener("click", () => {
      if (importMode === "append") show("s-editor"); else renderList();
    });
    $$("#s-import .tabs button").forEach((b) => b.addEventListener("click", () => {
      importTab = b.dataset.tab;
      $$("#s-import .tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $("#tab-csv").classList.toggle("hidden", importTab !== "csv");
      $("#tab-json").classList.toggle("hidden", importTab !== "json");
    }));
    $("#import-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
      e.target.value = "";
    });
    const dz = $("#dropzone");
    if (dz) {
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
      ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { stop(e); dz.classList.add("over"); }));
      ["dragleave", "dragend", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { stop(e); dz.classList.remove("over"); }));
      dz.addEventListener("drop", (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
      });
    }
    $("#btn-import-run").addEventListener("click", runImport);
    $("#btn-template").addEventListener("click", downloadTemplate);
    const tx = $("#btn-template-xlsx");
    if (tx) tx.addEventListener("click", downloadTemplateXlsx);
  }

  function autodetect() {
    const t = $("#import-text").value.trim();
    if (!t) return;
    importTab = t.startsWith("[") || t.startsWith("{") ? "json" : "csv";
  }

  function runImport() {
    autodetect();
    const text = $("#import-text").value;
    try {
      parsed = importTab === "json" ? parseJSON(text) : parseCSV(text);
      if (!parsed.length) throw new Error("ไม่พบคำถามในข้อมูลที่วาง");
      showPreview();
      if (window.Snd) Snd.play("click");
    } catch (e) {
      showImportError(e.message);
    }
  }

  /* อ่านไฟล์: Excel (.xlsx/.xls) → อ่านชีต, ไฟล์ข้อความ → อ่านเป็น CSV/TSV/JSON */
  async function handleFile(file) {
    const info = $("#file-info");
    const name = file.name || "ไฟล์";
    const isSheet = /\.(xlsx|xlsm|xlsb|xls)$/i.test(name);
    if (info) info.innerHTML = '<span class="chip-file">' + esc(name) + "</span> กำลังอ่านไฟล์…";
    try {
      if (isSheet) {
        if (!window.XLSX) throw new Error("ไลบรารีอ่าน Excel ยังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const picked = pickSheet(wb);
        if (!picked) throw new Error("ไม่พบชีตที่มีข้อมูลในไฟล์นี้");
        const rows = XLSX.utils.sheet_to_json(picked.sheet, { header: 1, raw: false, defval: "" });
        pendingSheet = { name, sheet: picked.name };
        importTab = "csv";
        syncTabs();
        parsed = parseTable(rows);
        if (!parsed.length) throw new Error("อ่านชีต “" + picked.name + "” แล้วไม่พบคำถามที่สมบูรณ์");
        if (info) {
          info.innerHTML = '<span class="chip-file">' + esc(name) + "</span> ชีต “" + esc(picked.name) +
            "” · " + rows.length + " แถว · พบ " + parsed.length + " ข้อ";
        }
        showPreview();
        if (window.Snd) Snd.play("correct");
        return;
      }
      const text = await file.text();
      $("#import-text").value = text;
      importTab = /\.json$/i.test(name) ? "json" : "csv";
      syncTabs();
      parsed = importTab === "json" ? parseJSON(text) : parseCSV(text);
      if (!parsed.length) throw new Error("ไม่พบคำถามในไฟล์นี้");
      if (info) info.innerHTML = '<span class="chip-file">' + esc(name) + "</span> พบ " + parsed.length + " ข้อ";
      showPreview();
      if (window.Snd) Snd.play("correct");
    } catch (e) {
      if (info) info.innerHTML = '<span class="chip-file">' + esc(name) + "</span>";
      showImportError(e.message);
    }
  }

  function syncTabs() {
    $$("#s-import .tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === importTab));
    $("#tab-csv").classList.toggle("hidden", importTab !== "csv");
    $("#tab-json").classList.toggle("hidden", importTab !== "json");
  }

  function pickSheet(wb) {
    const prefer = /^(คำถาม|ข้อสอบ|questions?|sheet1?|data)$/i;
    const names = wb.SheetNames || [];
    for (const n of names) if (prefer.test(n.trim()) && hasRows(wb.Sheets[n])) return { name: n, sheet: wb.Sheets[n] };
    for (const n of names) if (hasRows(wb.Sheets[n])) return { name: n, sheet: wb.Sheets[n] };
    return null;
  }
  function hasRows(ws) {
    if (!ws || !ws["!ref"]) return false;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    return rows.some((r) => r.join("").trim() !== "");
  }

  /* แถวที่ถูกข้าม (ข้อมูลไม่ครบ/ตัวเลือกเกิน 6) — บอกผู้ใช้ตรง ๆ ไม่ให้เข้าใจว่าคำถามครบ */
  function skippedNote() {
    const sk = (window.QuizImport && QuizImport.skipped) ? QuizImport.skipped() : [];
    if (!sk || !sk.length) return "";
    const lines = sk.slice(0, 3).map((x) => "แถวที่ " + x.row + ": " + esc(x.why)).join("<br>");
    const more = sk.length > 3 ? "<br>และอีก " + (sk.length - 3) + " แถว" : "";
    return '<div class="skip-note tiny">⚠ ข้าม ' + sk.length + " แถว — " + lines + more + "</div>";
  }

  function showPreview() {
    $("#import-result").innerHTML =
      '<div class="card card-tight"><div class="row-between" style="margin-bottom:10px">' +
      '<div><b>อ่านได้ ' + parsed.length + " ข้อ</b>" +
      '<div class="tiny muted">' + (pendingSheet ? "จากไฟล์ Excel · " : "") + "ตรวจตัวอย่างด้านล่างก่อนยืนยัน</div>" +
      skippedNote() + "</div>" +
      '<button class="btn btn-primary" id="btn-import-confirm">' +
      (importMode === "append" ? "เพิ่มเข้าชุดนี้ (" + parsed.length + " ข้อ)" : "สร้างชุดคำถามใหม่") + "</button></div>" +
      '<div class="col" style="gap:8px">' + parsed.slice(0, 3).map((q, i) =>
        '<div class="q-item"><div class="row"><div class="qnum">' + (i + 1) + "</div><div style=\"font-weight:700\">" + esc(q.prompt) + "</div></div>" +
        '<div class="small muted">' + q.options.map((o, oi) =>
          (oi === q.correct_index ? '<span class="correct-tag">ถูก</span> ' : "") + esc(o)
        ).join(" · ") + "</div></div>"
      ).join("") + "</div></div>";
    $("#btn-import-confirm").addEventListener("click", confirmImport);
  }

  function showImportError(msg) {
    $("#import-result").innerHTML = '<div class="card card-tight" style="border-color:rgba(255,86,112,.5)">' +
      '<b style="color:#ffb3c0">อ่านข้อมูลไม่สำเร็จ</b><p class="small muted" style="margin-top:6px">' + esc(msg) + "</p></div>";
  }

  async function confirmImport() {
    if (!parsed.length) return;
    if (importMode === "append") {
      parsed.forEach((q) => questions.push(q));
      renderQuestions();
      toast("เพิ่ม " + parsed.length + " ข้อแล้ว — อย่าลืมกดบันทึก", "ok", 3600);
      show("s-editor");
      return;
    }
    const title = prompt("ชื่อชุดคำถามใหม่:", "ชุดคำถามที่นำเข้า");
    if (title === null) return;
    try {
      const q = await API.createQuiz({ title: title || "ชุดคำถามที่นำเข้า", description: "", emoji: "📥" });
      await API.replaceQuestions(q.id, parsed);
      toast("สร้างชุดคำถาม " + parsed.length + " ข้อแล้ว", "ok");
      warnSchemaGaps();
      await openEditor(q.id);
    } catch (e) { toast(e.message, "err", 4200); }
  }

  /* ------------------------------------------------------------------ */
  /* parsers                                                            */
  /* ------------------------------------------------------------------ */
  function parseCSV(text) {
    const raw = text.replace(/\r\n?/g, "\n").trim();
    const firstLine = raw.split("\n")[0];
    const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inQ) {
        if (c === '"') {
          if (raw[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(cell); cell = ""; }
        else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
        else cell += c;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return parseTable(rows);
  }

  let lastSkipped = [];        // แถวที่ถูกข้าม พร้อมเหตุผล (แสดงเตือนบนหน้าจอ)

  /* แปลงตาราง (array ของแถว) เป็นรายการคำถาม — ใช้ทั้ง CSV และ Excel */
  function parseTable(rows) {
    const skipped = [];
    // ตัดแถวว่างหัว/ท้าย และแถวที่ว่างทั้งแถว
    rows = (rows || []).filter((r) => r && r.join("").trim() !== "");
    if (rows.length < 2) throw new Error("ต้องมีแถวหัวตารางและอย่างน้อย 1 แถวข้อมูล");

    const header = rows[0].map((h) => String(h == null ? "" : h).trim().toLowerCase().replace(/^\ufeff/, ""));
    const map = header.map(headerToField);
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.join("").trim()) continue;
      const q = { options: [], correct_index: 0, time_limit: 20, points: 1000, image_url: "", background: "aurora" };
      let correctRaw = "";
      cells.forEach((val, i) => {
        const f = map[i];
        const v = (val || "").trim();
        if (!f) return;
        if (f === "prompt") q.prompt = v;
        else if (f.startsWith("option")) {
          const n = +f.replace("option", "") - 1;
          q.options[n] = v;
        } else if (f === "correct") correctRaw = v;
        else if (f === "time_limit") q.time_limit = clamp(+v || 20, 5, 300);
        else if (f === "points") q.points = clamp(+v || 1000, 100, 4000);
        else if (f === "image_url") q.image_url = v;
        else if (f === "show_options") q.show_options = /^(shape|symbol|สัญลักษณ์|สี|shape_only)$/i.test(v) ? "shape" : "text";
        else if (f === "background") q.background = validBackground(v);
      });
      // เก็บเฉพาะตัวเลือกที่มีข้อความ พร้อมจำว่าเฉลยเดิมชี้ไปช่องไหน
      // (ห้ามเลื่อน index เงียบ ๆ เพราะจะทำให้ "ข้อถูก" เปลี่ยนเป็นข้ออื่น)
      q.options = q.options.filter((o) => o !== undefined && o !== null && String(o).trim() !== "");
      if (!q.prompt || q.options.length < 2) { skipped.push({ row: r, why: "ต้องมีคำถามและตัวเลือกอย่างน้อย 2 ข้อ" }); continue; }
      if (q.options.length > 6) {
        skipped.push({ row: r, why: "มี " + q.options.length + " ตัวเลือก เกิน 6 ข้อที่ระบบรองรับ" });
        continue;
      }
      const ci = resolveCorrect(correctRaw, q.options);
      if (ci < 0) {
        skipped.push({ row: r, why: "เฉลย “" + String(correctRaw).slice(0, 20) + "” ไม่ตรงกับตัวเลือกที่มี" });
        continue;
      }
      q.correct_index = ci;
      out.push(q);
    }
    if (!out.length) throw new Error(skipped.length
      ? "ไม่พบแถวที่สมบูรณ์ — แถวแรกที่ข้าม: " + skipped[0].why
      : "ไม่พบแถวที่มีคำถามและตัวเลือกอย่างน้อย 2 ตัวเลือก");
    // เปิดให้ UI แสดงว่าแถวไหนถูกข้ามเพราะอะไร
    lastSkipped = skipped;
    return out;
  }

  function headerToField(h) {
    h = h.replace(/\s+/g, "");
    if (!h) return null;
    if (["question", "prompt", "คำถาม", "โจทย์", "คำถามที่"].includes(h)) return "prompt";
    if (["correct", "answer", "เฉลย", "คำตอบ", "คำตอบที่ถูก", "ข้อที่ถูก"].includes(h)) return "correct";
    if (["time", "time_limit", "เวลา", "เวลาวินาที", "วินาที"].includes(h)) return "time_limit";
    if (["points", "score", "คะแนน"].includes(h)) return "points";
    if (["image", "image_url", "รูป", "รูปภาพ"].includes(h)) return "image_url";
    if (["show_options", "showoptions", "แสดงตัวเลือก", "โหมดแสดง"].includes(h)) return "show_options";
    if (["background", "พื้นหลัง", "ฉากหลัง"].includes(h)) return "background";
    let m = h.match(/^(option|opt|choice|ตัวเลือก|ข้อ)?(\d{1,2})$/);
    if (m) return "option" + m[2];   // รับถึง option20 เพื่อตรวจจับ "เกิน 6" แล้วเตือน ไม่ใช่ทิ้งเงียบ ๆ
    if (/^[a-f]$/.test(h)) return "option" + (h.charCodeAt(0) - 96);
    return null;
  }

  /* คืน index ของข้อถูก (-1 = หาไม่ได้ → ให้ผู้เรียกเตือน ไม่เดาเอาเอง) */
  function resolveCorrect(raw, options) {
    const v = String(raw || "").trim();
    if (!v) return 0;                                   // ไม่ระบุ = ข้อแรก (พฤติกรรมเดิม)
    let n = 0;
    if (/^\d{1,2}$/.test(v)) n = +v;
    else if (/^[a-zA-Z]$/.test(v)) n = v.toLowerCase().charCodeAt(0) - 96;
    if (n >= 1 && n <= options.length) return n - 1;
    const idx = options.findIndex((o) => o.trim() === v);
    if (idx >= 0) return idx;
    return -1;                                          // เฉลยไม่มีอยู่จริง
  }

  function parseJSON(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.questions || data.items || []);
    if (!Array.isArray(arr)) throw new Error("JSON ต้องเป็น array ของคำถาม");
    const out = [];
    arr.forEach((item) => {
      const prompt = (item.prompt || item.question || item.q || "").toString().trim();
      let options = item.options || item.choices || item.answers;
      if (!Array.isArray(options)) {
        options = [1, 2, 3, 4, 5, 6].map((i) => item["option" + i]).filter((x) => x != null && String(x).trim() !== "");
      }
      options = (options || []).map((o) => String(o).trim()).filter(Boolean);
      if (!prompt || options.length < 2) return;
      let ci = item.correct_index;
      if (ci == null) ci = item.correctIndex;
      if (ci == null) ci = resolveCorrect(item.correct != null ? item.correct : item.answer, options);
      ci = clamp(+ci || 0, 0, options.length - 1);
      out.push({
        prompt, options, correct_index: ci,
        time_limit: clamp(+item.time_limit || +item.time || 20, 5, 300),
        points: clamp(+item.points || 1000, 100, 4000),
        image_url: item.image_url || item.image || "",
        background: validBackground(item.background)
      });
    });
    if (!out.length) throw new Error("ไม่พบคำถามที่สมบูรณ์ใน JSON");
    return out;
  }

  /* ---------- เทมเพลท CSV ---------- */
  function downloadTemplate() {
    const rows = TEMPLATE_ROWS;
    const csv = "\ufeff" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "quiz-template.csv");
    if (window.Snd) Snd.play("click");
  }

  /* ---------- เทมเพลท Excel (.xlsx) สร้างสด ๆ ด้วย SheetJS ---------- */
  function downloadTemplateXlsx() {
    if (!window.XLSX) { toast("ตัวอ่าน Excel ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "err"); return; }
    try {
      const wb = XLSX.utils.book_new();

      const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER, ...TEMPLATE_ROWS.slice(1)]);
      ws["!cols"] = [{ wch: 46 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 },
        { wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 30 }, { wch: 16 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, "คำถาม");

      const gs = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE);
      gs["!cols"] = [{ wch: 18 }, { wch: 62 }, { wch: 52 }];
      XLSX.utils.book_append_sheet(wb, gs, "คำแนะนำ");

      const out = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
      saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "quiz-template.xlsx");
      toast("ดาวน์โหลดเทมเพลท Excel แล้ว", "ok");
      if (window.Snd) Snd.play("correct");
    } catch (e) {
      toast("สร้างไฟล์เทมเพลทไม่สำเร็จ: " + e.message, "err", 4000);
    }
  }

  function saveBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ข้อมูลเทมเพลท (ใช้ร่วมกับ tools/make-quiz-template.mjs) */
  const TEMPLATE_HEADER = ["question", "option1", "option2", "option3", "option4", "option5", "option6",
    "correct", "time_limit", "points", "image_url", "show_options", "background"];

  const TEMPLATE_ROWS = [
    TEMPLATE_HEADER,
    ["ข้อใดคือเมืองหลวงของประเทศไทย", "เชียงใหม่", "กรุงเทพมหานคร", "ขอนแก่น", "ภูเก็ต", "", "", "2", "20", "1000", "", ""],
    ["สำนักงาน ป.ป.ช. ย่อมาจากอะไร", "สำนักงานป้องกันและปราบปรามยาเสพติด", "สำนักงานคณะกรรมการป้องกันและปราบปรามการทุจริตแห่งชาติ", "สำนักงานตรวจเงินแผ่นดิน", "สำนักงานคณะกรรมการสิทธิมนุษยชน", "", "", "2", "20", "1000", "", ""],
    ["1 + 1 เท่ากับเท่าไร", "1", "2", "3", "4", "", "", "2", "10", "1000", "", ""],
    ["ข้อใดคือช่องทางรับแจ้งเบาะแสการทุจริตของ ป.ป.ช.", "สายด่วน 1205", "สายด่วน 191", "สายด่วน 1111", "สายด่วน 1300", "", "", "1", "20", "1000", "", ""],
    ["การกระทำใดถือเป็นการทุจริต", "การรับของขวัญตามประเพณี", "การเรียกผลประโยชน์เพื่อแลกกับการอนุมัติ", "การทำงานล่วงเวลา", "การอบรมสัมมนา", "", "", "2", "25", "1000", "", ""]
  ];

  const TEMPLATE_GUIDE = [
    ["คอลัมน์", "ความหมาย", "ค่าที่ใช้ได้"],
    ["question", "โจทย์คำถาม (จำเป็น)", "ข้อความ"],
    ["option1 … option6", "ตัวเลือก 2–6 ข้อ (จำเป็นอย่างน้อย 2)", "ข้อความ"],
    ["correct", "ตัวเลือกที่ถูก (จำเป็น)", "เลข 1–6 หรือ A–F หรือข้อความของตัวเลือกนั้น"],
    ["time_limit", "เวลาตอบต่อข้อ (วินาที)", "5–300 (ค่าเริ่มต้น 20)"],
    ["points", "คะแนนเต็มของข้อ (ตอบถูกได้ 55–100% ตามความเร็ว)", "100–4000 (ค่าเริ่มต้น 1000)"],
    ["image_url", "ลิงก์รูปประกอบ (ไม่บังคับ)", "https://…"],
    ["show_options", "การแสดงตัวเลือกบนจอผู้เล่น (ไม่บังคับ)", "text = ข้อความครบ · shape = สัญลักษณ์สีเท่านั้น · เว้นว่าง = ตามที่ผู้จัดตั้ง"],
    ["background", "ธีมพื้นหลังคำถาม (ไม่บังคับ)", "aurora / sunset / ocean / forest / galaxy / candy / midnight / coral / mint / gold"],
    ["", "", ""],
    ["วิธีใช้", "กรอกข้อมูลในชีต “คำถาม” แถวละ 1 ข้อ แล้วบันทึกเป็น .xlsx", "ห้ามเปลี่ยนชื่อคอลัมน์ในแถวแรก"],
    ["หมายเหตุ", "ระบบอ่านคอลัมน์ตามชื่อ — ใช้หัวตารางภาษาไทย (คำถาม/ตัวเลือก1/เฉลย/เวลา/คะแนน) ก็ได้", ""],
    ["วิธีคิดคะแนน", "ตอบถูก = คะแนนเต็ม × (0.55 + 0.45 × เวลาที่เหลือ ÷ เวลาข้อ) · ตอบผิด = 0", ""],
    ["โบนัสสตรีค", "ตอบถูกติดกันตั้งแต่ 3 ข้อขึ้นไป ได้เพิ่ม +100 คะแนนทุกข้อ", ""],
    ["หมายเหตุ", "ระบบอ่านชีตแรกที่มีข้อมูล จึงลบชีตนี้ได้ถ้าไม่ต้องการ", ""]
  ];
    /* เปิดให้ใช้ซ้ำ/ทดสอบได้ (ดู tools/smoke-test) */
  window.QuizImport = { parseTable, parseCSV, parseJSON, skipped: () => lastSkipped };
})();
