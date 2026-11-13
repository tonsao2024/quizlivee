-- ============================================================================
--  ONLIVE QUIZ — migration 0004
--  แก้บั๊กที่พบจากการทดสอบ E2E:
--   host_set_status เดิมยอมให้เปลี่ยนสถานะย้อนกลับได้อิสระ
--   เช่น "ended" → "lobby" (เปิดห้องที่จบแล้วกลับมาเล่นใหม่ทั้งที่ ended_at ถูกตั้งไว้)
--   และ "lobby" → "leaderboard" (ข้ามด่าน)
--
--  กติกาใหม่ (state machine):
--     lobby        → question
--     question     → reveal | leaderboard
--     reveal       → question | leaderboard | ended
--     leaderboard  → question | reveal | ended | lobby(เฉพาะที่ยังไม่จบ)
--     ended        → ended เท่านั้น (ต้องสร้างห้องใหม่)
--
--  วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้)
-- ============================================================================

create or replace function public.host_set_status(p_room_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_allowed text[];
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;
  if p_status not in ('lobby','question','reveal','leaderboard','ended') then
    return jsonb_build_object('error','bad_status');
  end if;

  -- สถานะที่ไปได้จากสถานะปัจจุบัน
  v_allowed := case v_room.status
    when 'lobby'       then array['question','lobby']
    when 'question'    then array['reveal','leaderboard','ended']
    when 'reveal'      then array['question','leaderboard','ended','reveal']
    when 'leaderboard' then array['question','reveal','ended','leaderboard']
    else array['ended']                                   -- ended = จบถาวร
  end;

  if not (p_status = any(v_allowed)) then
    return jsonb_build_object('error','bad_transition',
      'from', v_room.status, 'to', p_status);
  end if;

  update public.rooms set status = p_status,
    ended_at = case when p_status = 'ended' then coalesce(ended_at, now()) else ended_at end
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

revoke all on function public.host_set_status(uuid, text) from public, anon;
grant execute on function public.host_set_status(uuid, text) to authenticated;
