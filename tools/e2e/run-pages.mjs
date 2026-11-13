/**
 * ทดสอบหน้าเว็บจริง (index.html / host.html / play.html / admin.html) ด้วย jsdom
 *
 * วิธีทำงาน: โหลด HTML จริง + สคริปต์จริงทั้งหมด ยกเว้น
 *   - vendor/supabase.js  → แทนด้วยไฟล์ว่าง (ไม่ต้องต่อเน็ต)
 *   - assets/js/api.js    → แทนด้วย API ปลอมที่ป้อนข้อมูลชุดเดียวกับที่เซิร์ฟเวอร์จริงตอบ
 *     (โครงสร้างฟิลด์คัดลอกจาก payload จริงของ Supabase: host_snapshot / player_resume)
 *
 *   node tools/e2e/run-pages.mjs
 *
 * ผลลัพธ์: PASS/FAIL ทีละข้อ + exit code 1 ถ้ามีข้อไม่ผ่าน
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let JSDOM, VirtualConsole, requestInterceptor;
try {
  ({ JSDOM, VirtualConsole, requestInterceptor } = await import("jsdom"));
} catch (e) {
  console.log("ข้ามการทดสอบ: ยังไม่ได้ติดตั้ง jsdom (npm i jsdom)");
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const BASE = process.env.BASE_URL || "http://localhost:8123/";
const out = [];
let failed = 0;
function check(name, cond, extra) {
  const line = (cond ? "PASS " : "FAIL ") + name + (extra != null && extra !== "" ? "  → " + extra : "");
  out.push(line);
  if (!cond) failed++;
  console.log(line);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* ข้อมูลตัวอย่าง (โครงสร้างตรงกับ payload จริง)                       */
/* ------------------------------------------------------------------ */
const PIN = "441052";
const ROOM = "4882ffeb-8b62-49d8-ae09-d4a24cf49092";
const QID = "acd1eae0-66f5-40fb-9aeb-cbdf5108d1fd";
const NOW = new Date().toISOString();
const OPTIONS = ["เชียงใหม่", "กรุงเทพมหานคร", "ขอนแก่น", "ภูเก็ต"];
const PROMPT = "ข้อใดคือเมืองหลวงของประเทศไทย";

const players = [
  { id: "p1", nickname: "Anna", score: 1000, streak: 1, correct_count: 1, avatar: { c: "cat", h: "crown", s: 2, t: 0 }, joined_at: NOW },
  { id: "p2", nickname: "บอย", score: 0, streak: 0, correct_count: 0, avatar: { c: "robot", h: "headset", s: 4, t: 3 }, joined_at: NOW },
  { id: "p3", nickname: "Chef", score: 0, streak: 0, correct_count: 0, avatar: { c: "panda", h: "party", s: 1, t: 7 }, joined_at: NOW }
];

function state(status, extra = {}) {
  const base = {
    room_id: ROOM, pin: PIN, quiz_id: "quiz-1", status, current_index: 0,
    question_count: 5, player_count: players.length,
    quiz_title: "E2E ชุดทดสอบระบบ", quiz_emoji: "🧪",
    show_options: "text", server_now: NOW,
    question_started_at: NOW, question_ends_at: new Date(Date.now() + 9000).toISOString(),
    allow_late: false, recent_players: players,
    players: players.slice(), answered: 0, correct: 0
  };
  if (status !== "lobby") {
    base.question = { id: QID, index: 0, prompt: PROMPT, options: OPTIONS, image_url: null, time_limit: 10, points: 1000, show_options: "text" };
  } else {
    base.current_index = -1;
    base.question_started_at = null;
    base.question_ends_at = null;
  }
  if (["reveal", "leaderboard", "ended"].includes(status)) {
    base.correct_index = 1;
    base.distribution = { "1": 1, "2": 1 };
  }
  if (status === "ended") {
    base.final_leaderboard = players.map((p, i) => ({
      rank: i + 1, nickname: p.nickname, score: p.score, streak: p.streak,
      correct_count: p.correct_count, avatar: p.avatar
    }));
  }
  return Object.assign(base, extra);
}

/* API ปลอม — แทน assets/js/api.js */
const API_STUB = `
(function () {
  const F = window.__FIX;
  let i = 0;
  const snapshots = F.snapshots;
  window.API = {
    currentUser: async () => ({ id: "host-1", email: "e2e@naccquiz.test" }),
    signIn: async () => ({ id: "host-1" }), signUp: async () => ({ id: "host-1" }),
    signOut: async () => {},
    listQuizzes: async () => F.quizzes || [{ id: "quiz-1", title: "E2E ชุดทดสอบระบบ", emoji: "🧪", question_count: 5 }],
    getQuiz: async (id) => F.quiz || ({
      quiz: { id: id || "quiz-1", title: "E2E ชุดทดสอบระบบ", description: "ชุดตัวอย่าง", emoji: "🧪" },
      questions: [{ prompt: "ข้อเดิม", options: ["ก", "ข", "ค"], correct_index: 1, time_limit: 20, points: 1000 }]
    }),
    createQuiz: async (payload) => {
      (F.createCalls = F.createCalls || []).push(payload);
      return F.createdQuiz || { id: "quiz-1" };
    },
    updateQuiz: async (id, patch) => { (F.updateCalls = F.updateCalls || []).push({ id, patch }); },
    deleteQuiz: async (id) => {
      (F.deleteCalls = F.deleteCalls || []).push(id);
      if (Array.isArray(F.quizzes)) F.quizzes = F.quizzes.filter((q) => q.id !== id);
    },
    replaceQuestions: async (id, qs) => { (F.replaceCalls = F.replaceCalls || []).push({ id, questions: qs }); },
    createRoom: async (quizId, allowLate) => {
      (F.createRoomCalls = F.createRoomCalls || []).push({ quizId, allowLate });
      return { room_id: F.room, pin: F.pin };
    },

    hostSnapshot: async () => {
      const s = (F.current || snapshots[0]);
      i++;
      return JSON.parse(JSON.stringify(s));
    },
    nextQuestion: async () => { F.nextCalls = (F.nextCalls || 0) + 1; return F.nextResult || { finished: false }; },
    setStatus: async (room, st) => {
      (F.statusCalls = F.statusCalls || []).push(st);
      return F.statusResult || { ok: true, status: st };
    },
    hostStats: async () => F.stats || { answered: 2, correct: 1, distribution: { "1": 1, "2": 1 } },
    restartRoom: async (room) => {
      (F.restartCalls = F.restartCalls || []).push(room);
      if (F.restartResult) {
        if (F.restartResult.error) { const e = new Error("เริ่มรอบใหม่ไม่สำเร็จ"); e.code = F.restartResult.error; throw e; }
        return F.restartResult;
      }
      return { ok: true, status: "lobby", players: 4, answers_cleared: 5 };
    },
    setShowOptions: async (room, mode) => { (F.showModeCalls = F.showModeCalls || []).push({ room, mode }); return { ok: true }; },
    setAllowLate: async (room, allow) => { (F.lateCalls = F.lateCalls || []).push({ room, allow }); },
    closeRoom: async (room) => { (F.closeRoomCalls = F.closeRoomCalls || []).push(room); return { ok: true, status: "ended" }; },
    deleteRoom: async (room) => { (F.deleteRoomCalls = F.deleteRoomCalls || []).push(room); return { ok: true, deleted: true }; },
    myRooms: async () => F.myRooms || F.rooms || [],
    joinRoom: async (pin, nick, av) => {
      if (F.joinResult && F.joinResult.error) {
        const M = { nickname_taken: "ชื่อนี้มีคนใช้แล้ว ลองเติมชื่ออื่น", nickname_required: "กรุณาใส่ชื่อของคุณ",
          game_started: "เกมเริ่มแล้ว รอรอบถัดไปนะ", room_not_found: "ไม่พบห้องนี้ — ตรวจสอบ PIN อีกครั้ง",
          already_answered: "คุณตอบข้อนี้ไปแล้ว", time_up: "หมดเวลาข้อนี้แล้ว", not_open: "ข้อนี้ปิดรับคำตอบแล้ว" };
        const e = new Error(M[F.joinResult.error] || F.joinResult.error); e.code = F.joinResult.error; throw e;
      }
      return F.joinResult || ({ player_id: "me", token: "tok-1", nickname: nick, avatar: av, rejoined: false, state: F.resumeState });
    },
    setAvatar: async () => ({ ok: true }),
    resume: async (t) => {
      if (F.resumeResult && F.resumeResult.error) { const e = new Error(F.resumeResult.error); e.code = F.resumeResult.error; throw e; }
      const rs = typeof F.resumeResult === "function" ? F.resumeResult() : F.resumeResult;
      return rs || ({ player: F.me, answered_current: F.answered, state: F.resumeState });
    },
    roomState: async () => F.resumeState,
    submitAnswer: async (t, q, c) => {
      if (F.answerResult && F.answerResult.error) { const e = new Error(F.answerResult.error); e.code = F.answerResult.error; throw e; }
      return F.answerResult || ({ is_correct: true, points: 1000, streak: 1, score: 1000, rank: 1 });
    },
    leaderboard: async () => ({ total: 3, players: [
      { rank: 1, nickname: "Anna", score: 1000 },
      { rank: 2, nickname: "บอย", score: 0 },
      { rank: 3, nickname: "Chef", score: 0 }] }),
    subscribeRoom: () => ({ send() { }, close() { } })
  };
})();
`;

/* แทนที่สคริปต์ที่ต้องใช้เน็ต ด้วยไฟล์ว่าง/API ปลอม */
const resources = {
  interceptors: [
    requestInterceptor((request) => {
      const u = request.url;
      const js = (body) => new Response(body, { headers: { "Content-Type": "application/javascript" } });
      if (u.includes("vendor/supabase")) return js("");
      // โหมดทดสอบตัวแปลง error (__USE_REAL_API__): ปล่อยให้โหลด api.js จริงจากดิสก์ด้านล่าง
      if (u.endsWith("assets/js/api.js") && !globalThis.__USE_REAL_API__) return js(API_STUB);
      // เสิร์ฟไฟล์จริงจากโฟลเดอร์ docs/ เอง (ไม่ต้องพึ่ง static server)
      // เดิมพึ่ง http://localhost:8123 ซึ่งไม่มีใน CI → เทสต์เงียบ ๆ ไม่ได้รันอะไรเลย
      const m = /^https?:\/\/[^/]+\/([^?#]*)/.exec(u);
      if (m) {
        const rel = decodeURIComponent(m[1]);
        const abs = path.resolve(ROOT, rel);
        if (abs.startsWith(ROOT) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const ext = path.extname(abs).toLowerCase();
          const type = ext === ".js" ? "application/javascript"
            : ext === ".css" ? "text/css"
              : ext === ".html" ? "text/html"
                : ext === ".json" ? "application/json"
                  : ext === ".svg" ? "image/svg+xml"
                    : "application/octet-stream";
          return new Response(fs.readFileSync(abs), { headers: { "Content-Type": type } });
        }
      }
      return undefined;
    })
  ]
};

const consoleErrors = [];
function load(file, query, fix) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (/Not implemented: navigation|getContext|Not implemented: HTMLCanvasElement/.test(e.message)) return;
    consoleErrors.push(file + ": " + e.message);
  });
  vc.on("error", (...a) => consoleErrors.push(file + ": console.error " + a.join(" ")));
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const dom = new JSDOM(html, {
    url: BASE + file + (query || ""),
    runScripts: "dangerously",
    resources,
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.__FIX = fix;
      // ให้หน้าทดสอบแทน AudioContext ได้ (jsdom ไม่มี Web Audio)
      if (fix && typeof fix.__audioCtx === "function") {
        // ต้องเป็นฟังก์ชันปกติ (ไม่ใช่ arrow) เพราะโค้ดเรียกด้วย `new AC()`
        const mk = function () { return fix.__audioCtx(); };
        w.AudioContext = mk;
        w.webkitAudioContext = mk;
      }
      if (fix && fix.preStore) { try { w.localStorage.setItem(fix.preStore[0], fix.preStore[1]); } catch (e) { } }
    }
  });
  return dom;
}

/* ================================================================== */
console.log("\n=== host.html: เปิดห้อง → ถาม → เฉลย → กระดาน → จบเกม ===\n");
const hostFix = {
  pin: PIN, room: ROOM,
  current: state("lobby"),
  statusCalls: [],               // เก็บว่า UI เรียก setStatus อะไรบ้าง
  nextCalls: 0,
  restartCalls: [],              // เก็บว่า UI เรียกรีสตาร์ทห้องอะไรบ้าง
  snapshots: [
    state("lobby"),
    state("lobby", { player_count: 4, players: players.concat([{ id: "p4", nickname: "ผู้เล่นใหม่", score: 0, streak: 0, correct_count: 0, avatar: { c: "owl", h: "cap", s: 3, t: 5 }, joined_at: NOW }]), recent_players: players.concat([{ id: "p4", nickname: "ผู้เล่นใหม่", avatar: { c: "owl", h: "cap", s: 3, t: 5 }, joined_at: NOW }]) }),
    state("question"),
    state("reveal", { show_options: "shape", question: Object.assign({}, state("question").question, { show_options: "shape" }) }),
    state("leaderboard"),
    state("leaderboard", { current_index: 4, question: Object.assign({}, state("question").question, { index: 4 }) }),
    state("ended")
  ],
  stats: { answered: 2, correct: 1, distribution: { "1": 1, "2": 1 } }
};
const host = load("host.html", "?room=" + ROOM, hostFix);
await wait(900);
const setStage = (snap) => { hostFix.current = snap; hw.__hostTest.setSnap(snap); };
const hw = host.window;
const hd = hw.document;
const on = (id) => hd.getElementById(id).classList.contains("on");

check("host: เปิดหน้าได้ (ไม่ได้เด้งออก)", !!hd.querySelector("#s-lobby"));
check("host: ล็อบบี้แสดง PIN ใต้ QR (แสดงจุดเดียว)", hd.getElementById("qr-pin").textContent === PIN, hd.getElementById("qr-pin").textContent);
check("host: ไม่มี PIN ซ้ำอีกจุดในล็อบบี้", !hd.getElementById("pin-big"),
  hd.getElementById("pin-big") ? hd.getElementById("pin-big").textContent : "ไม่มี (ถูกต้อง)");
check("host: มี QR ให้สแกน", !!hd.querySelector("#qr svg"));
check("host: ล็อบบี้แบ่ง 2 ฝั่ง — ผู้เข้าร่วมซ้าย / ข้อมูลเข้าห้อง+ตั้งค่าขวา", (() => {
  const hero = hd.querySelector("#s-lobby .lobby-hero");
  if (!hero) return false;
  const panel = hero.querySelector(":scope > .players-panel");
  const side = hero.querySelector(":scope > .lobby-side");
  return !!panel && !!side && !!(panel.compareDocumentPosition(side) & hw.Node.DOCUMENT_POSITION_FOLLOWING) &&
    !!side.querySelector("#qr") && !!side.querySelector("#qr-pin") && !!side.querySelector("#joinurl") &&
    !!side.querySelector("#btn-start") && !!side.querySelector("#seg-auto") && !!side.querySelector("#chk-late");
})(), "โครงสร้าง .players-panel + .lobby-side");
check("host: คำว่า “ค้นหาชื่อและตัวละคร…” อยู่ในแผงผู้เข้าร่วม อ่านชัด", (() => {
  const sub = hd.querySelector(".players-panel .players-sub");
  return !!sub && sub.textContent.includes("ค้นหาชื่อและตัวละครของคุณบนจอนี้");
})());
check("host: ชิป PIN บนแถบบนซ่อนในห้องรอ (PIN แสดงจุดเดียวใต้ QR)",
  hd.getElementById("top-pin").classList.contains("hidden"));
check("host: ปุ่มมุมขวาบนบอก “ออกจากระบบ” (ไม่ใช่แค่ “ออก”)",
  hd.getElementById("btn-logout").textContent.trim() === "ออกจากระบบ", hd.getElementById("btn-logout").textContent.trim());
check("host: แสดงจำนวนผู้เล่น 3 คน", hd.getElementById("lobby-count").textContent.includes("3"), hd.getElementById("lobby-count").textContent);
check("host: รายชื่ออยู่ใน panel ที่เน้นพื้นที่ค้นหาผู้เล่น", (() => {
  const panel = hd.querySelector(".players-panel");
  return !!panel && panel.contains(hd.getElementById("players")) && panel.querySelector("#players-heading").textContent.includes("ผู้เข้าร่วม");
})());
check("host: การ์ดผู้เล่น 3 คนมี avatar และเป็น list item", hd.querySelectorAll("#players .player-chip[role=listitem] .av svg").length === 3);
check("host: รายชื่อจำนวนน้อยใช้การ์ดขนาดใหญ่", hd.getElementById("players").classList.contains("size-xl"));
check("host: ปุ่มเริ่มเกมพร้อมกด (มีผู้เล่นแล้ว)", hd.getElementById("btn-start").disabled === false);
check("host: โหมดแสดงตัวเลือกเริ่มต้น = ข้อความ", hd.querySelector('#seg-show button[data-mode="text"]').classList.contains("on"));

/* ผู้เล่นใหม่เข้าห้อง → เอฟเฟคชื่อเด้ง */
const withNewbie = state("lobby", {
  max_players: 8,
  player_count: 4,
  players: players.concat([{ id: "p4", nickname: "ผู้เล่นใหม่", score: 0, streak: 0, correct_count: 0, avatar: { c: "owl", h: "cap", s: 3, t: 5 }, joined_at: NOW }]),
  recent_players: players.concat([{ id: "p4", nickname: "ผู้เล่นใหม่", avatar: { c: "owl", h: "cap", s: 3, t: 5 }, joined_at: NOW }])
});
setStage(withNewbie);
await wait(500);
check("host: แสดงจำนวนผู้เล่นเทียบกับเพดาน", hd.getElementById("lobby-count").textContent.includes("4 / 8"));
check("host: มีป้ายชื่อ “ผู้เล่นใหม่” เด้งขึ้นจอ", !!Array.from(hd.querySelectorAll(".join-toast")).find((e) => e.textContent.includes("ผู้เล่นใหม่")),
  Array.from(hd.querySelectorAll(".join-toast")).map((e) => e.textContent.trim()).join(" | "));

/* ข้อคำถาม */
setStage(state("question", { max_players: 8, question: Object.assign({}, state("question").question, { background: "ocean" }) }));
await wait(120);
check("host: เข้าสู่จอคำถาม", on("s-question"));
check("host: ใช้พื้นหลังตามคำถาม", hd.getElementById("s-question").classList.contains("qbg-ocean"));
check("host: ระหว่างเกมชิป PIN กลับมาแสดงบนแถบบน", !hd.getElementById("top-pin").classList.contains("hidden"));
check("host: แสดงโจทย์", hd.getElementById("h-prompt").textContent.includes("เมืองหลวง"));
check("host: แสดงตัวเลือก 4 ข้อ", hd.querySelectorAll("#h-answers .host-ans").length === 4);
check("host: แสดงเลขข้อ 1/5", hd.getElementById("q-idx").textContent.includes("1 / 5"), hd.getElementById("q-idx").textContent);
setStage(state("question", { answered: 2, correct: 1 }));
await wait(120);
check("host: ตัวเลขผู้ตอบอัปเดตจาก host_question_stats", /2\s*\/\s*3/.test(hd.getElementById("answered-n").textContent.replace(/\s+/g, " ")),
  hd.getElementById("answered-n").textContent);
check("host: แถบความคืบหน้าผู้ตอบขยับ", parseFloat(hd.getElementById("answered-bar").style.width) > 0, hd.getElementById("answered-bar").style.width);
check("host: นาฬิกานับถอยหลังเดิน", Number(hd.getElementById("host-timer").textContent) > 0, hd.getElementById("host-timer").textContent);

/* เฉลย + โหมดสัญลักษณ์ */
setStage(state("reveal", { show_options: "shape", question: Object.assign({}, state("question").question, { show_options: "shape" }) }));
await wait(120);
check("host: เข้าจอเฉลย", on("s-reveal"));
check("host: ทำเครื่องหมายข้อถูก", hd.querySelectorAll("#r-answers .host-ans.is-correct").length === 1);
check("host: แสดงแท่งสถิติการตอบ", hd.querySelectorAll("#r-bars .bar-row").length === 4);
check("host: มีคำอธิบายโหมดสัญลักษณ์ตอนเฉลย", !hd.getElementById("r-mode-note").classList.contains("hidden"));

/* กระดานคะแนน */
setStage(state("leaderboard"));
await wait(120);
check("host: เข้าจอกระดานคะแนน", on("s-lb"));
check("host: กระดานมี 3 แถว", hd.querySelectorAll("#h-lb .res-row").length === 3);
check("host: ปุ่มถัดไปเป็น “ข้อต่อไป” เมื่อยังไม่ข้อสุดท้าย", hd.getElementById("btn-next2").textContent.includes("ข้อต่อไป"), hd.getElementById("btn-next2").textContent);
setStage(state("leaderboard", { current_index: 4, question: Object.assign({}, state("question").question, { index: 4 }) }));
await wait(120);
check("host: ข้อสุดท้าย → ปุ่มเปลี่ยนเป็น “จบเกม”", hd.getElementById("btn-next2").textContent.includes("จบเกม"), hd.getElementById("btn-next2").textContent);

/* จบเกม + บัลลังก์ */
setStage(state("ended"));
await wait(400);
check("host: เข้าจอจบเกม", on("s-ended"));
const podHtml = hd.getElementById("end-podium").innerHTML;
check("host: บัลลังก์ผู้ชนะแสดง", podHtml.includes("throne-svg"));
check("host: มงกุฎอยู่บนแท่นที่ 1", podHtml.includes("crown-svg") && podHtml.includes("pod-1"));
check("host: ตัวละคร 3 ตัวบนแท่น", (podHtml.match(/avatar-svg/g) || []).length === 3, String((podHtml.match(/avatar-svg/g) || []).length));
check("host: ชื่อแชมป์แสดงบนแท่น", podHtml.includes("Anna"));
check("host: กระดานสุดท้ายฝั่งขวาแสดง 3 คน", hd.querySelectorAll("#end-lb .res-row").length === 3);
check("host: มีปุ่ม “เปิดห้องใหม่”", !!hd.getElementById("btn-again"));

/* รอบปรับปรุง: สองคอลัมน์ / เพลงตามข้อ / เล่นอัตโนมัติ / QR ขยาย */
check("host: ตารางสรุปจัดเป็นคอลัมน์ (end-cols)", hd.getElementById("end-lb").classList.contains("end-cols"));
check("host: บัลลังก์เปิดตัวทีละอันดับ (แชมป์ยังไม่โผล่ทันที)", !hd.querySelector("#end-podium .pod-1.show"));
hw.Snd.set("gameTracks", ["q1", "q2", "q3"]); // reset draw bag for an isolated assertion
const questionTracks = [0, 1, 2, 3, 4].map((i) => hw.Snd.questionTrack(i));
check("sound: สุ่มเพลงเกมครบทั้ง 3 ก่อนวน และไม่ซ้ำติดกัน",
  new Set(questionTracks.slice(0, 3)).size === 3 && questionTracks.every((track, i) =>
    ["q1", "q2", "q3"].includes(track) && (i === 0 || track !== questionTracks[i - 1])),
  questionTracks.join(","));
check("sound: ปุ่มเสียงและเพลงอยู่แถบบน ข้างปุ่มออก",
  !!hd.querySelector(".topbar .snd-fab .snd-btn") && hd.querySelector(".topbar .snd-fab").nextElementSibling === hd.getElementById("btn-logout"));
check("host: มีตัวเลือกโหมดเล่นอัตโนมัติ", hd.querySelectorAll("#seg-auto button").length === 2 && typeof hw.__hostTest.setAuto === "function");
check("host: QR overlay เป็น fixed element นอกเวที ไม่ถูก layout บัง", (() => {
  const modal = hd.getElementById("qr-modal");
  const css = hw.getComputedStyle(modal);
  return modal.parentElement === hd.body && css.position === "fixed" && css.zIndex === "1000";
})());
hd.getElementById("qr").click();
await wait(40);
check("host: กด QR แล้ว modal ขยายจริง พร้อม PIN/URL และโฟกัสปุ่มปิด", (() => {
  const modal = hd.getElementById("qr-modal");
  return !modal.classList.contains("hidden") && modal.getAttribute("aria-hidden") === "false" &&
    hd.body.classList.contains("qr-open") && hd.getElementById("qr").getAttribute("aria-expanded") === "true" &&
    hd.getElementById("qr-modal-code").querySelector("svg") &&
    hd.getElementById("qr-modal-pin").textContent === PIN &&
    hd.activeElement === hd.getElementById("qr-modal-close");
})());
hd.dispatchEvent(new hw.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("host: ปิด QR ด้วย Escape และคืน aria/scroll state", hd.getElementById("qr-modal").classList.contains("hidden") &&
  hd.getElementById("qr-modal").getAttribute("aria-hidden") === "true" && !hd.body.classList.contains("qr-open") &&
  hd.getElementById("qr").getAttribute("aria-expanded") === "false");
hd.getElementById("qr").click();
hd.getElementById("qr-modal").dispatchEvent(new hw.MouseEvent("click", { bubbles: true }));
check("host: แตะพื้นหลัง modal เพื่อปิดได้", hd.getElementById("qr-modal").classList.contains("hidden"));
hd.getElementById("qr").click();
hd.getElementById("qr-modal-close").click();
check("host: ปุ่มปิด QR ทำงานและ PIN หลักยังตรงกัน", hd.getElementById("qr-modal").classList.contains("hidden") &&
  hd.getElementById("qr-pin").textContent === PIN);
{
  /* โหมดอัตโนมัติ: จอเฉลย → เรียก setStatus("leaderboard") เองเมื่อครบเวลา */
  hw.__hostTest.setAuto(true);
  hd.getElementById("sel-reveal-sec").value = "3";
  hd.getElementById("sel-reveal-sec").dispatchEvent(new hw.Event("change"));
  const before = hostFix.statusCalls.length;
  setStage(state("reveal"));
  await wait(2400);
  check("auto: แสดงแถบนับถอยหลัง", !hd.getElementById("auto-bar").classList.contains("hidden"));
  await wait(1500);
  check("auto: ครบเวลาแล้วไปกระดานคะแนนเอง", hostFix.statusCalls.length > before, JSON.stringify(hostFix.statusCalls.slice(before)));
  hw.__hostTest.setAuto(false);
  setStage(state("ended"));
  await wait(200);
}

/* ปุ่มในจอจบเกม */
const roomsBeforeAgain = (hostFix.createRoomCalls || []).length;
hd.getElementById("btn-again").click();
await wait(150);
check("host: ปุ่ม “เล่นชุดนี้อีกครั้ง” เรียกสร้างห้องจากชุดคำถามปัจจุบัน",
  (hostFix.createRoomCalls || []).length === roomsBeforeAgain + 1 &&
  hostFix.createRoomCalls.at(-1).quizId === "quiz-1" && hostFix.createRoomCalls.at(-1).allowLate === false,
  JSON.stringify(hostFix.createRoomCalls || []));

/* กด “จบเกม” ในจอกระดานคะแนน → ต้องเรียก setStatus('ended') */
setStage(state("leaderboard"));
await wait(150);
hd.getElementById("btn-finish").click();
await wait(250);
check("host: กด “จบเกม” ส่งสถานะ ended ไปเซิร์ฟเวอร์",
  (hostFix.statusCalls || []).includes("ended"),
  JSON.stringify(hostFix.statusCalls || []));

/* กด “กระดานคะแนน” → ต้องส่ง leaderboard */
setStage(state("reveal"));
await wait(150);
hd.getElementById("btn-lb").click();
await wait(250);
check("host: กด “กระดานคะแนน” ส่งสถานะ leaderboard",
  (hostFix.statusCalls || []).includes("leaderboard"),
  JSON.stringify(hostFix.statusCalls || []));

/* กด “เฉลยเลย” → ต้องส่ง reveal และต้องไม่ยิงซ้ำรัว ๆ */
setStage(state("question"));
await wait(150);
const revBefore = (hostFix.statusCalls || []).filter((x) => x === "reveal").length;
// ยิงติดกันแบบไม่รอ (ผู้ใช้ดับเบิลคลิก) — ต้องได้แค่คำขอเดียว
const revBtn = hd.getElementById("btn-reveal");
revBtn.click(); revBtn.click(); revBtn.click();
await wait(300);
const revAfter = (hostFix.statusCalls || []).filter((x) => x === "reveal").length;
check("host: กด “เฉลยเลย” ซ้ำรัว ๆ ไม่ยิงเซิร์ฟเวอร์เกิน 1 ครั้ง", revAfter - revBefore <= 1,
  "ยิง " + (revAfter - revBefore) + " ครั้ง");

/* แป้นพิมพ์ลัด: เว้นวรรค = ไปต่อ */
setStage(state("reveal"));
await wait(150);
const nextBefore = hostFix.nextCalls || 0;
hd.dispatchEvent(new hw.KeyboardEvent("keydown", { key: " ", bubbles: true }));
await wait(250);
check("host: กด Space ที่จอเฉลย = ไปข้อต่อไป", (hostFix.nextCalls || 0) > nextBefore,
  "nextCalls " + nextBefore + " → " + (hostFix.nextCalls || 0));

/* ================================================================== */
console.log("\n=== play.html: เข้าห้อง → ตอบ → เฉลย → จบเกม ===\n");
const me = { id: "me", nickname: "Anna", score: 1000, streak: 1, correct_count: 1, rank: 1, avatar: { c: "cat", h: "crown", s: 2, t: 0 } };
const playFix = {
  pin: PIN, room: ROOM,
  me,
  answered: false,
  resumeState: state("lobby", { max_players: 8 }),
  answerResult: { is_correct: true, points: 1000, streak: 1, score: 1000, rank: 1 },
  joinResult: { player_id: "me", token: "tok-1", nickname: "Anna", avatar: me.avatar, rejoined: false, state: state("lobby", { max_players: 8 }) }
};
const play = load("play.html", "?pin=" + PIN, playFix);
await wait(700);
const pw = play.window;
const pd = pw.document;
const pon = (id) => pd.getElementById(id).classList.contains("on");

check("play: เปิดหน้าผู้เล่นได้", !!pd.querySelector(".screen"));
pd.getElementById("nick").value = "Anna";
pd.getElementById("btn-join").click();
await wait(500);
check("play: เข้าห้องแล้วเห็นจอล็อบบี้", pon("s-lobby"), pd.querySelector(".screen.on") && pd.querySelector(".screen.on").id);
check("play: แสดงจำนวนคนในห้อง", pd.getElementById("lobby-count").textContent.includes("3"), pd.getElementById("lobby-count").textContent);
check("play: แสดงผู้เล่นเทียบกับจำนวนสูงสุด", pd.getElementById("lobby-count").textContent.includes("/ 8"));
/* กติกาคะแนนต้องบอกผู้เล่นก่อนเริ่ม (คะแนนคิดจากความเร็ว ไม่ใช่ถูก/ผิดอย่างเดียว) */
const ruleEl = pd.querySelector(".score-rule");
const ruleTxt = ruleEl ? ruleEl.textContent.replace(/\s+/g, " ") : "";
check("play: จอห้องรออธิบายกติกาคะแนน (ถูก + เร็ว = มากกว่า, โบนัสสตรีค)",
  !!ruleEl && /55/.test(ruleTxt) && /โบนัส/.test(ruleTxt), ruleTxt.slice(0, 90));
check("play: มีปุ่มตกแต่งตัวละครระหว่างรอ", !!pd.getElementById("btn-customize2"));

/* เปลี่ยนสถานะเป็นคำถาม แล้วให้ sync รอบใหม่ */
playFix.resumeState = state("question", { max_players: 8, question: Object.assign({}, state("question").question, { background: "sunset" }) });
playFix.answered = false;
playFix.resumeResult = null;
pw.document.dispatchEvent(new pw.Event("visibilitychange"));
await wait(300);
// sync จะถูกเรียกจาก visibilitychange
check("play: เห็นจอคำถามพร้อมตัวเลือก 4 ข้อ", pd.querySelectorAll("#q-answers .ans").length === 4, String(pd.querySelectorAll("#q-answers .ans").length));
check("play: แสดงโจทย์", pd.getElementById("q-prompt").textContent.includes("เมืองหลวง"));
check("play: ใช้พื้นหลังตามคำถาม", pd.getElementById("s-question").classList.contains("qbg-sunset"));
check("play: มีนาฬิกาในข้อ", Number(pd.getElementById("tnum").textContent) > 0, pd.getElementById("tnum").textContent);

/* กดตอบ */
const ans2 = pd.querySelectorAll("#q-answers .ans")[1];
ans2.click();
await wait(300);
check("play: กดตอบแล้วขึ้นจอ “ตอบแล้ว”", pon("s-answered"), pd.querySelector(".screen.on") && pd.querySelector(".screen.on").id);
check("play: แสดงคะแนนที่ได้", pd.getElementById("ans-points").textContent.includes("1,000"), pd.getElementById("ans-points").textContent);

/* เฉลย: ตอบถูก */
playFix.resumeState = state("reveal");
playFix.resumeResult = null;
pd.dispatchEvent(new pw.Event("visibilitychange"));
await wait(300);
check("play: จอเฉลยบอกว่า “ถูกต้อง!”", pd.getElementById("reveal-title").textContent.includes("ถูกต้อง"), pd.getElementById("reveal-title").textContent);
check("play: เฉลยคำตอบที่ถูก", pd.getElementById("reveal-truth").textContent.includes("กรุงเทพมหานคร"), pd.getElementById("reveal-truth").textContent);

/* หากเครื่องข้ามสถานะ question ไปเลย อย่าเอาคะแนน/ผลตอบของข้อก่อนมาแสดงเป็นข้อใหม่ */
const skippedQuestionId = QID + "-skipped";
playFix.resumeState = state("reveal", {
  current_index: 1,
  question: Object.assign({}, state("question").question, { id: skippedQuestionId, index: 1, prompt: "คำถามที่ข้ามไป" })
});
pd.dispatchEvent(new pw.Event("visibilitychange"));
await wait(300);
check("play: ข้อใหม่ที่ไม่มีคำตอบไม่แสดงผลบวกของข้อก่อน",
  pd.getElementById("reveal-title").textContent === "เฉลย" &&
  pd.getElementById("reveal-score").textContent === "คะแนนรวม 1,000 คะแนน",
  pd.getElementById("reveal-title").textContent + " · " + pd.getElementById("reveal-score").textContent);

/* กระดานคะแนน */
playFix.resumeState = state("leaderboard");
pd.dispatchEvent(new pw.Event("visibilitychange"));
await wait(400);
check("play: เห็นกระดานคะแนน", pon("s-leaderboard"), pd.querySelector(".screen.on") && pd.querySelector(".screen.on").id);
check("play: มีรายชื่อในกระดาน", pd.querySelectorAll("#lb-list .res-row").length === 3);
check("play: ไฮไลต์แถวของตัวเอง", pd.querySelectorAll("#lb-list .res-row.me").length === 1);

/* จบเกม: อันดับ 1 → บัลลังก์ */
playFix.resumeState = state("ended");
pd.dispatchEvent(new pw.Event("visibilitychange"));
await wait(400);
check("play: เห็นจอจบเกม", pon("s-ended"), pd.querySelector(".screen.on") && pd.querySelector(".screen.on").id);
check("play: อันดับ 1 ได้บัลลังก์ย่อ", pd.getElementById("end-podium").innerHTML.includes("throne-svg"));
check("play: แสดงคะแนนรวม", pd.getElementById("end-score").textContent.includes("1,000"), pd.getElementById("end-score").textContent);

/* ผู้เล่นอันดับ 4 → ไม่มีบัลลังก์ แต่เห็นอันดับตัวเอง */
const play2Fix = Object.assign({}, playFix, { me: Object.assign({}, me, { rank: 4 }) });
const play2 = load("play.html", "?pin=" + PIN, play2Fix);
play2.window.localStorage.setItem("onlive.player." + PIN, JSON.stringify({ token: "tok-1", nickname: "Anna", pin: PIN }));
await wait(400);
play2Fix.resumeState = state("ended");
play2.window.document.dispatchEvent(new play2.window.Event("visibilitychange"));
await wait(400);
const p2d = play2.window.document;
check("play: อันดับ 4 ไม่มีบัลลังก์ (แสดงป้ายอันดับ)",
  !p2d.getElementById("end-podium").innerHTML.includes("throne-svg") && p2d.getElementById("end-emoji").style.display !== "none");

/* token หมดอายุ → ต้องพาไปหน้าผิดพลาด ไม่ค้าง */
const play3Fix = Object.assign({}, playFix, { resumeResult: { error: "player_not_found" } });
const play3 = load("play.html", "?pin=" + PIN, play3Fix);
play3.window.localStorage.setItem("onlive.player." + PIN, JSON.stringify({ token: "tok-1", nickname: "Anna", pin: PIN }));
await wait(500);
const p3d = play3.window.document;
check("play: token ใช้ไม่ได้ → แสดงหน้าข้อผิดพลาด", p3d.querySelector("#s-error").classList.contains("on"), p3d.querySelector(".screen.on") && p3d.querySelector(".screen.on").id);
check("play: ข้อความแจ้งผู้เล่นใหม่", p3d.getElementById("err-text").textContent.includes("ไม่พบข้อมูลผู้เล่น"), p3d.getElementById("err-text").textContent);



/* เข้าห้องซ้ำด้วยชื่อเดิม (rejoined) → ต้องใช้ token ที่เซิร์ฟเวอร์คืนมา ไม่ใช่ของเก่า */
const reFix = Object.assign({}, playFix, {
  resumeResult: { player: me, answered_current: false, state: state("lobby") },
  joinResult: { player_id: "me", token: "tok-new", nickname: "Anna", avatar: me.avatar, rejoined: true, state: state("lobby") }
});
const rejoin = load("play.html", "?pin=" + PIN, reFix);
rejoin.window.localStorage.setItem("onlive.player." + PIN, JSON.stringify({ token: "tok-old", nickname: "Anna", pin: PIN }));
await wait(500);
const rd = rejoin.window.document;
rd.getElementById("nick").value = "Anna";
const rejoinBtn = rd.getElementById("btn-join");
if (rejoinBtn && rd.querySelector("#s-join").classList.contains("on")) {
  rejoinBtn.click();
  await wait(400);
}
const stored = JSON.parse(rejoin.window.localStorage.getItem("onlive.player." + PIN) || "{}");
check("play: เข้าห้องซ้ำแล้วได้ token ใหม่ (rejoined)",
  stored.token === "tok-new" || rd.querySelector("#s-lobby").classList.contains("on"),
  "token ที่เก็บ = " + stored.token);

/* ชื่อซ้ำกับคนอื่น → แจ้งเตือนและคืนปุ่มให้กดใหม่ */
const dupFix = Object.assign({}, playFix, { joinResult: { error: "nickname_taken" } });
const dup = load("play.html", "?pin=999999", dupFix);
await wait(500);
const dd = dup.window.document;
const dupScreen = () => dd.querySelector(".screen.on") && dd.querySelector(".screen.on").id;
dd.getElementById("nick").value = "Anna";
dd.getElementById("btn-join").click();
await wait(400);
check("play: ชื่อซ้ำ → แจ้งเตือนไทย + ปุ่มกลับมากดได้",
  !dd.getElementById("btn-join").disabled && /ชื่อนี้มีคนใช้แล้ว/.test(Array.from(dd.querySelectorAll(".toast")).map((t) => t.textContent).join(" ")),
  "จอ=" + dupScreen() + " | toast=" + Array.from(dd.querySelectorAll(".toast")).map((t) => t.textContent).join(" | ") +
  " | btn=" + dd.getElementById("btn-join").textContent + "/disabled=" + dd.getElementById("btn-join").disabled);

/* หมดเวลา → ปุ่มตัวเลือกถูกล็อกและแจ้งเตือน */
const toFix = Object.assign({}, playFix, {
  resumeState: state("question", { question_ends_at: new Date(Date.now() - 500).toISOString() })
});
toFix.preStore = ["onlive.player.888888", JSON.stringify({ token: "tok-1", nickname: "Anna", pin: "888888" })];
toFix.resumeResult = { player: Object.assign({}, me), answered_current: false,
  state: Object.assign({}, toFix.resumeState, { question: Object.assign({}, toFix.resumeState.question),
    server_now: new Date().toISOString(),
    question_ends_at: new Date(Date.now() - 500).toISOString() }) };
const to = load("play.html", "?pin=888888", toFix);
await wait(600);
const td = to.window.document;
check("play: หมดเวลาแล้วปุ่มตัวเลือกถูกล็อก (หลังตัวจับเวลาทำงาน)",
  (await wait(400), Array.from(td.querySelectorAll("#q-answers .ans")).every((b) => b.disabled)),
  "left=" + (toFix.resumeState.question_ends_at) + " offset=" + (new Date(toFix.resumeState.server_now).getTime() - Date.now()) + " tnum=" + td.getElementById("tnum").textContent +
  " จอ=" + (td.querySelector(".screen.on") && td.querySelector(".screen.on").id) +
  " ปุ่ม=" + td.querySelectorAll("#q-answers .ans").length +
  " ล็อก=" + td.querySelectorAll("#q-answers .ans[disabled]").length);

/* ================================================================== */
console.log("\n=== admin.html: สร้างชุด → นำเข้า Excel/CSV → บันทึก ===\n");
const adminFix = { pin: PIN, room: ROOM, snapshots: [state("lobby")], saved: [],
  rooms: [
    { id: ROOM, pin: PIN, status: "question", created_at: NOW, quiz_id: "quiz-1" },
    { id: "room-old", pin: "999111", status: "ended", created_at: NOW, quiz_id: "quiz-1" }
  ] };
adminFix.myRooms = adminFix.rooms;
const admin = load("admin.html", "", adminFix);
await wait(700);
const aw = admin.window;
const ad = aw.document;
const aon = (id) => ad.getElementById(id).classList.contains("on");

check("admin: เปิดหน้าได้ (เห็นรายการชุดคำถาม)", !!ad.querySelector("#s-list") || !!ad.querySelector(".screen.on"));
/* ถ้าผู้ดำเนินรายการปิดแท็บกลางเกม ต้องมีทางกลับเข้าห้องเดิมได้ (API.myRooms เดิมไม่มีหน้าไหนเรียกใช้เลย) */
const liveBox = ad.getElementById("live-rooms");
check("admin: มีแผง “ห้องที่ยังไม่จบ” ให้กลับเข้าห้องเดิมได้", !!liveBox && liveBox.textContent.trim().length > 0,
  liveBox ? liveBox.textContent.trim().slice(0, 80) : "(ไม่มีแท็ก)");
check("admin: แผงห้องที่ยังไม่จบ แสดงเฉพาะห้องที่ยังเล่นอยู่ (ไม่รวมห้องที่จบแล้ว)",
  !!liveBox && liveBox.textContent.includes(PIN) && !liveBox.textContent.includes("999111"),
  liveBox ? liveBox.textContent.replace(/\s+/g, " ").slice(0, 90) : "");
const resumeLink = liveBox && liveBox.querySelector('a[href*="host.html?room="]');
check("admin: ปุ่มกลับเข้าห้องเดิมชี้ไปที่ host.html?room=<id>",
  !!resumeLink && resumeLink.getAttribute("href") === "host.html?room=" + ROOM,
  resumeLink ? resumeLink.getAttribute("href") : "(ไม่มีลิงก์)");

/* ---- จัดการห้อง: ปิด / ลบ / ตั้งค่า จากหน้าห้องทำงาน ---- */
check("admin: แผงห้องที่เปิดอยู่มีปุ่มจัดการครบ (เข้าห้อง/ปิด/ลบ/ตั้งค่า)",
  !!liveBox.querySelector("[data-room-close]") && !!liveBox.querySelector("[data-room-delete]") &&
  !!liveBox.querySelector("[data-room-late]") && !!liveBox.querySelector('a[href*="host.html?room="]'),
  liveBox.textContent.replace(/\s+/g, " ").slice(0, 120));
check("admin: แผงห้องแสดงชื่อชุดคำถาม", /E2E ชุดทดสอบระบบ/.test(liveBox.textContent), liveBox.textContent.slice(0, 90));
aw.confirm = () => true;
liveBox.querySelector("[data-room-close]").click();
await wait(250);
check("admin: กด “ปิดห้อง” แล้วเรียก API.closeRoom ของห้องนั้น",
  (adminFix.closeRoomCalls || []).includes(ROOM), JSON.stringify(adminFix.closeRoomCalls || []));
const delRoomBtn = ad.querySelector("#live-rooms [data-room-delete]");
check("admin: หลังปิดห้องยังมีปุ่มลบห้องให้จัดการต่อ", !!delRoomBtn);
if (delRoomBtn) delRoomBtn.click();
await wait(250);
check("admin: กด “ลบห้อง” แล้วเรียก API.deleteRoom ของห้องนั้น",
  (adminFix.deleteRoomCalls || []).includes(ROOM), JSON.stringify(adminFix.deleteRoomCalls || []));
const lateChk = ad.querySelector("#live-rooms [data-room-late]");
check("admin: มีสวิตช์อนุญาตเข้าห้องกลางเกมต่อห้อง", !!lateChk);
if (lateChk) {
  lateChk.checked = true;
  lateChk.dispatchEvent(new aw.Event("change"));
  await wait(120);
}
check("admin: เปลี่ยนการเข้าห้องกลางเกมแล้วเรียก API.setAllowLate",
  (adminFix.lateCalls || []).some((c) => c.room === ROOM && c.allow === true), JSON.stringify(adminFix.lateCalls || []));
check("admin: ปุ่มรีเฟรชรายการห้องมีอยู่", !!ad.getElementById("btn-refresh-rooms"));
const showSel = ad.querySelector("#live-rooms [data-room-show]");
check("admin: แก้ไขโหมดแสดงตัวเลือกของห้องได้จากหน้าห้องทำงาน", !!showSel);
if (showSel) {
  showSel.value = "shape";
  showSel.dispatchEvent(new aw.Event("change"));
  await wait(120);
}
check("admin: เปลี่ยนโหมดตัวเลือกแล้วเรียก API.setShowOptions",
  (adminFix.showModeCalls || []).some((c) => c.room === ROOM && c.mode === "shape"), JSON.stringify(adminFix.showModeCalls || []));
const activeQuizCard = ad.querySelector("#quiz-list .quiz-card");
check("admin: แต่ละชุดมีปุ่มแก้ไขและลบที่มองเห็นได้", !!activeQuizCard &&
  !!activeQuizCard.querySelector("[data-edit]") && !!activeQuizCard.querySelector("[data-delete]"));
check("admin: ล็อกการแก้ไขระหว่างเกม แต่ยังแสดงปุ่มลบพร้อมการยืนยัน", !!activeQuizCard &&
  activeQuizCard.querySelector("[data-edit]").disabled && !activeQuizCard.querySelector("[data-delete]").disabled);
check("admin: ปุ่ม “สร้างชุดใหม่” ใช้งานได้", !!ad.getElementById("btn-new"));
ad.getElementById("btn-new").click();
await wait(300);
check("admin: กดสร้างชุดใหม่แล้วเข้าหน้าแก้ไข", aon("s-editor"), ad.querySelector(".screen.on") && ad.querySelector(".screen.on").id);
check("admin: มีช่องกรอกชื่อชุดคำถาม", !!ad.getElementById("quiz-title"));
check("admin: ชุดใหม่มีข้อเปล่าให้กรอก 1 ข้อ", ad.querySelectorAll("#q-list .q-item").length === 1,
  String(ad.querySelectorAll("#q-list .q-item").length));
ad.getElementById("btn-add-q").click();
await wait(150);
check("admin: กดเพิ่มข้อแล้วมี 2 ข้อ", ad.querySelectorAll("#q-list .q-item").length === 2,
  String(ad.querySelectorAll("#q-list .q-item").length));
ad.querySelectorAll('#q-list .q-item [data-prompt]')[1].value = "";
const delBtn = ad.querySelectorAll('#q-list .q-item [data-act="del"]')[1];
aw.confirm = () => true;
if (delBtn) delBtn.click();
await wait(150);
check("admin: ลบข้อได้", ad.querySelectorAll("#q-list .q-item").length === 1,
  String(ad.querySelectorAll("#q-list .q-item").length));

/* เติมข้อความในข้อแรก */
const ta = ad.querySelector('#q-list .q-item [data-prompt]');
ta.value = "ข้อใดคือเมืองหลวงของประเทศไทย";
ta.dispatchEvent(new aw.Event("input"));
const opts = Array.from(ad.querySelectorAll('#q-list .q-item [data-opt]'));
["เชียงใหม่", "กรุงเทพมหานคร", "ขอนแก่น", "ภูเก็ต"].forEach((v, i) => {
  if (!opts[i]) return;
  opts[i].value = v;
  opts[i].dispatchEvent(new aw.Event("input"));
});
const radios = ad.querySelectorAll('#q-list .q-item input[type="radio"]');
if (radios[1]) { radios[1].checked = true; radios[1].dispatchEvent(new aw.Event("change")); }
ad.getElementById("quiz-title").value = "ชุดจากหน้าเว็บ";

/* นำเข้าจาก CSV ที่มีหัวตารางภาษาไทย (กดปุ่มจริงบนหน้า) */
ad.getElementById("btn-import-open").click();
await wait(200);
check("admin: เข้าหน้านำเข้าได้", aon("s-import"), ad.querySelector(".screen.on") && ad.querySelector(".screen.on").id);
const csv = [
  "คำถาม,ตัวเลือก1,ตัวเลือก2,ตัวเลือก3,เฉลย,เวลา,คะแนน",
  "การกระทำใดถือเป็นการทุจริต,รับของขวัญตามประเพณี,เรียกผลประโยชน์แลกอนุมัติ,ทำงานล่วงเวลา,2,20,1000",
  "หน่วยงานใดดูแลการป้องกันการทุจริต,ป.ป.ช.,ก.พ.,สตง.,1,25,1500"
].join("\n");
ad.getElementById("import-text").value = csv;
ad.getElementById("btn-import-run").click();
await wait(200);
const previewText = ad.getElementById("import-result").textContent;
check("admin: อ่าน CSV หัวตารางไทยได้ 2 ข้อ", /อ่านได้\s*2\s*ข้อ/.test(previewText.replace(/\s+/g, " ")), previewText.slice(0, 80));
check("admin: แสดงตัวอย่างก่อนยืนยัน", /การกระทำใดถือเป็นการทุจริต/.test(previewText));
check("admin: มีปุ่มยืนยันการนำเข้า", !!ad.getElementById("btn-import-confirm"));

/* CSV เสีย → ต้องแจ้งเตือน ไม่ใช่พัง */
ad.getElementById("import-text").value = "คำถาม,ตัวเลือก1,ตัวเลือก2\nมีโจทย์แต่ตัวเลือกเดียว,x,";
ad.getElementById("btn-import-run").click();
await wait(150);
check("admin: CSV ที่ไม่สมบูรณ์แจ้งข้อผิดพลาด (ไม่ crash)",
  /ไม่พบ|ต้องมี|ผิดพลาด/.test(ad.getElementById("import-result").textContent), ad.getElementById("import-result").textContent.slice(0, 90));

check("admin: มีปุ่มดาวน์โหลดเทมเพลท Excel", !!ad.getElementById("btn-template-xlsx"));
check("admin: อ่านเทมเพลท .xlsx จริงได้ 5 ข้อ", (() => {
  const buf = fs.readFileSync(path.join(ROOT, "samples/quiz-template.xlsx"));
  const wb = aw.XLSX.read(buf, { type: "buffer" });
  const rows = aw.XLSX.utils.sheet_to_json(wb.Sheets["คำถาม"], { header: 1, raw: false, defval: "" });
  return aw.QuizImport.parseTable(rows).length === 5;
})());
check("admin: Excel อ่านคอลัมน์ show_options ได้", (() => {
  const t = aw.QuizImport.parseTable([
    ["question", "option1", "option2", "show_options", "correct"],
    ["ทดสอบ", "ก", "ข", "shape", "1"]
  ]);
  return t.length === 1 && t[0].show_options === "shape";
})());

/* ---- แก้ไข/ลบชุดคำถามที่มีห้องเชื่อมอยู่ ---- */
console.log("\n=== admin.html: แก้ไข/ลบชุดหลังสร้างห้อง ===\n");
const crudFix = {
  quizzes: [{ id: "quiz-edit", title: "ชุดที่แก้ไข", description: "ก่อนแก้", emoji: "🧠", question_count: 1 }],
  quiz: { quiz: { id: "quiz-edit", title: "ชุดที่แก้ไข", description: "ก่อนแก้", emoji: "🧠" }, questions: [
    { prompt: "โจทย์เดิม", options: ["ก", "ข"], correct_index: 1, time_limit: 20, points: 1000 }
  ] },
  myRooms: [{ id: "room-edit", pin: "882211", status: "lobby", current_index: -1, quiz_id: "quiz-edit" }]
};
const crud = load("admin.html", "", crudFix);
await wait(700);
const cw = crud.window;
const cd = cw.document;
const editCard = cd.querySelector("#quiz-list .quiz-card");
check("admin CRUD: ห้องรออยู่แล้ว ยังเปิดแก้ไขได้อย่างปลอดภัย", !!editCard &&
  !!editCard.querySelector("[data-edit]") && !editCard.querySelector("[data-edit]").disabled);
editCard.querySelector("[data-edit]").click();
await wait(150);
check("admin CRUD: เลือกแก้ไขจากรายการแล้วโหลดชุด/คำถามเดิม", cd.querySelector("#s-editor").classList.contains("on") &&
  cd.getElementById("quiz-title").value === "ชุดที่แก้ไข" && cd.querySelectorAll("#q-list .q-item").length === 1);
cd.getElementById("quiz-title").value = "ชุดแก้ไขแล้ว";
const promptField = cd.querySelector("#q-list [data-prompt]");
promptField.value = "โจทย์ที่แก้แล้ว";
promptField.dispatchEvent(new cw.Event("input", { bubbles: true }));
crudFix.myRooms = [{ id: "room-edit", pin: "882211", status: "question", current_index: 0, quiz_id: "quiz-edit" }];
cd.getElementById("btn-save").click();
await wait(120);
check("admin CRUD: กันบันทึกแก้คำถามระหว่างเกม เพื่อไม่ให้คำตอบ/คำถามในห้องเสีย", !crudFix.updateCalls && !crudFix.replaceCalls &&
  Array.from(cd.querySelectorAll(".toast")).some((t) => /จบเกมก่อน/.test(t.textContent)));
crudFix.myRooms = [{ id: "room-edit", pin: "882211", status: "ended", current_index: 0, quiz_id: "quiz-edit" }];
cd.getElementById("btn-save").click();
await wait(150);
check("admin CRUD: จบห้องแล้ว บันทึกชื่อและคำถามที่แก้ได้", !!crudFix.updateCalls && crudFix.updateCalls.length === 1 &&
  crudFix.updateCalls[0].id === "quiz-edit" && crudFix.updateCalls[0].patch.title === "ชุดแก้ไขแล้ว" &&
  !!crudFix.replaceCalls && crudFix.replaceCalls[0].questions[0].prompt === "โจทย์ที่แก้แล้ว");
let deletePrompt = "";
cw.confirm = (message) => { deletePrompt = message; return true; };
cd.getElementById("btn-delete-quiz").click();
await wait(150);
check("admin CRUD: ลบจาก editor ได้ พร้อมเตือนเรื่องห้อง/ประวัติที่เชื่อมกัน", !!crudFix.deleteCalls &&
  crudFix.deleteCalls.includes("quiz-edit") && /ประวัติห้อง/.test(deletePrompt) && /รายชื่อผู้เล่น/.test(deletePrompt));

const activeDeleteFix = {
  quizzes: [{ id: "quiz-delete", title: "ชุดกำลังเล่น", question_count: 1 }],
  myRooms: [{ id: "room-delete", pin: "773311", status: "question", current_index: 0, quiz_id: "quiz-delete" }]
};
const activeDelete = load("admin.html", "", activeDeleteFix);
await wait(650);
const dw = activeDelete.window;
const activeDeleteDoc = dw.document;
let activeDeletePrompt = "";
let approveDelete = false;
dw.confirm = (message) => { activeDeletePrompt = message; return approveDelete; };
activeDeleteDoc.querySelector("#quiz-list [data-delete]").click();
await wait(100);
check("admin CRUD: ลบชุดที่มีห้องกำลังเล่น ต้องแจ้ง PIN/การปิดห้องและยืนยัน", /773311/.test(activeDeletePrompt) &&
  /ผู้เล่นจะถูกปิด/.test(activeDeletePrompt) && !activeDeleteFix.deleteCalls);
approveDelete = true;
activeDeleteDoc.querySelector("#quiz-list [data-delete]").click();
await wait(150);
check("admin CRUD: ยืนยันแล้วลบชุดได้แม้เคยเปิดห้องไว้", !!activeDeleteFix.deleteCalls && activeDeleteFix.deleteCalls[0] === "quiz-delete");

/* ---- แปลง error จากฐานข้อมูลเป็นภาษาไทย (โหลด api.js ตัวจริง ไม่ใช่สตับ) ---- */
globalThis.__USE_REAL_API__ = true;
const realApi = load("index.html", "", { pin: PIN, room: ROOM, snapshots: [state("lobby")] });
await wait(900);
globalThis.__USE_REAL_API__ = false;
const ew = realApi.window;
const T = (m) => (typeof ew.thaiDbError === "function" ? ew.thaiDbError(m) : "<<ไม่มีฟังก์ชัน>>");
check("api: แปลง error ตัวเลือกไม่ครบเป็นไทย",
  T('new row violates check constraint "questions_options_len_chk"') === "คำถามต้องมีตัวเลือก 2–6 ข้อ", T('violates check constraint "questions_options_len_chk"'));
check("api: แปลง error เฉลยหลุดช่วงเป็นไทย",
  T('violates check constraint "questions_correct_in_range_chk"').includes("เฉลยต้องชี้ไปที่ตัวเลือก"));
check("api: แปลง error RLS เป็นไทย",
  T('new row violates row-level security policy for table "quizzes"').includes("ไม่มีสิทธิ์"));
check("api: แปลง error เครือข่ายเป็นไทย",
  T("TypeError: Failed to fetch").includes("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"));
check("api: ปล่อยข้อความที่ไม่รู้จักไว้เหมือนเดิม", T("some other error") === "some other error");

/* ---- นำเข้า Excel/CSV: กรณีขอบ ---- */
const I = aw.QuizImport;
// 7 ตัวเลือก (ฐานข้อมูลรับสูงสุด 6) → ต้องไม่ทำให้บันทึกพัง
let seven = [], sevenErr = null;
try {
  seven = I.parseTable([
    ["question", "option1", "option2", "option3", "option4", "option5", "option6", "option7", "correct"],
    ["เจ็ดตัวเลือก", "1", "2", "3", "4", "5", "6", "7", "7"]
  ]);
} catch (e) { sevenErr = e.message; }
check("import: เฉลยที่ไม่ตรงกับตัวเลือกถูกปฏิเสธ ไม่เดาเป็นข้อ 1", (() => {
  let threw = null, r = [];
  try { r = I.parseTable([["question","option1","option2","correct"], ["ข้อ","ก","ข","9"]]); }
  catch (e) { threw = e.message; }
  return r.length === 0 && /เฉลย/.test(threw || "");
})(), (() => { try { I.parseTable([["question","option1","option2","correct"], ["ข้อ","ก","ข","9"]]); return "ไม่ throw"; } catch (e) { return e.message; } })());
check("import: ตัวเลือกเกิน 6 → ถูกปฏิเสธ ไม่เงียบ ๆ เปลี่ยนข้อถูก", seven.length === 0,
  seven.length ? "ยังอ่านได้ " + seven[0].options.length + " ตัวเลือก" : (sevenErr || "ถูกปฏิเสธ"));
check("import: บอกเหตุผลว่าแถวไหนถูกข้าม", /เกิน 6/.test(sevenErr || ""), sevenErr || "-");
// ตัวเลือกซ้ำกัน
const dupOpt = I.parseTable([
  ["question", "option1", "option2", "correct"],
  ["ตัวเลือกซ้ำ", "ก", "ก", "1"]
]);
check("import: ตัวเลือกซ้ำยังอ่านได้ (ไม่ crash)", dupOpt.length === 1 && dupOpt[0].options.length === 2);
// เฉลยเป็นตัวอักษร
const alpha = I.parseTable([["question", "option1", "option2", "option3", "correct"], ["ข้อ", "ก", "ข", "ค", "C"]]);
check("import: เฉลยเป็นตัวอักษร A–F อ่านได้", alpha.length === 1 && alpha[0].correct_index === 2, JSON.stringify(alpha[0] && alpha[0].correct_index));
// เฉลยเป็นข้อความของตัวเลือก
const byText = I.parseTable([["question", "option1", "option2", "correct"], ["ข้อ", "ก", "ข", "ข"]]);
check("import: เฉลยเขียนเป็นข้อความตัวเลือกได้", byText.length === 1 && byText[0].correct_index === 1);
// หัวตารางสลับลำดับ
const shuffled = I.parseTable([["correct", "option2", "question", "option1"], ["1", "ข", "สลับคอลัมน์", "ก"]]);
check("import: สลับลำดับคอลัมน์ได้", shuffled.length === 1 && shuffled[0].prompt === "สลับคอลัมน์" && shuffled[0].correct_index === 0,
  JSON.stringify(shuffled[0] && { p: shuffled[0].prompt, ci: shuffled[0].correct_index }));
// ไฟล์ว่าง / หัวตารางอย่างเดียว → ต้องแจ้ง error ชัดเจน ไม่ใช่คืน array ว่างเงียบ ๆ
let emptyErr = null;
try { I.parseTable([]); } catch (e) { emptyErr = e.message; }
check("import: ไฟล์ว่างแจ้ง error ชัดเจน", !!emptyErr, emptyErr || "ไม่ throw");
// ตัวเลขเวลาที่เกินขอบ → ถูก clamp
const clamped = I.parseTable([["question","option1","option2","time_limit","points","correct"], ["ขอบ","ก","ข","9999","99999","1"]]);
check("import: เวลา/คะแนนที่เกินขอบถูก clamp",
  clamped.length === 1 && clamped[0].time_limit <= 300 && clamped[0].points <= 4000,
  JSON.stringify(clamped[0] && { t: clamped[0].time_limit, p: clamped[0].points }));

const mixed = I.parseTable([
  ["question", "option1", "option2", "option3", "option4", "option5", "option6", "option7", "correct"],
  ["แถวดี", "ก", "ข", "", "", "", "", "", "1"],
  ["แถวไม่ดี", "1", "2", "3", "4", "5", "6", "7", "7"]
]);
check("import: ไฟล์ผสม — เก็บแถวดีไว้ ข้ามแถวเสีย พร้อมเหตุผล",
  mixed.length === 1 && mixed[0].prompt === "แถวดี" && (I.skipped() || []).length === 1,
  "ได้ " + mixed.length + " ข้อ, ข้าม " + (I.skipped() || []).length);

/* ---- ข้อมูลที่ editor ส่งไปบันทึก ต้องผ่าน constraint ของฐานข้อมูล ---- */
const edData = aw.AdminEditor.load({ title: "ชุดตรวจ", questions: [
  { prompt: "ข้อ 1", options: ["ก", "ข", "ค", "ง"], correct_index: 2, time_limit: 20, points: 1000 },
  { prompt: "ข้อ 2", options: ["ก", "", "ค"], correct_index: 2, time_limit: 30, points: 1500 }
] });
await wait(200);
const collected = aw.AdminEditor.collect();
check("admin: collect() ตัดตัวเลือกว่างออกและเลื่อนเฉลยตาม",
  collected.questions.length === 2 &&
  collected.questions[1].options.length === 2 &&
  collected.questions[1].correct_index === 1,
  JSON.stringify(collected.questions[1]));
check("admin: ทุกข้อมีตัวเลือก 2–6 (ตรงกับ constraint ฐานข้อมูล)",
  collected.questions.every((q) => q.options.length >= 2 && q.options.length <= 6));
check("admin: correct_index อยู่ในช่วงตัวเลือกทุกข้อ (ตรงกับ constraint)",
  collected.questions.every((q) => q.correct_index >= 0 && q.correct_index < q.options.length));
check("admin: ตัวเลือกไม่มีค่าว่าง/ช่องว่าง",
  collected.questions.every((q) => q.options.every((o) => o.trim().length > 0)));
check("admin: เวลาตอบอยู่ในช่วง 5–300",
  collected.questions.every((q) => q.time_limit >= 5 && q.time_limit <= 300));
check("admin: คะแนนอยู่ในช่วง 100–4000",
  collected.questions.every((q) => q.points >= 100 && q.points <= 4000));

/* ข้อที่กรอกโจทย์แต่มีตัวเลือกเดียว → ต้องถูกตัดออก ไม่ใช่ทำให้บันทึกพัง */
aw.AdminEditor.load({ title: "ชุดเสีย", questions: [
  { prompt: "มีตัวเลือกเดียว", options: ["ก"], correct_index: 0 },
  { prompt: "สมบูรณ์", options: ["ก", "ข"], correct_index: 1 }
] });
await wait(150);
const c2 = aw.AdminEditor.collect();
check("admin: ข้อที่มีตัวเลือกเดียวถูกตัดทิ้งก่อนบันทึก", c2.questions.length === 1 && c2.questions[0].prompt === "สมบูรณ์",
  JSON.stringify(c2.questions.map((q) => q.prompt)));

/* ------------------------------------------------------------------ */
console.log("\n=== host: เริ่มรอบใหม่ในห้องเดิม ===\n");
/* ในห้องอบรมจริง การสร้างห้องใหม่ทุกครั้งคือปัญหาระดับใหญ่ (ทุกคนต้องสแกน QR ใหม่)
   ปุ่มนี้ต้องรีสตาร์ท "ห้องเดิม" ไม่ใช่สร้างห้องใหม่ */
setStage(state("ended"));
await wait(200);
const againBtn = hd.getElementById("btn-restart-same");
check("host: จอจบเกมมีปุ่มเริ่มรอบใหม่ในห้องเดิม", !!againBtn);
hw.confirm = () => true;
const callsBeforeRestart = (hostFix.restartCalls || []).length;
const hrefBefore = hw.location.href;
if (againBtn) againBtn.click();
await wait(400);
check("host: กดเริ่มรอบใหม่ → เรียก restartRoom ครั้งเดียว",
  (hostFix.restartCalls || []).length === callsBeforeRestart + 1,
  JSON.stringify(hostFix.restartCalls || []));
check("host: กดเริ่มรอบใหม่ → ไม่สร้างห้องใหม่ (ไม่เปลี่ยนหน้า)",
  hw.location.href === hrefBefore, hw.location.href);
const toastOk = Array.from(hd.querySelectorAll(".toast")).some((t) => /เริ่มรอบใหม่แล้ว/.test(t.textContent));
check("host: กดเริ่มรอบใหม่ → แจ้งผลภาษาไทยพร้อมจำนวนผู้เล่นที่ยังอยู่",
  toastOk, (Array.from(hd.querySelectorAll(".toast")).map((t) => t.textContent).join(" | ")).slice(0, 120));
check("host: รีสตาร์ทส่ง room_id ของห้องเดิม (ไม่ใช่ห้องใหม่)",
  (hostFix.restartCalls || [])[0] === ROOM, String((hostFix.restartCalls || [])[0]));

/* ปฏิเสธการยืนยัน → ต้องไม่เรียกระบบ */
hw.confirm = () => false;
const callsCancel = (hostFix.restartCalls || []).length;
if (againBtn) { againBtn.click(); }
await wait(200);
check("host: กดยกเลิกในกล่องยืนยัน → ไม่รีสตาร์ท",
  (hostFix.restartCalls || []).length === callsCancel,
  String((hostFix.restartCalls || []).length));

/* ระบบตอบ error → ต้องแจ้งเตือน ไม่ค้างปุ่ม */
hw.confirm = () => true;
hostFix.restartResult = { error: "not_ended" };
againBtn.disabled = false;
if (againBtn) againBtn.click();
await wait(400);
check("host: รีสตาร์ทไม่สำเร็จ → แจ้งเตือนภาษาไทย และปุ่มกลับมากดได้",
  !againBtn.disabled, "disabled=" + againBtn.disabled);
hostFix.restartResult = null;

/* ================================================================== */
console.log("\n=== play.html: ผู้เล่นรับรู้การเริ่มรอบใหม่ในห้องเดิม ===\n");
/* บั๊กที่พบ: จอ "จบเกม" สั่งปิด polling + realtime ทิ้ง (stopAll)
   → เมื่อผู้ดำเนินรายการเริ่มรอบใหม่ ผู้เล่นจะค้างอยู่ที่จอจบเกมตลอดไป
   และถ้าหลุดมาจอเดิม ค่า answeredQid/timerQid ของรอบเก่ายังค้างอยู่ (คำถามชุดเดิม = id เดิม)
   ทำให้ผู้เล่นถูกจับไปหน้าจอ "ตอบแล้ว" ทั้งที่ยังไม่ได้ตอบในรอบใหม่ */
const restartQ = [0, 1].map((n) => Object.assign({}, state("question").question, { id: "q-" + n, index: n }));
const restartFix = {
  pin: PIN, room: ROOM,
  me: { id: "me", nickname: "Anna", score: 0, streak: 0, correct_count: 0, rank: 1, avatar: { c: "cat", h: "crown", s: 2, t: 0 } },
  answered: false,
  phase: "round1",
  resumeState: state("question", { current_index: 0, question: restartQ[0], question_count: 2 }),
  joinResult: { player_id: "me", token: "tok-1", nickname: "Anna", avatar: { c: "cat", h: "crown", s: 2, t: 0 }, rejoined: false, state: state("lobby") }
};
restartFix.resumeResult = () => {
  const st = restartFix.phase;
  if (st === "round1") return { player: restartFix.me, answered_current: false, state: state("question", { current_index: 1, question: restartQ[1], question_count: 2 }) };
  if (st === "ended") return { player: Object.assign({}, restartFix.me, { score: 1200, rank: 1 }), answered_current: false, state: state("ended") };
  return { player: Object.assign({}, restartFix.me, { score: 0 }), answered_current: false, state: state("lobby", { player_count: 1 }) };
};
const rp = load("play.html", "?pin=" + PIN, restartFix);
await wait(500);
const rrd = rp.window.document;
const ron = (id) => rrd.getElementById(id).classList.contains("on");
rrd.getElementById("nick").value = "Anna";
rrd.getElementById("btn-join").click();
await wait(600);
restartFix.phase = "ended";
await wait(6200);
check("play: ถึงจอจบเกมตามปกติ", ron("s-ended"), rrd.querySelector(".screen.on") && rrd.querySelector(".screen.on").id);

/* ผู้ดำเนินรายการกด "เริ่มรอบใหม่ในห้องเดิม" → ผู้เล่นต้องถูกดึงกลับล็อบบี้เองโดยไม่ต้องรีเฟรช */
restartFix.phase = "lobby";
await wait(6200);
check("play: รีสตาร์ทห้องเดิม → จอจบเกมกลับมาล็อบบี้เองโดยไม่ต้องรีเฟรช",
  ron("s-lobby"), rrd.querySelector(".screen.on") && rrd.querySelector(".screen.on").id);
const myScoreTxt = rrd.getElementById("myscore").textContent.trim();
check("play: รีสตาร์ทห้องเดิม → คะแนนบนหัวจอถูกรีเซ็ตเป็น 0",
  /(^|\D)0(\D|$)/.test(myScoreTxt), "myscore=" + myScoreTxt);

/* รอบใหม่เริ่มข้อ 1 (id เดิม) → ต้องได้จอคำถาม ไม่ใช่ "ตอบแล้ว" */
restartFix.phase = "round1";
await wait(6200);
check("play: รอบใหม่ข้อ 1 ขึ้นจอคำถาม (ไม่ค้างที่จอ “ตอบแล้ว” ของรอบเก่า)",
  ron("s-question"), rrd.querySelector(".screen.on") && rrd.querySelector(".screen.on").id);

/* ================================================================== */
console.log("\n=== sound.js: แพ็กเพลงพื้นหลังต้องมีผลจริง ===\n");
/* บั๊กที่พบ: ตั้งค่า "แพ็กเพลง" (ชิล/ตื่นเต้น/ไพเราะ) ถูกบันทึกและแสดงในเมนู
   แต่ไม่เคยถูกใช้สร้างเสียง — โค้ดเลือกเพลงดูที่ musicWanted ("lobby") เท่านั้น
   → ผู้ใช้เปลี่ยนแพ็กแล้วไม่ได้ยินอะไรต่างเลย (branch "gentle" เป็นโค้ดตาย) */
const sndLog = [];
function makeAudioCtx() {
  const rec = (freq) => { sndLog.push({ t: 0, freq }); };
  const param = () => ({ value: 0, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; }, cancelScheduledValues() { return this; } });
  const mkParam = () => Object.assign(param(), { setValueAtTime(v) { rec(v); return this; } });
  const node = () => {
    const freq = mkParam();
    return { connect() { return this; }, disconnect() { return this; }, start() {}, stop() {},
      frequency: freq, detune: param(), Q: param(), gain: param(),
      type: "", buffer: null, loop: false,
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
      pan: param(), curve: null, oversample: "none" };
  };
  const t0 = Date.now();
  const self = {
    state: "running", sampleRate: 44100,
    get currentTime() { return (Date.now() - t0) / 1000; },   // ต้องเดินจริง ไม่งั้น pump() ไม่ทำงาน
    destination: node(),
    createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createDynamicsCompressor: node, createStereoPanner: node, createConvolver: node, createWaveShaper: node,
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    resume: async () => { self.state = "running"; },
    suspend: async () => { self.state = "suspended"; },
    close: async () => {}
  };
  return self;
}
const sndFix = { pin: PIN, room: ROOM, __audioCtx: makeAudioCtx };
const sp = load("index.html", "", sndFix);
await wait(300);
const sw = sp.window;
check("sound: โหลดตัวเล่นเสียงได้", !!sw.Snd && typeof sw.Snd.set === "function");
// จำลองผู้ใช้แตะหน้าจอ (เบราว์เซอร์ต้องมี interaction ก่อนจึงเล่นเสียงได้)
sw.document.dispatchEvent(new sw.Event("pointerdown"));
sw.Snd.set("on", true);
sw.Snd.set("music", true);
sw.Snd.set("pack", "gentle");
sndLog.length = 0;
sw.Snd.music("lobby");
await wait(700);
const gentleFreqs = sndLog.map((x) => x.freq).filter((f) => f > 0);
check("sound: แพ็ก “ไพเราะ” ต้องสร้างเสียงจริง (ไม่ใช่โค้ดตาย)",
  gentleFreqs.length > 0, "จำนวนโน้ต=" + gentleFreqs.length);
/* เปลี่ยนเป็นแพ็ก "ตื่นเต้น" → รูปแบบเสียงต้องเปลี่ยน */
sw.Snd.set("pack", "tension");
sndLog.length = 0;
sw.Snd.music("lobby");
await wait(700);
const tensionFreqs = sndLog.map((x) => x.freq).filter((f) => f > 0);
check("sound: สลับแพ็กเพลงแล้วเสียงเปลี่ยนจริง",
  tensionFreqs.length > 0 && JSON.stringify(tensionFreqs) !== JSON.stringify(gentleFreqs),
  "gentle=" + gentleFreqs.slice(0, 4).join(",") + " | tension=" + tensionFreqs.slice(0, 4).join(","));
/* ค่าที่ไม่ถูกต้องต้องถูกกันไว้ */
sw.Snd.set("pack", "<script>");
check("sound: แพ็กเพลงที่ไม่รู้จักถูกกันกลับเป็น chill", sw.Snd.get("pack") === "chill", sw.Snd.get("pack"));
sw.Snd.set("tickFromSeconds", 9999);
check("sound: ตั้งนาฬิกาติ๊กได้ไม่เกิน 300 วินาที", sw.Snd.get("tickFromSeconds") === 300, String(sw.Snd.get("tickFromSeconds")));
sw.Snd.set("tickFromSeconds", -5);
check("sound: ตั้งนาฬิกาติ๊กต่ำสุด 1 วินาที", sw.Snd.get("tickFromSeconds") === 1, String(sw.Snd.get("tickFromSeconds")));
sw.Snd.stopMusic();

/* ================================================================== */
console.log("\n=== index.html: กรอก PIN ===\n");
const idx = load("index.html", "", {});
await wait(400);
const iw = idx.window;
const inp = iw.document.getElementById("pin-input");
inp.value = "12ab34cd56";
inp.dispatchEvent(new iw.Event("input"));
check("index: กรองให้เหลือแต่ตัวเลข 6 หลัก", inp.value === "123456", inp.value);
check("index: มีปุ่ม/แบบฟอร์มเข้าร่วม", !!iw.document.getElementById("join-form"));
check("index: มีแผงผู้จัดให้เข้าสู่ระบบ", !!iw.document.getElementById("auth-form"));

/* ---- หน้าแรก: ไม่ต้องเลื่อน + ฟอร์มผู้จัดเป็น popup ---- */
const idxCss = fs.readFileSync(path.join(ROOT, "assets/css/app.css"), "utf8");
check("index: หน้าแรกถูกล็อกให้จบในจอเดียว (ไม่มีการเลื่อนขึ้นลง)",
  /body\.page-landing\s*\{[^}]*overflow:hidden/s.test(idxCss) &&
  /\.k-page\s*\{[^}]*height:100dvh/s.test(idxCss) && /\.k-page\s*\{[^}]*overflow:hidden/s.test(idxCss));
const hostModal = iw.document.getElementById("host-modal");
check("index: ฟอร์มผู้จัดอยู่ในหน้าต่าง popup ที่ซ่อนไว้ก่อน", !!hostModal &&
  hostModal.classList.contains("hidden") && hostModal.getAttribute("aria-modal") === "true");
iw.document.getElementById("toggle-host").click();
await wait(120);
check("index: กด “สำหรับผู้จัด” แล้วเปิด popup โดยไม่ดันหน้าแรก",
  !hostModal.classList.contains("hidden") && hostModal.getAttribute("aria-hidden") === "false" &&
  iw.document.body.classList.contains("modal-open"));
iw.document.dispatchEvent(new iw.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("index: ปิด popup ด้วย Escape ได้", hostModal.classList.contains("hidden") &&
  hostModal.getAttribute("aria-hidden") === "true" && !iw.document.body.classList.contains("modal-open"));
iw.document.getElementById("toggle-host").click();
iw.document.getElementById("host-close").click();
check("index: ปุ่ม ✕ ปิด popup ได้", hostModal.classList.contains("hidden"));

/* ---- รหัสผ่าน: กดซ่อน/แสดงเพื่อตรวจสอบก่อนเข้าสู่ระบบ ---- */
const pwField = iw.document.getElementById("password");
const pwBtn = iw.document.getElementById("toggle-password");
check("index: มีปุ่มซ่อน/แสดงรหัสผ่านในช่องรหัสผ่าน", !!pwBtn && pwBtn.type === "button" &&
  pwBtn.getAttribute("aria-pressed") === "false" && pwField.type === "password");
pwField.value = "secret123";
pwBtn.click();
check("index: กดครั้งแรกแล้วเห็นรหัสผ่านจริง", pwField.type === "text" &&
  pwBtn.getAttribute("aria-pressed") === "true" && /ซ่อนรหัสผ่าน/.test(pwBtn.getAttribute("aria-label")) &&
  iw.document.querySelector("#toggle-password .pw-icon-eye").classList.contains("hidden") &&
  !iw.document.querySelector("#toggle-password .pw-icon-eye-off").classList.contains("hidden"));
pwBtn.click();
check("index: กดอีกครั้งแล้วซ่อนรหัสผ่านกลับเหมือนเดิม", pwField.type === "password" &&
  pwBtn.getAttribute("aria-pressed") === "false" && /แสดงรหัสผ่าน/.test(pwBtn.getAttribute("aria-label")));

/* ---- ลิขสิทธิ์: ต้องไม่มีคำว่า Kahoot เหลือในไฟล์ที่ deploy ---- */
check("ลิขสิทธิ์: ไม่มีคำว่า “Kahoot” ในเอกสาร/หน้าเว็บที่ deploy (docs/)", (() => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(html|css|js|md|svg|txt|json|xml|webmanifest)$/i.test(e.name)) continue;
      if (/kahoot/i.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(ROOT, full));
    }
  };
  walk(ROOT);
  if (hits.length) console.log("  ไฟล์ที่ยังมีคำว่า Kahoot: " + hits.join(", "));
  return hits.length === 0;
})());

/* ================================================================== */
console.log("\n=== สรุป ===");
const errs = consoleErrors.filter((e) => !/autoplay|AudioContext|Not implemented/.test(e));
if (errs.length) console.log("ข้อผิดพลาดในคอนโซล:\n" + errs.slice(0, 8).join("\n"));
check("ไม่มี JavaScript error ในทุกหน้า", errs.length === 0, errs.slice(0, 2).join(" / "));
/* กันการถดถอย: ถ้าไฟล์โหลดไม่ได้ (เช่นไม่มี static server) เทสต์ต้องฟ้อง ไม่ใช่ผ่านเงียบ ๆ */
const loadErrs = consoleErrors.filter((e) => /Could not load script|is not defined/.test(e));
check("โหลดสคริปต์/ไฟล์ครบทุกหน้า (ไม่พึ่ง static server ภายนอก)", loadErrs.length === 0,
  loadErrs.slice(0, 2).join(" / "));

console.log("\nผลรวม: " + (out.length - failed) + "/" + out.length + " passed");
process.exit(failed ? 1 : 0);
