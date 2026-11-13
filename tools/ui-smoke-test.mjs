/**
 * ทดสอบหน้าเว็บแบบไม่ต้องเปิดเบราว์เซอร์ (DOM จริงด้วย jsdom)
 *
 *   npm i jsdom          # ครั้งเดียว
 *   node tools/ui-smoke-test.mjs
 *
 * ตรวจ: ตัวนำเข้า Excel/CSV/JSON, ปุ่มเสียง, บัลลังก์ผู้ชนะ (ทั้งจอผู้จัดและมือถือ)
 * ถ้าไม่ได้ติดตั้ง jsdom ไว้ จะข้ามการทดสอบ (exit 0)
 */
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import("jsdom"));
} catch (e) {
  console.log("ข้ามการทดสอบ: ยังไม่ได้ติดตั้ง jsdom (npm i jsdom)");
  process.exit(0);
}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const vc = new VirtualConsole();
const errors = [];
vc.on("jsdomError", (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push("jsdomError: " + e.message); });
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

function load(file, query) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  return new JSDOM(html, {
    url: "file://" + path.join(ROOT, file) + (query || ""),
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
function check(name, cond, extra) { const line = (cond ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : ""); out.push(line); console.log(line); if (!cond) process.exitCode = 1; }

/* ---------------- admin.html: ตัวนำเข้า Excel/CSV/JSON ---------------- */
const admin = load("admin.html");
await wait(1200);
const w = admin.window;
check("admin: window.XLSX โหลดแล้ว", !!w.XLSX, w.XLSX && w.XLSX.version);
check("admin: window.QuizImport พร้อมใช้", !!(w.QuizImport && w.QuizImport.parseTable));

// อ่านเทมเพลทจริงด้วย SheetJS แล้วส่งเข้า parseTable
const wb = w.XLSX.read(fs.readFileSync(path.join(ROOT, "samples/quiz-template.xlsx")), { type: "buffer" });
const rows = w.XLSX.utils.sheet_to_json(wb.Sheets["คำถาม"], { header: 1, raw: false, defval: "" });
const parsed = w.QuizImport.parseTable(rows);
check("Excel: อ่านเทมเพลทได้ 5 ข้อ", parsed.length === 5, "ได้ " + parsed.length);
check("Excel: เฉลยข้อ 1 = ตัวเลือก 2", parsed[0].correct_index === 1, JSON.stringify(parsed[0].options));
check("Excel: ข้อ 1 ได้ 4 ตัวเลือก", parsed[0].options.length === 4);
check("Excel: points/time_limit อ่านแล้ว", parsed[0].time_limit === 20 && parsed[0].points === 1000);
check("Excel: คำถามที่นำเข้าใช้พื้นหลังเริ่มต้นได้", parsed[0].background === "aurora");

const csv = fs.readFileSync(path.join(ROOT, "samples/sample-quiz.csv"), "utf8");
const fromCsv = w.QuizImport.parseCSV(csv);
check("CSV: อ่าน sample-quiz.csv ได้ 8 ข้อ", fromCsv.length === 8, "ได้ " + fromCsv.length);

const json = JSON.stringify([{ prompt: "ทดสอบ", options: ["ก", "ข", "ค"], correct_index: 2, time_limit: 30, points: 1500 }]);
const fromJson = w.QuizImport.parseJSON(json);
check("JSON: อ่านได้ 1 ข้อ", fromJson.length === 1 && fromJson[0].correct_index === 2);

check("admin: มี dropzone", !!w.document.querySelector("#dropzone"));
check("admin: มีปุ่มเทมเพลท Excel", !!w.document.querySelector("#btn-template-xlsx"));

/* ---------------- sound.js: UI + state ---------------- */
check("sound: window.Snd มีอยู่", !!w.Snd);
check("sound: ปุ่มเสียงถูกสร้าง", !!w.document.querySelector(".snd-fab .snd-btn"));
w.Snd.set("on", false);
check("sound: ปิดเสียงแล้วค่าเปลี่ยน", w.Snd.isOn() === false);
w.Snd.set("on", true);
check("sound: เปิดเสียงกลับได้", w.Snd.isOn() === true);
w.Snd.set("tickFromSeconds", 300);
check("sound: ตั้งนาฬิกา 5 นาทีได้", w.Snd.get("tickFromSeconds") === 300);
check("sound: เลือกเพลงเล่นเกมและปุ่มฟังตัวอย่างครบ 3 เพลง", w.document.querySelectorAll("[data-game-track]").length === 3 && w.document.querySelectorAll("[data-preview-track]").length === 3);
const shuffledTracks = [0, 1, 2].map((i) => w.Snd.questionTrack(i));
check("sound: สุ่มเพลงที่เลือกโดยไม่ซ้ำก่อนครบทั้ง 3", new Set(shuffledTracks).size === 3 && shuffledTracks.every((t) => ["q1", "q2", "q3"].includes(t)), JSON.stringify(shuffledTracks));
w.Snd.set("gameTracks", ["q2", "q3"]);
const chosenTracks = [0, 1].map((i) => w.Snd.questionTrack(i));
check("sound: ใช้เฉพาะเพลงที่ผู้ใช้เลือก", new Set(chosenTracks).size === 2 && chosenTracks.every((t) => ["q2", "q3"].includes(t)), JSON.stringify(chosenTracks));
w.Snd.set("gameTracks", ["q1", "q2", "q3"]);
w.Snd.set("tickFromSeconds", 5);
w.Snd.set("volume", 0.5);
check("sound: จำค่า volume", w.Snd.get("volume") === 0.5);
// ไม่มี AudioContext ใน jsdom → ต้องไม่ throw
let threw = null;
try { w.Snd.play("correct"); w.Snd.music("tension"); w.Snd.countdown(4200); w.Snd.stopMusic(); } catch (e) { threw = e; }
check("sound: เรียกใช้ได้โดยไม่พังเมื่อไม่มี Web Audio", !threw, threw && threw.message);

/* ---------------- scoring: timeout answers are rejected server-side ---------------- */
const submitSql = fs.readFileSync(path.resolve(ROOT, "../supabase/migrations/0003_fix_answer_choice_range.sql"), "utf8");
const timeoutGuard = submitSql.indexOf("if v_ms <= 0 then return jsonb_build_object('error','time_up'); end if;");
const answerInsert = submitSql.indexOf("insert into public.answers");
check("scoring: หมดเวลาแล้ว RPC ปฏิเสธก่อนบันทึกคำตอบ/คะแนน", timeoutGuard >= 0 && answerInsert > timeoutGuard,
  "time_up guard line " + timeoutGuard + " · insert line " + answerInsert);

/* ---------------- podium ---------------- */
const host = load("host.html");
await wait(1200);
const hw = host.window;
check("host: รายชื่อผู้เล่นอยู่ในแผงเด่นแยกต่างหาก", (() => {
  const panel = hw.document.querySelector(".players-panel");
  return !!panel && panel.contains(hw.document.querySelector("#players")) && !!panel.querySelector("#players-heading");
})());
check("host: QR overlay อยู่นอก .wrap เพื่อไม่ถูก layout บัง", hw.document.querySelector("#qr-modal").parentElement === hw.document.body);
check("host: ห้องรอแบ่งสองฝั่ง (ผู้เข้าร่วม | ข้อมูลเข้าห้อง)", (() => {
  const hero = hw.document.querySelector("#s-lobby .lobby-hero");
  const panel = hero && hero.querySelector(":scope > .players-panel");
  const side = hero && hero.querySelector(":scope > .lobby-side");
  return !!panel && !!side && !!side.querySelector("#qr") && !!side.querySelector("#qr-pin") &&
    !!side.querySelector("#joinurl") && !!side.querySelector("#btn-start");
})());
check("host: คำอธิบายการค้นหาชื่อ/ตัวละครอยู่ในแผงผู้เข้าร่วม (ตัวใหญ่ อ่านชัด)",
  !!hw.document.querySelector(".players-panel .players-sub") &&
  hw.document.querySelector(".players-panel .players-sub").textContent.includes("ค้นหาชื่อและตัวละคร"));
check("host: ปุ่มออกจากระบบใช้ข้อความเต็ม", hw.document.getElementById("btn-logout") &&
  hw.document.getElementById("btn-logout").textContent.trim() === "ออกจากระบบ");
check("host: QR เปิดด้วยปุ่มที่ระบุ aria-controls / aria-expanded", (() => {
  const b = hw.document.querySelector("#qr");
  return b && b.type === "button" && b.getAttribute("aria-controls") === "qr-modal" && b.getAttribute("aria-expanded") === "false";
})());
check("host: CSS ให้ QR เป็น fixed overlay และขยายรายชื่อผู้เล่น",
  /body\.theme-host\s*>\s*#qr-modal\s*\{[^}]*position:fixed/s.test(fs.readFileSync(path.join(ROOT, "assets/css/app.css"), "utf8")) &&
  /\.players-panel\s*\{[^}]*min-height:clamp/s.test(fs.readFileSync(path.join(ROOT, "assets/css/app.css"), "utf8")));
check("host: Podium พร้อม", !!hw.Podium);
const box = hw.document.querySelector("#end-podium");
hw.Podium.render(box, [
  { nickname: "สมชาย", score: 4200 }, { nickname: "Anna", score: 3800 }, { nickname: "ปิยะ", score: 3100 },
  { nickname: "คนที่ 4", score: 100 }
], { caption: "ยินดีด้วยกับผู้ชนะ" });
const html = box.innerHTML;
check("podium: มีบัลลังก์", html.includes("throne-svg"));
check("podium: มีมงกุฎ", html.includes("crown-svg"));
check("podium: มีตัวละคร 3 ตัว", (html.match(/class="avatar-svg char"|class="char"/g) || []).length === 3);
check("podium: มีชื่อผู้ชนะ", html.includes("สมชาย"));
check("podium: มีแท่นอันดับ 2/3", html.includes("pod-2") && html.includes("pod-3"));
check("podium: มีคอนเฟตติ canvas", !!box.querySelector(".podium-confetti"));
check("podium: ไม่แสดงคนที่ 4", !html.includes("คนที่ 4"));

const mini = hw.document.createElement("div");
hw.Podium.mini(mini, { nickname: "สมชาย", rank: 1, score: 4200 }, { caption: "อันดับ 1" });
check("podium mini: มีบัลลังก์+มงกุฎ", mini.innerHTML.includes("throne-svg") && mini.innerHTML.includes("mini-crown"));

/* ---------------- avatars.js ---------------- */
check("avatar: window.Avatars พร้อม", !!(hw.Avatars && hw.Avatars.svg));
const cat = hw.Avatars.svg({ c: "cat", s: 3, h: "crown", t: 2 });
check("avatar: วาดตัวละครได้", cat.includes("<svg") && cat.includes("</svg>"));
check("avatar: มีสัตว์ให้เลือก 8 ชนิด",
  hw.Avatars.catalog().chars.filter((c) => c.kind === "animal").length >= 8,
  String(hw.Avatars.catalog().chars.filter((c) => c.kind === "animal").length));
check("avatar: มีเครื่องแต่งกาย 10+ แบบ", hw.Avatars.catalog().hats.length >= 10, String(hw.Avatars.catalog().hats.length));
check("avatar: normalize ค่าขยะได้", (() => {
  const a = hw.Avatars.normalize({ c: "nope", s: 99, h: "zz", t: -4 });
  return a.c === "kid" && a.s === 5 && a.h === "none" && a.t === 0;
})(), JSON.stringify(hw.Avatars.normalize({ c: "nope", s: 99, h: "zz", t: -4 })));
check("avatar: fromName คงที่ต่อชื่อเดียวกัน",
  JSON.stringify(hw.Avatars.fromName("สมชาย")) === JSON.stringify(hw.Avatars.fromName("สมชาย")));

/* ตัวเลือกตัวละคร (picker) สร้าง UI ได้จริง */
const avBox = hw.document.createElement("div");
hw.document.body.appendChild(avBox);
let avPicked = null;
hw.Avatars.picker(avBox, { c: "dog", s: 1, h: "cap", t: 3 }, (a) => { avPicked = a; });
check("avatar: picker สร้างแท็บได้", avBox.querySelectorAll("[data-avtab]").length === 4);
check("avatar: picker มีตัวละครให้กด", avBox.querySelectorAll("[data-c]").length >= 12);
const foxBtn = avBox.querySelector('[data-c="fox"]');
foxBtn && foxBtn.click();
check("avatar: กดเลือกสัตว์แล้ว callback ทำงาน", !!avPicked && avPicked.c === "fox", JSON.stringify(avPicked));
const hatTab = avBox.querySelector('[data-avtab="hat"]');
hatTab && hatTab.click();
check("avatar: แท็บเครื่องแต่งกายมีของให้เลือก", avBox.querySelectorAll("[data-h]").length >= 10);

/* ---------------- FX (เอฟเฟคชื่อเด้งเข้าจอผู้จัด) ---------------- */
check("fx: window.FX พร้อม", !!(hw.FX && hw.FX.onJoin));
hw.FX.onJoin({ nickname: "น้องทดสอบ", avatar: { c: "panda", s: 2, h: "party", t: 4 } });
const toastEl = hw.document.querySelector(".join-toast");
check("fx: มีป้ายชื่อผู้เล่นเด้งเข้ามา", !!toastEl && toastEl.textContent.includes("น้องทดสอบ"));
check("fx: ป้ายมีตัวละครของผู้เล่น", !!toastEl && !!toastEl.querySelector("svg"));

/* ---------------- host.html: ตั้งค่าการแสดงตัวเลือก ---------------- */
check("host: มีปุ่มเลือกโหมดแสดงตัวเลือก", hw.document.querySelectorAll("#seg-show button").length === 2);
check("host: มีปุ่มเปิด–ปิดเพลง/เอฟเฟคเร็ว", !!(hw.document.querySelector("#btn-music") && hw.document.querySelector("#btn-fx")));

/* ---------------- admin: ตัวเลือกโหมดแสดงต่อข้อ ---------------- */
admin.window.document.querySelector("#btn-new").click();
if (!admin.window.document.querySelector("#q-list [data-show]") && admin.window.AdminEditor) {
  admin.window.AdminEditor.newQuiz("ทดสอบโหมดแสดง");
}
await wait(200);
const qList = admin.window.document.querySelector("#q-list");
check("admin: มีตัวเลือกโหมดแสดงต่อข้อ", !!qList.querySelector("[data-show]"));
check("admin: ค่าเริ่มต้น = ตามที่ผู้จัดตั้ง", qList.querySelector("[data-show]").value === "");
check("admin: เลือกโหมดสัญลักษณ์ได้", (() => {
  const sel = qList.querySelector("[data-show]");
  sel.value = "shape";
  sel.dispatchEvent(new w.Event("change"));
  return sel.value === "shape";
})());
check("admin: เลือกธีมพื้นหลังคำถามได้ครบ 10 แบบ", qList.querySelectorAll("[data-background] option").length === 10);
const bgSelect = qList.querySelector("[data-background]");
bgSelect.value = "ocean"; bgSelect.dispatchEvent(new w.Event("change"));
const maxPlayers = admin.window.document.getElementById("quiz-max-players");
maxPlayers.value = "80";
check("admin: เก็บธีมพื้นหลังและจำนวนผู้เล่นสูงสุด", admin.window.AdminEditor.questions()[0].background === "ocean" &&
  admin.window.AdminEditor.collect().max_players === 80);
check("admin: เพดานชุดคำถามไม่เกิน Free-safe 120 คน", admin.window.document.getElementById("quiz-max-players").max === "120" &&
  /0, 120\)/.test(fs.readFileSync(path.resolve(ROOT, "assets/js/page-admin.js"), "utf8")));
check("admin: ปุ่มล้างข้อมูลต้องยืนยันรหัสผ่านและข้อความยืนยัน", !!admin.window.document.getElementById("btn-clear-data") &&
  admin.window.document.getElementById("clear-data-password").type === "password" && !!admin.window.document.getElementById("clear-data-confirm"));

/* ---------------- play.html ---------------- */
const play = load("play.html", "?pin=123456");
await wait(800);
check("play: Podium + Snd พร้อม", !!(play.window.Podium && play.window.Snd));
check("play: มีที่วางบัลลังก์ย่อ", !!play.window.document.querySelector("#end-podium"));
check("play: มีการ์ดตกแต่งตัวละคร", !!play.window.document.querySelector("#av-picker"));
check("play: มีปุ่มตกแต่งตัวละครระหว่างรอ", !!play.window.document.querySelector("#btn-customize2"));
check("play: Avatars + FX โหลดแล้ว", !!(play.window.Avatars && play.window.FX));
const playCss = fs.readFileSync(path.join(ROOT, "assets/css/app.css"), "utf8");
check("play: ตัวอักษรโจทย์ใหญ่กว่าตัวเลือก", /\.prompt\s*\{[^}]*font-size:clamp\(21px,5vw,28px\)/s.test(playCss) &&
  /\.ans\s*\{[^}]*font-size:clamp\(16px,2\.2vw,21px\)/s.test(playCss));
check("podium: ตัวละครเต้นฉลองหลังเปิดตัวแชมป์", /@keyframes podiumJoyDance/.test(playCss) &&
  /\.podium\.go\.champ[\s\S]*podiumJoyDance 1\.15s/.test(playCss) &&
  /prefers-reduced-motion:reduce[\s\S]*podium\.go\.champ \.pod-char \.avatar-svg/.test(playCss));


/* ---------------- API: ห้องต้องเป็นของผู้จัดที่เข้าสู่ระบบ ---------------- */
const apiDom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://quiz-test.example/", runScripts: "outside-only"
});
const roomQueryLog = [];
const mockRooms = [
  { id: "own-live", host_id: "host-1", pin: "111222", status: "lobby", quiz_id: "quiz-1", current_index: -1 },
  { id: "other-live", host_id: "host-2", pin: "333444", status: "question", quiz_id: "quiz-2", current_index: 0 },
  { id: "own-ended", host_id: "host-1", pin: "555666", status: "ended", quiz_id: "quiz-1", current_index: 4 }
];
apiDom.window.QUIZ_CONFIG = { SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_ANON_KEY: "unit-test" };
apiDom.window.supabase = { createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "host-1" } } }) },
  from: (table) => {
    const state = { rows: mockRooms.slice() };
    const q = {
      select(fields) { roomQueryLog.push(["select", table, fields]); return this; },
      eq(field, value) { roomQueryLog.push(["eq", field, value]); state.rows = state.rows.filter((r) => r[field] === value); return this; },
      neq(field, value) { roomQueryLog.push(["neq", field, value]); state.rows = state.rows.filter((r) => r[field] !== value); return this; },
      order(field, opts) { roomQueryLog.push(["order", field, opts]); return this; },
      limit(n) { roomQueryLog.push(["limit", n]); return this; },
      then(resolve, reject) { return Promise.resolve({ data: state.rows, error: null }).then(resolve, reject); }
    };
    return q;
  }
}) };
apiDom.window.eval(fs.readFileSync(path.resolve(ROOT, "assets/js/api.js"), "utf8"));
const myRooms = await apiDom.window.API.myRooms();
check("api: มีฟังก์ชันปิด/ลบห้องให้หน้าห้องทำงานใช้", typeof apiDom.window.API.closeRoom === "function" &&
  typeof apiDom.window.API.deleteRoom === "function");
check("api: รายการห้องกรองตาม host_id และตัดห้องจบแล้ว", myRooms.length === 1 && myRooms[0].id === "own-live" &&
  roomQueryLog.some((x) => x[0] === "eq" && x[1] === "host_id" && x[2] === "host-1") &&
  roomQueryLog.some((x) => x[0] === "neq" && x[1] === "status" && x[2] === "ended") &&
  roomQueryLog.some((x) => x[0] === "limit" && x[1] === 1000), JSON.stringify(myRooms));
check("api: myRooms ขอ allow_late/show_options มาสำหรับหน้าจัดการห้อง",
  roomQueryLog.some((x) => x[0] === "select" && /allow_late/.test(x[2]) && /show_options/.test(x[2])),
  JSON.stringify(roomQueryLog.filter((x) => x[0] === "select")));
const roomPolicy = fs.readFileSync(path.resolve(ROOT, "../supabase/migrations/0008_restrict_room_reads.sql"), "utf8");
check("security: migration จำกัด SELECT ห้องไว้เฉพาะ host ที่ล็อกอิน", roomPolicy.includes("for select to authenticated") &&
  roomPolicy.includes("using (host_id = auth.uid())") && !roomPolicy.includes("to anon"));
const apiSource = fs.readFileSync(path.resolve(ROOT, "assets/js/api.js"), "utf8");
check("api: แจ้งผู้เล่นเมื่อเต็มเพดานผู้เล่นรวมของ Free", /free_plan_capacity:/.test(apiSource) && /เพดานความปลอดภัยของ Free/.test(apiSource));
const migration0010 = fs.readFileSync(path.resolve(ROOT, "../supabase/migrations/0010_question_background_capacity_and_owner_purge.sql"), "utf8");
check("db: migration มี 10 พื้นหลัง, เพดาน Free-safe 120 คนทั่วโปรเจกต์ และ purge ใช้ auth.uid() เท่านั้น",
  (migration0010.match(/'aurora'|'sunset'|'ocean'|'forest'|'galaxy'|'candy'|'midnight'|'coral'|'mint'|'gold'/g) || []).length >= 10 &&
  /max_players between 0 and 120/.test(migration0010) && /for update/i.test(migration0010) &&
  /pg_advisory_xact_lock/.test(migration0010) && /v_active_count >= 120/.test(migration0010) &&
  /v_count >= v_room\.max_players/.test(migration0010) && /create or replace function public\.purge_my_data\(\)/.test(migration0010) &&
  /v_owner uuid := auth\.uid\(\)/.test(migration0010) && !/purge_my_data\([^)]*owner_id/i.test(migration0010));
check("api: ฐานข้อมูลยังไม่มีคอลัมน์ (schema cache) ไม่ทำให้บันทึก/นำเข้าชุดคำถามล้มทั้งก้อน",
  typeof admin.window.missingColumnName === "function" &&
  admin.window.missingColumnName("Could not find the 'max_players' column of 'quizzes' in the schema cache") === "max_players" &&
  admin.window.missingColumnName("column \"background\" of relation \"questions\" does not exist") === "background" &&
  typeof admin.window.API.schemaWarnings === "function" &&
  /writeWithColumnFallback/.test(apiSource) && /delete draft\[col\]|dropColumn\(col\)/.test(apiSource) &&
  /insert\(draft\)/.test(apiSource) && /insert\(draft\)/.test(apiSource) && /update\(draft\)/.test(apiSource) &&
  /warnSchemaGaps\(\)/.test(fs.readFileSync(path.resolve(ROOT, "assets/js/page-admin.js"), "utf8")));
const appCss = fs.readFileSync(path.resolve(ROOT, "../docs/assets/css/app.css"), "utf8");
check("css: มีสไตล์พื้นหลังครบ 10 ธีมและรูปแบบอันดับ 1–3", ["aurora", "sunset", "ocean", "forest", "galaxy", "candy", "midnight", "coral", "mint", "gold"].every((x) => appCss.includes(".qbg-" + x)) &&
  ["rank-gold", "rank-silver", "rank-bronze", "rank-other"].every((x) => appCss.includes("." + x)));

if (errors.length) console.log("\n-- console/jsdom errors --\n" + errors.slice(0, 10).join("\n"));
console.log("\nผลรวม: " + out.filter((l) => l.startsWith("PASS")).length + "/" + out.length + " passed");
process.exit(process.exitCode || 0);
