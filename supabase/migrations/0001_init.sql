-- ============================================================================
--  ONLIVE QUIZ — schema, RLS และ business logic ทั้งหมด (ฉบับที่ deploy จริง)
--  วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
--  หลักการสำคัญ: เฉลย + คะแนน คำนวณในฐานข้อมูลเท่านั้น ฝั่งผู้เล่นมองไม่เห็นคำตอบที่ถูก
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) คลังคำถาม (เจ้าของ = ผู้สร้าง/แอดมิน)
-- ----------------------------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  emoji       text default '🎯',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  position      int  not null default 0,
  prompt        text not null,
  image_url     text,
  options       jsonb not null default '[]'::jsonb,
  correct_index int  not null default 0 check (correct_index between 0 and 5),
  time_limit    int  not null default 20 check (time_limit between 5 and 300),
  points        int  not null default 1000 check (points between 100 and 4000),
  created_at    timestamptz not null default now()
);
create index if not exists questions_quiz_idx on public.questions(quiz_id, position);

-- ----------------------------------------------------------------------------
-- 2) ห้องเล่นสด / ผู้เล่น / คำตอบ
-- ----------------------------------------------------------------------------
create table if not exists public.rooms (
  id                  uuid primary key default gen_random_uuid(),
  pin                 text not null,
  quiz_id             uuid not null references public.quizzes(id) on delete cascade,
  host_id             uuid not null references auth.users(id) on delete cascade,
  status              text not null default 'lobby',  -- lobby|question|reveal|leaderboard|ended
  current_index       int  not null default -1,
  question_started_at timestamptz,
  question_ends_at    timestamptz,
  allow_late          boolean not null default false,
  created_at          timestamptz not null default now(),
  ended_at            timestamptz,
  constraint rooms_status_chk check (status in ('lobby','question','reveal','leaderboard','ended'))
);
-- PIN ใช้ซ้ำได้หลังห้องจบไปแล้ว
create unique index if not exists rooms_pin_active_uidx on public.rooms(pin) where status <> 'ended';
create index if not exists rooms_host_idx on public.rooms(host_id, created_at desc);

create table if not exists public.players (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  nickname      text not null check (length(trim(nickname)) between 1 and 24),
  token         uuid not null default gen_random_uuid(),
  score         int  not null default 0,
  streak        int  not null default 0,
  best_streak   int  not null default 0,
  correct_count int  not null default 0,
  joined_at     timestamptz not null default now()
);
create unique index if not exists players_room_nick_uidx on public.players(room_id, lower(nickname));
create unique index if not exists players_token_uidx on public.players(token);
create index if not exists players_room_score_idx on public.players(room_id, score desc);

create table if not exists public.answers (
  id          bigserial primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  choice      int  not null,
  is_correct  boolean not null,
  points      int  not null default 0,
  response_ms int  not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists answers_player_question_uidx on public.answers(player_id, question_id);
create index if not exists answers_room_question_idx on public.answers(room_id, question_id);

-- ----------------------------------------------------------------------------
-- 3) RLS
-- ----------------------------------------------------------------------------
alter table public.quizzes   enable row level security;
alter table public.questions enable row level security;
alter table public.rooms     enable row level security;
alter table public.players   enable row level security;
alter table public.answers   enable row level security;

drop policy if exists quizzes_owner on public.quizzes;
create policy quizzes_owner on public.quizzes for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists questions_owner on public.questions;
create policy questions_owner on public.questions for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

-- ผู้เล่น (anon) อ่านสถานะห้องได้ แต่แก้ไม่ได้เลย
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to anon, authenticated using (true);
drop policy if exists rooms_host_update on public.rooms;
create policy rooms_host_update on public.rooms for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists rooms_host_delete on public.rooms;
create policy rooms_host_delete on public.rooms for delete to authenticated using (host_id = auth.uid());

-- players / answers: เขียนผ่าน RPC เท่านั้น, อ่านได้เฉพาะเจ้าของห้อง (token ผู้เล่นจะได้ไม่รั่ว)
drop policy if exists players_host_read on public.players;
create policy players_host_read on public.players for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.host_id = auth.uid()));

drop policy if exists answers_host_read on public.answers;
create policy answers_host_read on public.answers for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.host_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 4) ตัวสร้างสถานะห้อง (ใช้ภายในเท่านั้น) — ไม่ส่ง correct_index ออกไปตอนกำลังถาม
-- ----------------------------------------------------------------------------
create or replace function public._room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room public.rooms; v_quiz public.quizzes; v_q public.questions;
  v_qcount int; v_pcount int; v_dist jsonb; v_out jsonb; v_lb jsonb;
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
    'server_now', now(), 'question_started_at', v_room.question_started_at,
    'question_ends_at', v_room.question_ends_at, 'allow_late', v_room.allow_late);

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
             nickname, score, streak, correct_count
        from public.players where room_id = v_room.id order by score desc, joined_at asc limit 20) t;
    v_out := v_out || jsonb_build_object('final_leaderboard', v_lb);
  end if;

  return v_out;
end $$;

-- สถานะห้องจาก PIN (ใช้ตอนเข้าห้อง/ซิงก์ระหว่างเล่น — เฉพาะห้องที่ยังไม่จบ)
create or replace function public.room_public_state(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.rooms
   where pin = trim(p_pin) and status <> 'ended' order by created_at desc limit 1;
  if v_id is null then return jsonb_build_object('error','room_not_found'); end if;
  return public._room_state(v_id);
end $$;

-- ----------------------------------------------------------------------------
-- 5) ผู้เล่น: เข้าห้อง / กลับเข้าห้อง / ส่งคำตอบ
-- ----------------------------------------------------------------------------
create or replace function public.join_room(p_pin text, p_nickname text)
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
      return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
        'nickname', v_player.nickname, 'rejoined', true);
    end if;
    if not v_room.allow_late then return jsonb_build_object('error','game_started'); end if;
  end if;

  begin
    insert into public.players (room_id, nickname) values (v_room.id, v_name) returning * into v_player;
  exception when unique_violation then
    return jsonb_build_object('error','nickname_taken');
  end;

  return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
    'nickname', v_player.nickname, 'rejoined', false, 'state', public.room_public_state(v_room.pin));
end $$;

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
      'streak', v_player.streak, 'correct_count', v_player.correct_count, 'rank', v_rank),
    'answered_current', case when v_qid is null then false else exists (
      select 1 from public.answers a where a.player_id = v_player.id and a.question_id = v_qid) end,
    'state', v_state);
end $$;

create or replace function public.submit_answer(p_token uuid, p_question_id uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_player public.players; v_room public.rooms; v_q public.questions;
  v_correct boolean; v_points int; v_ms int; v_ratio numeric; v_streak int; v_bonus int; v_rank int;
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

create or replace function public.room_leaderboard(p_pin text, p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_rows jsonb;
begin
  select * into v_room from public.rooms
   where pin = trim(p_pin) and status <> 'ended' order by created_at desc limit 1;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select row_number() over (order by score desc, joined_at asc) as rank,
           nickname, score, streak, correct_count
      from public.players where room_id = v_room.id order by score desc, joined_at asc
     limit greatest(1, least(coalesce(p_limit, 10), 100))) t;
  return jsonb_build_object('players', v_rows,
    'total', (select count(*) from public.players where room_id = v_room.id));
end $$;

-- ----------------------------------------------------------------------------
-- 6) แอดมิน/พิธีกร: สร้างห้อง และคุมเกม (ทุกฟังก์ชันตรวจเจ้าของห้อง)
-- ----------------------------------------------------------------------------
create or replace function public.create_room(p_quiz_id uuid, p_allow_late boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pin text; v_id uuid; v_attempt int := 0;
begin
  if auth.uid() is null then return jsonb_build_object('error','not_authenticated'); end if;
  if not exists (select 1 from public.quizzes where id = p_quiz_id and owner_id = auth.uid()) then
    return jsonb_build_object('error','quiz_not_found');
  end if;
  if not exists (select 1 from public.questions where quiz_id = p_quiz_id) then
    return jsonb_build_object('error','quiz_empty');
  end if;
  loop
    v_attempt := v_attempt + 1;
    v_pin := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.rooms where pin = v_pin and status <> 'ended');
    if v_attempt >= 50 then return jsonb_build_object('error','pin_unavailable'); end if;
  end loop;
  insert into public.rooms (pin, quiz_id, host_id, allow_late)
  values (v_pin, p_quiz_id, auth.uid(), p_allow_late) returning id into v_id;
  return jsonb_build_object('room_id', v_id, 'pin', v_pin,
    'quiz_title', (select title from public.quizzes where id = p_quiz_id));
end $$;

create or replace function public.host_next_question(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_q public.questions; v_next int; v_count int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;

  select count(*) into v_count from public.questions where quiz_id = v_room.quiz_id;
  v_next := v_room.current_index + 1;

  if v_next >= v_count then
    update public.rooms set status = 'ended', ended_at = now() where id = v_room.id;
    return jsonb_build_object('finished', true, 'question_count', v_count);
  end if;

  select * into v_q from public.questions where quiz_id = v_room.quiz_id and position = v_next;

  -- เวลาเริ่ม/หมดเวลา กำหนดที่เซิร์ฟเวอร์ เพื่อความเป็นธรรมทุกเครื่อง
  update public.rooms set
    status = 'question', current_index = v_next,
    question_started_at = now(),
    question_ends_at = now() + make_interval(secs => v_q.time_limit)
  where id = v_room.id;

  return jsonb_build_object('finished', false, 'question_count', v_count,
    'question_started_at', now(), 'question_ends_at', now() + make_interval(secs => v_q.time_limit),
    'question', jsonb_build_object('id', v_q.id, 'index', v_q.position, 'prompt', v_q.prompt,
      'image_url', v_q.image_url, 'options', v_q.options, 'time_limit', v_q.time_limit,
      'points', v_q.points, 'correct_index', v_q.correct_index));
end $$;

create or replace function public.host_question_stats(p_room_id uuid, p_question_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_dist jsonb; v_n int; v_c int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;
  select coalesce(jsonb_object_agg(s.choice::text, s.n), '{}'::jsonb) into v_dist
    from (select choice, count(*) n from public.answers
           where room_id = p_room_id and question_id = p_question_id group by choice) s;
  select count(*) into v_n from public.answers where room_id = p_room_id and question_id = p_question_id;
  select count(*) into v_c from public.answers
   where room_id = p_room_id and question_id = p_question_id and is_correct;
  return jsonb_build_object('answered', v_n, 'correct', v_c,
    'distribution', coalesce(v_dist, '{}'::jsonb));
end $$;

create or replace function public.host_set_status(p_room_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  if v_room.host_id is distinct from auth.uid() then return jsonb_build_object('error','forbidden'); end if;
  if p_status not in ('lobby','question','reveal','leaderboard','ended') then
    return jsonb_build_object('error','bad_status');
  end if;
  update public.rooms set status = p_status,
    ended_at = case when p_status = 'ended' then now() else ended_at end
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

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
    select id, nickname, score, streak, correct_count, joined_at from public.players
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
-- 7) สิทธิ์การเรียกใช้ฟังก์ชัน
-- ----------------------------------------------------------------------------
revoke all on function public._room_state(uuid) from public, anon, authenticated;
revoke all on function public.room_public_state(text) from public;
revoke all on function public.join_room(text, text) from public;
revoke all on function public.player_resume(uuid) from public;
revoke all on function public.submit_answer(uuid, uuid, int) from public;
revoke all on function public.room_leaderboard(text, int) from public;
revoke all on function public.create_room(uuid, boolean) from public, anon;
revoke all on function public.host_next_question(uuid) from public, anon;
revoke all on function public.host_set_status(uuid, text) from public, anon;
revoke all on function public.host_question_stats(uuid, uuid) from public, anon;
revoke all on function public.host_snapshot(uuid) from public, anon;

grant execute on function public.room_public_state(text) to anon, authenticated;
grant execute on function public.join_room(text, text) to anon, authenticated;
grant execute on function public.player_resume(uuid) to anon, authenticated;
grant execute on function public.submit_answer(uuid, uuid, int) to anon, authenticated;
grant execute on function public.room_leaderboard(text, int) to anon, authenticated;
grant execute on function public.create_room(uuid, boolean) to authenticated;
grant execute on function public.host_next_question(uuid) to authenticated;
grant execute on function public.host_set_status(uuid, text) to authenticated;
grant execute on function public.host_question_stats(uuid, uuid) to authenticated;
grant execute on function public.host_snapshot(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8) trigger: updated_at ของ quizzes
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
  for each row execute function public.touch_updated_at();
