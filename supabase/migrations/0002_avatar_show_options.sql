-- ============================================================================
--  ONLIVE QUIZ — migration 0002
--  1) ตัวละครผู้เล่น (avatar) + ตกแต่งได้เองระหว่างรอในห้องรอ
--  2) ผู้จัดเลือกได้: แสดงข้อความตัวเลือก หรือ แสดงแค่สัญลักษณ์สี
--  3) คิว "ผู้เล่นเข้าห้อง" ให้จอผู้จัดเล่นเอฟเฟคชื่อเด้งได้แม่นยำ
--
--  วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
--  ปลอดภัยเมื่อรันซ้ำ (idempotent)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) คอลัมน์ใหม่
-- ----------------------------------------------------------------------------
alter table public.players
  add column if not exists avatar jsonb not null default '{}'::jsonb;

alter table public.rooms
  add column if not exists show_options text not null default 'text';

-- ค่า: 'text' = แสดงข้อความตัวเลือก, 'shape' = แสดงแค่สัญลักษณ์สี
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_show_options_chk') then
    alter table public.rooms
      add constraint rooms_show_options_chk check (show_options in ('text','shape'));
  end if;
end $$;

create index if not exists players_room_joined_idx on public.players(room_id, joined_at);

-- ----------------------------------------------------------------------------
-- 2) ตัวสร้างสถานะห้อง — เพิ่ม avatar / show_options / เหตุการณ์เข้าห้อง
-- ----------------------------------------------------------------------------
create or replace function public._room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room public.rooms; v_quiz public.quizzes; v_q public.questions;
  v_qcount int; v_pcount int; v_dist jsonb; v_out jsonb; v_lb jsonb; v_joined jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  select * into v_quiz from public.quizzes where id = v_room.quiz_id;
  select count(*) into v_qcount from public.questions where quiz_id = v_room.quiz_id;
  select count(*) into v_pcount from public.players where room_id = v_room.id;
  v_out := jsonb_build_object(
    'room_id', v_room.id, 'pin', v_room.pin, 'status', v_room.status, 'current_index', v_room.current_index,
    'question_count', v_qcount, 'player_count', v_pcount,
    'quiz_title', coalesce(v_quiz.title,'Quiz'), 'quiz_emoji', coalesce(v_quiz.emoji,'🎯'),
    'show_options', coalesce(v_room.show_options,'text'),
    'server_now', now(), 'question_started_at', v_room.question_started_at,
    'question_ends_at', v_room.question_ends_at, 'allow_late', v_room.allow_late);

  -- ผู้เล่น 10 คนล่าสุด (ให้จอผู้จัดเล่นเอฟเฟค "ชื่อเด้งเข้ามา")
  select coalesce(jsonb_agg(to_jsonb(t) order by t.joined_at asc), '[]'::jsonb) into v_joined from (
    select id, nickname, avatar, joined_at from public.players
     where room_id = v_room.id order by joined_at desc limit 10) t;
  v_out := v_out || jsonb_build_object('recent_players', coalesce(v_joined,'[]'::jsonb));

  if v_room.current_index >= 0 then
    select * into v_q from public.questions where quiz_id = v_room.quiz_id and position = v_room.current_index;
  end if;

  if v_q.id is not null then
    v_out := v_out || jsonb_build_object('question', jsonb_build_object(
      'id', v_q.id, 'index', v_q.position, 'prompt', v_q.prompt, 'image_url', v_q.image_url,
      'options', v_q.options, 'time_limit', v_q.time_limit, 'points', v_q.points));
    if v_room.status in ('reveal','leaderboard','ended') then
      select coalesce(jsonb_object_agg(s.choice::text, s.n), '{}'::jsonb) into v_dist
        from (select choice, count(*) as n from public.answers
               where room_id = v_room.id and question_id = v_q.id group by choice) s;
      v_out := v_out || jsonb_build_object('correct_index', v_q.correct_index,
                                           'distribution', coalesce(v_dist,'{}'::jsonb));
    end if;
  end if;

  if v_room.status = 'ended' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_lb from (
      select row_number() over (order by score desc, joined_at asc) as rank,
             nickname, score, streak, correct_count, avatar
        from public.players where room_id = v_room.id order by score desc, joined_at asc limit 20) t;
    v_out := v_out || jsonb_build_object('final_leaderboard', v_lb);
  end if;

  return v_out;
end $$;

-- ----------------------------------------------------------------------------
-- 3) เข้าห้อง + ฝากตัวละคร
-- ----------------------------------------------------------------------------
create or replace function public.join_room(p_pin text, p_nickname text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_player public.players; v_name text;
begin
  select * into v_room from public.rooms
   where pin = trim(p_pin) and status <> 'ended' order by created_at desc limit 1;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;

  v_name := trim(regexp_replace(coalesce(p_nickname,''), '\s+', ' ', 'g'));
  if length(v_name) < 1 then return jsonb_build_object('error','nickname_required'); end if;
  if length(v_name) > 24 then v_name := left(v_name, 24); end if;

  if v_room.status <> 'lobby' then
    select * into v_player from public.players
     where room_id = v_room.id and lower(nickname) = lower(v_name) limit 1;
    if v_player is not null then
      if p_avatar is not null then
        update public.players set avatar = p_avatar where id = v_player.id returning * into v_player;
      end if;
      return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
        'nickname', v_player.nickname, 'avatar', v_player.avatar, 'rejoined', true);
    end if;
    if not v_room.allow_late then return jsonb_build_object('error','game_started'); end if;
  end if;

  begin
    insert into public.players (room_id, nickname, avatar)
    values (v_room.id, v_name, coalesce(p_avatar, '{}'::jsonb))
    returning * into v_player;
  exception when unique_violation then
    return jsonb_build_object('error','nickname_taken');
  end;

  return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
    'nickname', v_player.nickname, 'avatar', v_player.avatar, 'rejoined', false,
    'state', public.room_public_state(v_room.pin));
end $$;

-- ผู้เล่นแก้ไขตัวละครของตัวเองได้ (ระหว่างรอ/ระหว่างเกม)
create or replace function public.set_avatar(p_token uuid, p_avatar jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_player public.players; v_room public.rooms;
begin
  select * into v_player from public.players where token = p_token;
  if v_player is null then return jsonb_build_object('error','player_not_found'); end if;
  select * into v_room from public.rooms where id = v_player.room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.status = 'ended' then return jsonb_build_object('error','game_ended'); end if;

  update public.players set avatar = coalesce(p_avatar, '{}'::jsonb)
   where id = v_player.id returning * into v_player;
  return jsonb_build_object('ok', true, 'avatar', v_player.avatar);
end $$;

-- ----------------------------------------------------------------------------
-- 4) กระดานคะแนน + resume: ส่ง avatar มาด้วย
-- ----------------------------------------------------------------------------
create or replace function public.player_resume(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_player public.players; v_state jsonb; v_qid uuid; v_rank int;
begin
  select * into v_player from public.players where token = p_token;
  if v_player is null then return jsonb_build_object('error','player_not_found'); end if;
  v_state := public._room_state(v_player.room_id);
  if v_state ? 'error' then return v_state; end if;
  v_qid := (v_state->'question'->>'id')::uuid;
  select count(*) + 1 into v_rank from public.players
   where room_id = v_player.room_id and score > v_player.score;
  return jsonb_build_object(
    'player', jsonb_build_object('id', v_player.id, 'nickname', v_player.nickname, 'score', v_player.score,
      'streak', v_player.streak, 'correct_count', v_player.correct_count, 'rank', v_rank,
      'avatar', v_player.avatar),
    'answered_current', case when v_qid is null then false else exists (
      select 1 from public.answers a where a.player_id = v_player.id and a.question_id = v_qid) end,
    'state', v_state);
end $$;

create or replace function public.room_leaderboard(p_pin text, p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_rows jsonb;
begin
  select * into v_room from public.rooms
   where pin = trim(p_pin) and status <> 'ended' order by created_at desc limit 1;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select row_number() over (order by score desc, joined_at asc) as rank,
           nickname, score, streak, correct_count, avatar
      from public.players where room_id = v_room.id order by score desc, joined_at asc
     limit greatest(1, least(coalesce(p_limit, 10), 100))) t;
  return jsonb_build_object('players', v_rows,
    'total', (select count(*) from public.players where room_id = v_room.id));
end $$;

-- ----------------------------------------------------------------------------
-- 5) snapshot ของผู้จัด — เพิ่ม avatar ในรายชื่อผู้เล่น
-- ----------------------------------------------------------------------------
create or replace function public.host_snapshot(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_quiz public.quizzes; v_q public.questions;
        v_players jsonb; v_state jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;
  select * into v_quiz from public.quizzes where id = v_room.quiz_id;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.score desc), '[]'::jsonb) into v_players from (
    select id, nickname, score, streak, correct_count, joined_at, avatar from public.players
     where room_id = v_room.id order by score desc, joined_at asc limit 500) t;
  if v_room.current_index >= 0 then
    select * into v_q from public.questions
     where quiz_id = v_room.quiz_id and position = v_room.current_index;
  end if;
  v_state := public._room_state(v_room.id);
  v_state := v_state || jsonb_build_object('players', v_players, 'quiz_id', v_room.quiz_id,
    'host_room_id', v_room.id);
  if v_q.id is not null then
    v_state := v_state || public.host_question_stats(p_room_id, v_q.id)
                       || jsonb_build_object('correct_index', v_q.correct_index);
  end if;
  return v_state;
end $$;

-- ----------------------------------------------------------------------------
-- 6) ผู้จัดตั้งค่า "แสดงตัวเลือก" (ข้อความ / สัญลักษณ์สี)
-- ----------------------------------------------------------------------------
create or replace function public.host_set_show_options(p_room_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;
  if p_mode not in ('text','shape') then return jsonb_build_object('error','bad_mode'); end if;
  update public.rooms set show_options = p_mode where id = p_room_id;
  return jsonb_build_object('ok', true, 'show_options', p_mode);
end $$;

-- ----------------------------------------------------------------------------
-- 7) สิทธิ์การเรียกใช้
-- ----------------------------------------------------------------------------
drop function if exists public.join_room(text, text);

revoke all on function public.join_room(text, text, jsonb) from public;
revoke all on function public.set_avatar(uuid, jsonb) from public;
revoke all on function public.host_set_show_options(uuid, text) from public, anon;

grant execute on function public.join_room(text, text, jsonb) to anon, authenticated;
grant execute on function public.set_avatar(uuid, jsonb) to anon, authenticated;
grant execute on function public.host_set_show_options(uuid, text) to authenticated;
