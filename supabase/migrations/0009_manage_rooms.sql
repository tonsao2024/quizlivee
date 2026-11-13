-- ============================================================================
--  ONLIVE QUIZ — migration 0009
--  จัดการห้องจากหน้าห้องทำงาน (ชุดคำถามของฉัน)
--
--  ปัญหาที่พบ:
--    สร้างห้องจากชุดคำถามแล้ว ลบ/ปิดห้องไม่ได้ (ไม่มีปุ่มและไม่มีฟังก์ชัน)
--    host_set_status เปลี่ยน lobby → ended ไม่ได้ตาม state machine จึงปิดห้อง
--    ที่ยังรอผู้เล่นอยู่ไม่ได้เลย
--
--  วิธีแก้: เพิ่ม 2 ฟังก์ชันที่ตรวจเจ้าของห้องให้แล้ว
--    • host_close_room(p_room_id)  → ปิดห้องทุกสถานะ (ตั้งเป็น ended)
--    • host_delete_room(p_room_id) → ลบห้องพร้อมผู้เล่น/คะแนน/คำตอบ (ON DELETE CASCADE)
--  ทั้งคู่ใช้ได้เฉพาะเจ้าของห้องที่เข้าสู่ระบบ (host_id = auth.uid())
--  วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้)
-- ============================================================================

create or replace function public.host_close_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;

  update public.rooms
     set status = 'ended', ended_at = coalesce(ended_at, now())
   where id = v_room.id;

  return jsonb_build_object('ok', true, 'status', 'ended', 'pin', v_room.pin,
    'players', (select count(*) from public.players where room_id = v_room.id));
end $$;

revoke all on function public.host_close_room(uuid) from public, anon;
grant execute on function public.host_close_room(uuid) to authenticated;

create or replace function public.host_delete_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_players int; v_answers int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;

  select count(*) into v_players from public.players where room_id = v_room.id;
  select count(*) into v_answers from public.answers where room_id = v_room.id;

  -- answers / players อ้าง rooms(id) แบบ ON DELETE CASCADE อยู่แล้ว
  delete from public.rooms where id = v_room.id;

  return jsonb_build_object('ok', true, 'deleted', true, 'pin', v_room.pin,
    'players_removed', v_players, 'answers_removed', v_answers);
end $$;

revoke all on function public.host_delete_room(uuid) from public, anon;
grant execute on function public.host_delete_room(uuid) to authenticated;
