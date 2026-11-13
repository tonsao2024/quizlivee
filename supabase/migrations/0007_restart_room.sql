-- ============================================================================
--  ONLIVE QUIZ — migration 0007
--  "เริ่มรอบใหม่ในห้องเดิม" (host_restart_room)
--
--  ปัญหาที่พบ (ทดสอบรอบที่ 12):
--    ปุ่ม "เล่นชุดนี้อีกครั้ง" สร้าง "ห้องใหม่" (PIN ใหม่) เสมอ
--    → ผู้เข้าอบรมทุกคนต้องสแกน QR ใหม่ หรือกรอก PIN ใหม่
--      ซึ่งในห้องอบรมจริงคือความยุ่งยากที่สุดของเกม
--
--  วิธีแก้: เพิ่มฟังก์ชันเริ่มรอบใหม่บนห้องเดิม
--    • ล้างคะแนน/สตรีค/คำตอบของผู้เล่นทุกคน (คงชื่อ + ตัวละครเดิมไว้)
--    • กลับไปสถานะ lobby, current_index = -1, เวลาเป็น null
--    • PIN เดิมใช้ต่อได้ทันที ผู้เล่นกด "เล่นอีกครั้ง" บนมือถือก็กลับเข้าห้องเดิม
--    • ใช้ได้เฉพาะเจ้าของห้อง และเฉพาะห้องที่จบแล้ว (กันการล้างคะแนนกลางเกม)
-- ============================================================================

create or replace function public.host_restart_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_removed int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;
  if v_room.status <> 'ended' then return jsonb_build_object('error','not_ended'); end if;

  -- เก็บคำตอบของรอบเก่าไว้ตรวจย้อนหลังได้ แต่ตัดออกจากห้องเพื่อไม่ให้สถิติปนกัน
  delete from public.answers where room_id = v_room.id;
  get diagnostics v_removed = row_count;

  update public.players
     set score = 0, streak = 0, best_streak = 0, correct_count = 0
   where room_id = v_room.id;

  update public.rooms
     set status = 'lobby', current_index = -1, ended_at = null,
         question_started_at = null, question_ends_at = null
   where id = v_room.id;

  return jsonb_build_object('ok', true, 'status', 'lobby', 'pin', v_room.pin,
    'answers_cleared', v_removed,
    'players', (select count(*) from public.players where room_id = v_room.id));
end $$;

revoke all on function public.host_restart_room(uuid) from public, anon;
grant execute on function public.host_restart_room(uuid) to authenticated;
