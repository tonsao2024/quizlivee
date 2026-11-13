/* การตั้งค่าระบบ — แก้ไฟล์นี้ไฟล์เดียวเมื่อเปลี่ยนโปรเจกต์ Supabase
 *
 * ใช้ได้ทั้ง GitHub Pages, Vercel และเปิดในเครื่อง (file:// หรือ localhost)
 * หากเปิดผ่านโดเมนใด QR ปลายทางจะชี้โดเมนนั้นอัตโนมัติ (เว้นแต่ตั้ง PUBLIC_URL ไว้)
 */
window.QUIZ_CONFIG = {
  // URL โปรเจกต์ Supabase (ไม่ต้องมี / ปิดท้าย)
  SUPABASE_URL: "https://jxnaazamdiyxpfxqnmgv.supabase.co",
  // anon / publishable key — เปิดเผยได้ ปลอดภัยเพราะสิทธิ์จริงถูกคุมด้วย RLS ฝั่งฐานข้อมูล
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4bmFhemFtZGl5eHBmeHFubWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzODAwOTUsImV4cCI6MjEwOTk1NjA5NX0.HHjkjFLaC5doRl2yqyEjZ_mNfmjpfRJ5ClMiDO5IrZo",
  // ปล่อยว่าง = ใช้โดเมนที่เปิดหน้าเว็บอยู่ (ใช้สร้าง QR ให้ผู้เข้าอบรม)
  // บน Vercel ปล่อยว่างได้เลย — QR จะชี้ *.vercel.app ของโปรเจกต์นี้เอง
  PUBLIC_URL: "",
  APP_NAME: "ONLIVE QUIZ",

  // ---- เสียง (สังเคราะห์เองด้วย Web Audio ไม่มีไฟล์เสียงให้โหลด) ----
  // ทุกค่ายังเปิด/ปิดบนหน้าเว็บได้ และค่าที่ผู้ใช้เลือกจะถูกจำใน localStorage
  SOUND: {
    on: true,             // เปิดเสียงทั้งระบบเมื่อเข้าใช้ครั้งแรก
    music: true,          // เพลงพื้นหลัง (ห้องรอ/กระดานคะแนน = ชิล ๆ, ตอนตอบ = ตื่นเต้น)
    fx: true,             // เอฟเฟค (เข้าห้อง/เฉลย/ถูก/ผิด/หมดเวลา/แชมป์)
    volume: 0.8,          // ความดังรวม 0–1
    tickFromSeconds: 300, // เสียงนาฬิกาในช่วง N วินาทีสุดท้ายของแต่ละข้อ (300 = 5 นาทีสุดท้าย)
    pack: "chill"         // แพ็กเพลงพื้นหลัง: chill | tension | gentle
  }
};
