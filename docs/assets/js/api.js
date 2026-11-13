/* ชั้นเชื่อมต่อ Supabase — ทุกหน้าจอเรียกผ่าน API.* เท่านั้น */
(function () {
  const cfg = window.QUIZ_CONFIG || {};
  const ERRORS = {
    room_not_found: "ไม่พบห้องนี้ — ตรวจสอบ PIN อีกครั้ง",
    room_full: "ห้องนี้มีผู้เล่นครบตามจำนวนที่ผู้จัดกำหนดแล้ว",
    free_plan_capacity: "จำนวนผู้เล่นรวมของทุกห้องถึงเพดานความปลอดภัยของ Free แล้ว กรุณาลองใหม่เมื่อมีห้องจบ",
    game_started: "เกมเริ่มแล้ว รอรอบถัดไปนะ",
    nickname_taken: "ชื่อนี้มีคนใช้แล้ว ลองเติมชื่ออื่น",
    nickname_required: "กรุณาใส่ชื่อของคุณ",
    time_up: "หมดเวลาข้อนี้แล้ว",
    already_answered: "คุณตอบข้อนี้ไปแล้ว",
    not_open: "ข้อนี้ปิดรับคำตอบแล้ว",
    player_not_found: "ไม่พบผู้เล่นนี้ กรุณาเข้าห้องใหม่",
    question_not_found: "ไม่พบข้อคำถาม",
    quiz_empty: "ชุดคำถามนี้ยังไม่มีคำถาม",
    quiz_not_found: "ไม่พบชุดคำถาม",
    forbidden: "คุณไม่มีสิทธิ์ในห้องนี้",
    not_authenticated: "กรุณาเข้าสู่ระบบก่อน",
    pin_unavailable: "สร้าง PIN ไม่สำเร็จ ลองอีกครั้ง",
    game_ended: "เกมนี้จบแล้ว",
    bad_mode: "โหมดแสดงผลไม่ถูกต้อง",
    bad_choice: "ตัวเลือกที่ส่งมาไม่ถูกต้อง",
    bad_status: "สถานะห้องไม่ถูกต้อง",
    bad_transition: "เปลี่ยนสถานะห้องแบบนี้ไม่ได้ — เกมอาจจบไปแล้ว",
    not_ended: "เริ่มรอบใหม่ได้หลังจบเกมแล้วเท่านั้น"
  };
  const msg = (code) => ERRORS[code] || "เกิดข้อผิดพลาด: " + code;

  /* แปลข้อความ error จากฐานข้อมูลเป็นภาษาไทยที่ผู้ใช้เข้าใจ
     (check constraint / RLS / ฟังก์ชันไม่พบ ฯลฯ) */
  function thaiDbError(m) {
    const raw = String(m || "");
    if (/questions_options_len_chk/i.test(raw)) return "คำถามต้องมีตัวเลือก 2–6 ข้อ";
    if (/questions_correct_in_range_chk/i.test(raw)) return "เฉลยต้องชี้ไปที่ตัวเลือกที่มีอยู่จริง";
    if (/questions_options_text_chk/i.test(raw)) return "ตัวเลือกต้องเป็นข้อความและห้ามเว้นว่าง";
    if (/questions_time_limit_check/i.test(raw)) return "เวลาตอบต้องอยู่ระหว่าง 5–300 วินาที";
    if (/questions_points_check/i.test(raw)) return "คะแนนต้องอยู่ระหว่าง 100–4,000";
    if (/questions_show_options_chk|rooms_show_options_chk/i.test(raw)) return "โหมดแสดงตัวเลือกไม่ถูกต้อง";
    if (/players_nickname_check/i.test(raw)) return "ชื่อผู้เล่นต้องยาว 1–24 ตัวอักษร";
    if (/rooms_status_chk/i.test(raw)) return "สถานะห้องไม่ถูกต้อง";
    if (/row-level security|violates row-level security/i.test(raw)) return "คุณไม่มีสิทธิ์ทำรายการนี้ (ต้องเข้าสู่ระบบด้วยบัญชีเจ้าของ)";
    if (/duplicate key/i.test(raw)) return "มีข้อมูลซ้ำในระบบ ลองใหม่อีกครั้ง";
    if (/JWT expired|invalid claim/i.test(raw)) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
    if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
    if (/permission denied for (function|table)/i.test(raw)) return "บัญชีนี้ไม่มีสิทธิ์เรียกฟังก์ชันนี้";
    if (missingColumnName(raw)) return "ฐานข้อมูลยังไม่ตรงกับสคีมาล่าสุด (ไม่มีคอลัมน์ “" + missingColumnName(raw) + "”) — กรุณารัน migration ล่าสุดใน supabase/migrations";
    return raw;
  }

  /* ชื่อคอลัมน์ที่ PostgREST/Postgres บอกว่าไม่มี (schema cache ไม่ตรงกับโค้ด)
     เช่น "Could not find the 'max_players' column of 'quizzes' in the schema cache" */
  function missingColumnName(m) {
    const s = String(m || "");
    const a = s.match(/Could not find the '([A-Za-z0-9_]+)' column of '[A-Za-z0-9_]+' in the schema cache/i);
    if (a) return a[1];
    const b = s.match(/column "?([A-Za-z0-9_]+)"? of relation "?[A-Za-z0-9_]+"? does not exist/i);
    if (b) return b[1];
    return "";
  }

  /* ฐานข้อมูลที่ยังไม่ได้รัน migration ล่าสุดไม่ควรทำให้บันทึกชุดคำถามไม่สำเร็จทั้งก้อน
     ถ้าคอลัมน์ไหนยังไม่มี ให้ตัดคอลัมน์นั้นออกแล้วบันทึกซ้ำ (ฟีเจอร์นั้นจะใช้ค่าเริ่มต้นของฐานข้อมูล)
     และจำชื่อคอลัมน์ที่ขาดไว้ให้หน้าจอเตือนผู้จัดครั้งเดียว */
  const schemaWarnings = [];
  function noteSchemaGap(col) {
    if (schemaWarnings.indexOf(col) === -1) schemaWarnings.push(col);
    console.warn("[schema] ฐานข้อมูลไม่มีคอลัมน์ “" + col + "” — บันทึกโดยใช้ค่าเริ่มต้น (รัน migration ล่าสุดเพื่อเปิดฟีเจอร์นี้)");
  }
  async function writeWithColumnFallback(makeQuery, row) {
    const isArray = Array.isArray(row);
    let draft = isArray ? row.map((r) => ({ ...r })) : { ...row };
    const dropColumn = (col) => {
      if (isArray) draft.forEach((r) => delete r[col]);
      else delete draft[col];
    };
    const hasColumn = (col) => (isArray ? draft.some((r) => Object.prototype.hasOwnProperty.call(r, col)) : Object.prototype.hasOwnProperty.call(draft, col));
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, error } = await makeQuery(draft);
      if (!error) return data;
      const col = missingColumnName(error.message);
      if (!col || !hasColumn(col)) {
        throw new Error(thaiDbError(error.message));
      }
      noteSchemaGap(col);
      dropColumn(col);
    }
    throw new Error("ฐานข้อมูลยังไม่ตรงกับสคีมาล่าสุด กรุณารัน migration ล่าสุดใน supabase/migrations");
  }

  let sb = null;
  function client() {
    if (!sb) {
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error("ยังไม่ได้ตั้งค่า Supabase ใน config.js");
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return sb;
  }

  async function rpc(fn, args) {
    const { data, error } = await client().rpc(fn, args || {});
    if (error) { console.error("[rpc]", fn, error); throw new Error(thaiDbError(error.message) || "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"); }
    if (data && data.error) { const e = new Error(msg(data.error)); e.code = data.error; throw e; }
    return data;
  }

  const API = {
    /* ---------- auth ---------- */
    async currentUser() {
      const { data } = await client().auth.getUser();
      return data ? data.user : null;
    },
    async signIn(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw new Error(thaiAuthError(error.message));
      return data.user;
    },
    async signUp(email, password) {
      const { data, error } = await client().auth.signUp({ email, password });
      if (error) throw new Error(thaiAuthError(error.message));
      if (!data.session) throw new Error("สมัครไม่สำเร็จ กรุณายืนยันอีเมลแล้วเข้าสู่ระบบ");
      return data.user;
    },
    async signOut() { await client().auth.signOut(); },
    async purgeMyData(password) {
      const current = await API.currentUser();
      if (!current || !current.email) throw new Error("กรุณาเข้าสู่ระบบใหม่ก่อนล้างข้อมูล");
      // ยืนยันรหัสผ่านกับ Supabase Auth ก่อนเรียก RPC; ไม่ส่งรหัสผ่านเข้า SQL และไม่เก็บไว้
      const { data, error } = await client().auth.signInWithPassword({ email: current.email, password });
      if (error) throw new Error(thaiAuthError(error.message));
      if (!data.user || data.user.id !== current.id) throw new Error("บัญชีผู้ใช้ไม่ตรงกัน ยกเลิกการลบข้อมูล");
      return rpc("purge_my_data", {});
    },

    /* ---------- quiz library ---------- */
    async listQuizzes() {
      const { data, error } = await client().from("quizzes").select("*").order("updated_at", { ascending: false });
      if (error) throw new Error(thaiDbError(error.message));
      const { data: qs } = await client().from("questions").select("quiz_id");
      const counts = {};
      (qs || []).forEach((q) => { counts[q.quiz_id] = (counts[q.quiz_id] || 0) + 1; });
      return (data || []).map((q) => ({ ...q, question_count: counts[q.id] || 0 }));
    },
    async getQuiz(id) {
      const { data: quiz, error } = await client().from("quizzes").select("*").eq("id", id).single();
      if (error) throw new Error(thaiDbError(error.message));
      const { data: questions, error: e2 } = await client().from("questions").select("*")
        .eq("quiz_id", id).order("position", { ascending: true });
      if (e2) throw new Error(e2.message);
      return { quiz, questions: questions || [] };
    },
    async createQuiz(payload) {
      const user = await API.currentUser();
      if (!user) throw new Error("กรุณาเข้าสู่ระบบก่อน");
      const row = {
        title: payload.title,
        description: payload.description || null,
        emoji: payload.emoji || "🎯",
        max_players: Math.max(0, Math.min(120, Number(payload.max_players) || 0)),
        owner_id: user.id
      };
      return writeWithColumnFallback(
        (draft) => client().from("quizzes").insert(draft).select().single(),
        row
      );
    },
    async updateQuiz(id, patch) {
      await writeWithColumnFallback(
        (draft) => client().from("quizzes").update(draft).eq("id", id),
        patch || {}
      );
    },
    async deleteQuiz(id) {
      const { error } = await client().from("quizzes").delete().eq("id", id);
      if (error) throw new Error(thaiDbError(error.message));
    },
    async replaceQuestions(quizId, questions) {
      const { error: e1 } = await client().from("questions").delete().eq("quiz_id", quizId);
      if (e1) throw new Error(e1.message);
      if (!questions.length) return;
      const rows = questions.map((q, i) => ({
        quiz_id: quizId, position: i, prompt: q.prompt, image_url: q.image_url || null,
        options: q.options, correct_index: q.correct_index,
        time_limit: q.time_limit || 20, points: q.points || 1000,
        show_options: q.show_options === "shape" || q.show_options === "text" ? q.show_options : null,
        background: ["aurora", "sunset", "ocean", "forest", "galaxy", "candy", "midnight", "coral", "mint", "gold"].includes(q.background) ? q.background : "aurora"
      }));
      await writeWithColumnFallback(
        (draft) => client().from("questions").insert(draft),
        rows
      );
    },

    /* ---------- host ---------- */
    createRoom: (quizId, allowLate) => rpc("create_room", { p_quiz_id: quizId, p_allow_late: !!allowLate }),
    hostSnapshot: (roomId) => rpc("host_snapshot", { p_room_id: roomId }),
    nextQuestion: (roomId) => rpc("host_next_question", { p_room_id: roomId }),
    setStatus: (roomId, status) => rpc("host_set_status", { p_room_id: roomId, p_status: status }),
    hostStats: (roomId, questionId) => rpc("host_question_stats", { p_room_id: roomId, p_question_id: questionId }),
    setShowOptions: (roomId, mode) => rpc("host_set_show_options", { p_room_id: roomId, p_mode: mode }),
    restartRoom: (roomId) => rpc("host_restart_room", { p_room_id: roomId }),

    /* ---------- จัดการห้อง (หน้าห้องทำงาน) ---------- */
    /* ปิดห้องได้ทุกสถานะ — ถ้ายังไม่ได้รัน migration 0009 จะถอยไปอัปเดตตารางตรง ๆ
       ซึ่ง RLS อนุญาตให้เจ้าของห้องทำได้อยู่แล้ว */
    async closeRoom(roomId) {
      try {
        return await rpc("host_close_room", { p_room_id: roomId });
      } catch (e) {
        if (!isMissingFunction(e)) throw e;
        const { error } = await client().from("rooms")
          .update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", roomId);
        if (error) throw new Error(thaiDbError(error.message));
        return { ok: true, status: "ended" };
      }
    },
    /* ลบห้องพร้อมผู้เล่น คะแนน และคำตอบ (ON DELETE CASCADE) */
    async deleteRoom(roomId) {
      try {
        return await rpc("host_delete_room", { p_room_id: roomId });
      } catch (e) {
        if (!isMissingFunction(e)) throw e;
        const { error } = await client().from("rooms").delete().eq("id", roomId);
        if (error) throw new Error(thaiDbError(error.message));
        return { ok: true, deleted: true };
      }
    },
    async setAllowLate(roomId, allow) {
      const { error } = await client().from("rooms").update({ allow_late: !!allow }).eq("id", roomId);
      if (error) throw new Error(thaiDbError(error.message));
    },
    async myRooms() {
      const user = await API.currentUser();
      if (!user) return [];
      // PIN ของห้องต้องไม่ปะปนหรือรั่วจากเจ้าของรายอื่น ๆ
      // ห้องจบแล้วไม่จำเป็นสำหรับแผง "กลับเข้าห้อง" และการป้องกันแก้คำถามระหว่างเกม
      const { data, error } = await client().from("rooms")
        .select("id,pin,status,created_at,quiz_id,current_index,allow_late,show_options")
        .eq("host_id", user.id).neq("status", "ended")
        .order("created_at", { ascending: false }).limit(1000);
      if (error) throw new Error(thaiDbError(error.message));
      return data || [];
    },

    /* ---------- player ---------- */
    joinRoom: (pin, nickname, avatar) =>
      rpc("join_room", { p_pin: pin, p_nickname: nickname, p_avatar: avatar || null }),
    setAvatar: (token, avatar) => rpc("set_avatar", { p_token: token, p_avatar: avatar || {} }),
    resume: (token) => rpc("player_resume", { p_token: token }),
    roomState: (pin) => rpc("room_public_state", { p_pin: pin }),
    submitAnswer: (token, questionId, choice) =>
      rpc("submit_answer", { p_token: token, p_question_id: questionId, p_choice: choice }),
    leaderboard: (pin, limit) => rpc("room_leaderboard", { p_pin: pin, p_limit: limit || 500 }),

    /* ---------- realtime ---------- */
    subscribeRoom(pin, onSync) {
      try {
        const ch = client().channel("room:" + pin, { config: { broadcast: { self: false } } });
        ch.on("broadcast", { event: "sync" }, (p) => { try { onSync(p && p.payload); } catch (e) { console.error(e); } });
        ch.subscribe();
        return {
          send() { try { ch.send({ type: "broadcast", event: "sync", payload: { t: Date.now() } }); } catch (e) { /* ไม่เป็นไร มี polling สำรอง */ } },
          close() { try { client().removeChannel(ch); } catch (e) { } }
        };
      } catch (e) {
        console.warn("realtime unavailable", e);
        return { send() { }, close() { } };
      }
    }
  };

  function thaiAuthError(m) {
    m = String(m || "");
    if (/invalid login credentials/i.test(m)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    if (/email not confirmed/i.test(m)) return "ยังไม่ได้ยืนยันอีเมล";
    if (/already registered|already exists/i.test(m)) return "อีเมลนี้มีบัญชีอยู่แล้ว";
    if (/password should be at least/i.test(m)) return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)";
    if (/rate limit/i.test(m)) return "ลองบ่อยเกินไป กรุณารอสักครู่";
    return m;
  }

  /* ฟังก์ชันใหม่ที่ยังไม่ได้รัน migration → PostgREST ตอบว่าไม่พบฟังก์ชัน */
  function isMissingFunction(err) {
    const m = String((err && err.message) || "");
    return /could not find the function|function .* does not exist|schema cache/i.test(m);
  }

  API.schemaWarnings = () => schemaWarnings.slice();  // คอลัมน์ที่ฐานข้อมูลยังไม่มี (ให้หน้าจอเตือน)
  window.API = API;
  window.thaiDbError = thaiDbError;   // เปิดให้เครื่องมือทดสอบเรียกได้
  window.isMissingRpc = isMissingFunction;
  window.missingColumnName = missingColumnName;
})();
