-- ============================================================================
--  ONLIVE QUIZ — migration 0003
--  แก้บั๊กที่พบจากการทดสอบ E2E:
--   • submit_answer ยอมรับตัวเลือกที่อยู่นอกช่วง (เช่น 9 ทั้งที่มี 4 ตัวเลือก)
--     ทำให้เกิดแถวคำตอบเสียและตัวเลข "ตอบแล้ว" ไม่ตรงกับกราฟสัดส่วน
--  เพิ่มการตรวจ choice ให้อยู่ในช่วง 0 .. จำนวนตัวเลือก-1
--
--  วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
--  ปลอดภัยเมื่อรันซ้ำ (idempotent)
-- ============================================================================

create or replace function public.submit_answer(p_token uuid, p_question_id uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_player public.players; v_room public.rooms; v_q public.questions;
  v_correct boolean; v_points int; v_ms int; v_ratio numeric; v_streak int; v_bonus int; v_rank int;
  v_nchoices int;
begin
  -- ล็อกแถวผู้เล่นกันการกดซ้ำพร้อมกัน (double submit)
  select * into v_player from public.players where token = p_token for update;
  if v_player is null then return jsonb_build_object('error','player_not_found'); end if;

  select * into v_room from public.rooms where id = v_player.room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;

  select * into v_q from public.questions where id = p_question_id and quiz_id = v_room.quiz_id;
  if v_q.id is null then return jsonb_build_object('error','question_not_found'); end if;

  if v_room.status <> 'question' or v_room.current_index <> v_q.position then
    return jsonb_build_object('error','not_open');
  end if;
  if exists (select 1 from public.answers a where a.player_id = v_player.id and a.question_id = v_q.id) then
    return jsonb_build_object('error','already_answered');
  end if;

  -- ตรวจว่าตัวเลือกที่ส่งมาอยู่ในช่วงจริงของข้อนี้
  v_nchoices := coalesce(jsonb_array_length(v_q.options), 0);
  if p_choice is null or p_choice < 0 or p_choice >= v_nchoices then
    return jsonb_build_object('error','bad_choice');
  end if;

  v_ms := greatest(0, (extract(epoch from (v_room.question_ends_at - now())) * 1000)::int);
  if v_ms <= 0 then return jsonb_build_object('error','time_up'); end if;

  v_correct := (p_choice = v_q.correct_index);
  v_ratio   := least(1, v_ms::numeric / (v_q.time_limit * 1000));
  -- เร็วได้คะแนนมากกว่า: 55% ของคะแนนเต็ม + สูงสุดอีก 45% ตามความเร็ว
  v_points  := case when v_correct then round(v_q.points * (0.55 + 0.45 * v_ratio))::int else 0 end;
  v_streak  := case when v_correct then v_player.streak + 1 else 0 end;
  v_bonus   := case when v_streak >= 3 and v_correct then 100 else 0 end;  -- โบนัสสตรีค

  insert into public.answers (room_id, player_id, question_id, choice, is_correct, points, response_ms)
  values (v_room.id, v_player.id, v_q.id, p_choice, v_correct, v_points + v_bonus,
          (v_q.time_limit * 1000) - v_ms);

  update public.players set
    score         = score + v_points + v_bonus,
    streak        = v_streak,
    best_streak   = greatest(best_streak, v_streak),
    correct_count = correct_count + case when v_correct then 1 else 0 end
  where id = v_player.id
  returning score into v_player.score;

  select count(*) + 1 into v_rank from public.players
   where room_id = v_player.room_id and score > v_player.score;

  return jsonb_build_object('is_correct', v_correct, 'points', v_points + v_bonus,
    'streak', v_streak, 'score', v_player.score, 'rank', v_rank);
end $$;

revoke all on function public.submit_answer(uuid, uuid, int) from public;
grant execute on function public.submit_answer(uuid, uuid, int) to anon, authenticated;
