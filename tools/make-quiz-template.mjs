#!/usr/bin/env node
/**
 * สร้างไฟล์เทมเพลท Excel สำหรับนำเข้าคำถาม
 *
 *   node tools/make-quiz-template.mjs
 *
 * ผลลัพธ์: docs/samples/quiz-template.xlsx (มี 2 ชีต — คำถาม / คำแนะนำ)
 * ใช้ไลบรารีเดียวกับที่หน้าเว็บใช้ (docs/assets/js/vendor/xlsx.mini.min.js)
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const XLSX = require(path.join(root, "docs/assets/js/vendor/xlsx.mini.min.js"));

const HEADER = ["question", "option1", "option2", "option3", "option4", "option5", "option6",
  "correct", "time_limit", "points", "image_url", "show_options", "background"];

const ROWS = [
  ["ข้อใดคือเมืองหลวงของประเทศไทย", "เชียงใหม่", "กรุงเทพมหานคร", "ขอนแก่น", "ภูเก็ต", "", "", "2", "20", "1000", "", ""],
  ["สำนักงาน ป.ป.ช. ย่อมาจากอะไร", "สำนักงานป้องกันและปราบปรามยาเสพติด", "สำนักงานคณะกรรมการป้องกันและปราบปรามการทุจริตแห่งชาติ", "สำนักงานตรวจเงินแผ่นดิน", "สำนักงานคณะกรรมการสิทธิมนุษยชน", "", "", "2", "20", "1000", "", ""],
  ["1 + 1 เท่ากับเท่าไร", "1", "2", "3", "4", "", "", "2", "10", "1000", "", ""],
  ["ข้อใดคือช่องทางรับแจ้งเบาะแสการทุจริตของ ป.ป.ช.", "สายด่วน 1205", "สายด่วน 191", "สายด่วน 1111", "สายด่วน 1300", "", "", "1", "20", "1000", "", ""],
  ["การกระทำใดถือเป็นการทุจริต", "การรับของขวัญตามประเพณี", "การเรียกผลประโยชน์เพื่อแลกกับการอนุมัติ", "การทำงานล่วงเวลา", "การอบรมสัมมนา", "", "", "2", "25", "1000", "", ""],
];

const GUIDE = [
  ["คอลัมน์", "ความหมาย", "ค่าที่ใช้ได้"],
  ["question", "โจทย์คำถาม (จำเป็น)", "ข้อความ"],
  ["option1 … option6", "ตัวเลือก 2–6 ข้อ (จำเป็นอย่างน้อย 2)", "ข้อความ"],
  ["correct", "ตัวเลือกที่ถูก (จำเป็น)", "เลข 1–6 หรือ A–F หรือข้อความของตัวเลือกนั้น"],
  ["time_limit", "เวลาตอบต่อข้อ (วินาที)", "5–300 (ค่าเริ่มต้น 20)"],
  ["points", "คะแนนเต็มของข้อ", "100–4000 (ค่าเริ่มต้น 1000)"],
  ["image_url", "ลิงก์รูปประกอบ (ไม่บังคับ)", "https://…"],
  ["show_options", "การแสดงตัวเลือกบนจอผู้เล่น (ไม่บังคับ)", "text = ข้อความครบ · shape = สัญลักษณ์สีเท่านั้น (เว้นว่าง = ตามที่ผู้จัดตั้งไว้)"],
  ["background", "ธีมพื้นหลังคำถาม (ไม่บังคับ)", "aurora / sunset / ocean / forest / galaxy / candy / midnight / coral / mint / gold"],
  ["", "", ""],
  ["วิธีใช้", "กรอกข้อมูลในชีต “คำถาม” แถวละ 1 ข้อ แล้วบันทึกเป็น .xlsx", "ห้ามเปลี่ยนชื่อคอลัมน์ในแถวแรก"],
  ["หมายเหตุ", "ระบบอ่านคอลัมน์ตามชื่อ — ถ้าใช้หัวตารางภาษาไทย (คำถาม/ตัวเลือก1/เฉลย/เวลา/คะแนน) ก็ได้", ""],
  ["ตัวอย่าง", "ห้ามลบชีตนี้ก็ได้ ไม่มีผลกับการนำเข้า (ระบบอ่านชีตแรกที่มีข้อมูล)", ""],
];

const wb = XLSX.utils.book_new();

const ws = XLSX.utils.aoa_to_sheet([HEADER, ...ROWS]);
ws["!cols"] = [{ wch: 46 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 },
  { wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 30 }, { wch: 16 }];
ws["!freeze"] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws, "คำถาม");

const gs = XLSX.utils.aoa_to_sheet(GUIDE);
gs["!cols"] = [{ wch: 18 }, { wch: 62 }, { wch: 52 }];
XLSX.utils.book_append_sheet(wb, gs, "คำแนะนำ");

const out = path.join(root, "docs/samples/quiz-template.xlsx");
// ไลบรารีตัวที่ฝังในเว็บเป็นบิลด์สำหรับเบราว์เซอร์ — เขียนไฟล์เองผ่าน buffer
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
fs.writeFileSync(out, buf);
console.log("เขียนไฟล์แล้ว:", path.relative(root, out));
