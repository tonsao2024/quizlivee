-- ============================================================================
--  ONLIVE QUIZ — migration 0006
--  เพิ่มความสมเหตุสมผลของข้อมูลคำถาม (พบช่องว่างระหว่างทดสอบรอบที่ 11)
--
--  ปัญหาที่พบ:
--    ตาราง questions มี check แค่ "correct_index อยู่ระหว่าง 0–5"
--    และไม่ได้บังคับว่าต้องมีอย่างน้อย 2 ตัวเลือก
--    → ชุดคำถามที่บันทึกผ่าน API ตรง ๆ (หรือ import ที่ผิดรูป) อาจมี
--        • ตัวเลือก 0–1 ข้อ  (ผู้เล่นกดตอบไม่ได้)
--        • correct_index ชี้ไปนอกตัวเลือก (เฉลยไม่มีอยู่จริง)
--      ทำให้หน้าเกมพังตอนเฉลย และคะแนนคิดไม่ได้
--
--  แก้: บังคับที่ฐานข้อมูลว่า
--    options ต้องเป็น array อย่างน้อย 2 ตัว และ correct_index ต้องชี้อยู่ใน array
--
--  วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้)
--  หมายเหตุ: ไฟล์นี้จะล้มเหลวถ้ามีข้อมูลเก่าที่ผิดรูปอยู่ — ให้รันส่วนตรวจก่อน
-- ============================================================================

-- 0) ตรวจข้อมูลเก่าก่อน (ถ้าเจอ ต้องแก้ก่อนจึงจะเพิ่ม constraint ได้)
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.questions
   where jsonb_array_length(options) < 2
      or correct_index < 0
      or correct_index >= jsonb_array_length(options);
  if v_bad > 0 then
    raise exception 'พบคำถามที่ข้อมูลไม่ถูกต้อง % ข้อ — แก้ก่อนเพิ่ม constraint', v_bad;
  end if;
end $$;

-- 1) แทนที่ check เดิมของ correct_index ด้วยตัวที่ไม่ผูกกับจำนวนคงที่
alter table public.questions drop constraint if exists questions_correct_index_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'questions_options_len_chk') then
    alter table public.questions
      add constraint questions_options_len_chk
      check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_correct_in_range_chk') then
    alter table public.questions
      add constraint questions_correct_in_range_chk
      check (correct_index >= 0 and correct_index < jsonb_array_length(options));
  end if;
end $$;

-- 2) ตัวเลือกต้องเป็นข้อความ (กัน array ที่มี null/object หลุดเข้ามา)
create or replace function public.questions_options_text_chk(p_options jsonb)
returns boolean language sql immutable as $$
  select coalesce(bool_and(jsonb_typeof(v) = 'string' and length(btrim(v #>> '{}')) > 0), false)
    from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) v;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'questions_options_text_chk') then
    alter table public.questions
      add constraint questions_options_text_chk check (public.questions_options_text_chk(options));
  end if;
end $$;

-- 3) ให้ผู้เล่นที่ตอบไปแล้วเท่านั้นที่ถูกนับในสถิติ — เผื่อมี choice แปลกปลอมหลุดมา
--    (ไม่ต้องแก้อะไร: ใช้ choice ที่บันทึกไว้ตรง ๆ แต่เพิ่ม index ให้กราฟเร็วขึ้น)
create index if not exists answers_room_question_choice_idx
  on public.answers (room_id, question_id, choice);
