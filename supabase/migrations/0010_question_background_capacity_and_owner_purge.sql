-- ONLIVE QUIZ — backgrounds, player caps, owner-scoped data purge.
-- Run after migrations 0001–0009. Idempotent; does not delete existing data.

alter table public.quizzes
  add column if not exists max_players integer not null default 0;
alter table public.rooms
  add column if not exists max_players integer not null default 0;
alter table public.questions
  add column if not exists background text not null default 'aurora';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='quizzes_max_players_chk') then
    alter table public.quizzes add constraint quizzes_max_players_chk check (max_players between 0 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname='rooms_max_players_chk') then
    alter table public.rooms add constraint rooms_max_players_chk check (max_players between 0 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname='questions_background_chk') then
    alter table public.questions add constraint questions_background_chk
      check (background in ('aurora','sunset','ocean','forest','galaxy','candy','midnight','coral','mint','gold'));
  end if;
end $$;

-- Existing rooms retain their original unlimited setting unless their quiz has a cap.
update public.rooms r set max_players = q.max_players
  from public.quizzes q where q.id = r.quiz_id and r.max_players = 0 and q.max_players > 0;

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
    'show_options', coalesce(v_room.show_options,'text'), 'max_players', v_room.max_players,
    'server_now', now(), 'question_started_at', v_room.question_started_at,
    'question_ends_at', v_room.question_ends_at, 'allow_late', v_room.allow_late);

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
      'options', v_q.options, 'time_limit', v_q.time_limit, 'points', v_q.points,
      'background', v_q.background));
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

-- Lock the room while admitting a player, so concurrent joins cannot exceed the cap.
create or replace function public.join_room(p_pin text, p_nickname text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_player public.players; v_name text; v_answered boolean; v_count int; v_active_count int;
begin
  select * into v_room from public.rooms
   where pin = trim(p_pin) and status <> 'ended' order by created_at desc limit 1 for update;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;
  v_name := trim(regexp_replace(coalesce(p_nickname,''), '\s+', ' ', 'g'));
  if length(v_name) < 1 then return jsonb_build_object('error','nickname_required'); end if;
  if length(v_name) > 24 then v_name := left(v_name, 24); end if;

  select * into v_player from public.players
   where room_id = v_room.id and lower(nickname) = lower(v_name) limit 1;
  if v_player is not null then
    select exists (select 1 from public.answers a where a.player_id = v_player.id) into v_answered;
    if v_room.status <> 'lobby' or not v_answered then
      if p_avatar is not null then
        update public.players set avatar = p_avatar where id = v_player.id returning * into v_player;
      end if;
      return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
        'nickname', v_player.nickname, 'avatar', v_player.avatar, 'rejoined', true,
        'state', public.room_public_state(v_room.pin));
    end if;
    return jsonb_build_object('error','nickname_taken');
  end if;
  if v_room.status <> 'lobby' and not v_room.allow_late then
    return jsonb_build_object('error','game_started');
  end if;
  if v_room.max_players > 0 then
    select count(*) into v_count from public.players where room_id = v_room.id;
    if v_count >= v_room.max_players then return jsonb_build_object('error','room_full'); end if;
  end if;

  -- Free-plan safety: Realtime allows 200 peak connections. Reserve 50 for
  -- host/other app traffic and enforce 120 live player seats across this project.
  -- A shared transaction advisory lock serializes joins across different rooms.
  perform pg_advisory_xact_lock(1346718532, 101);
  select count(*) into v_active_count from public.players p
    join public.rooms r on r.id = p.room_id where r.status <> 'ended';
  if v_active_count >= 120 then return jsonb_build_object('error','free_plan_capacity'); end if;

  begin
    insert into public.players (room_id, nickname, avatar)
    values (v_room.id, v_name, coalesce(p_avatar, '{}'::jsonb)) returning * into v_player;
  exception when unique_violation then
    return jsonb_build_object('error','nickname_taken');
  end;
  return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
    'nickname', v_player.nickname, 'avatar', v_player.avatar, 'rejoined', false,
    'state', public.room_public_state(v_room.pin));
end $$;
revoke all on function public.join_room(text, text, jsonb) from public;
grant execute on function public.join_room(text, text, jsonb) to anon, authenticated;

create or replace function public.create_room(p_quiz_id uuid, p_allow_late boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pin text; v_id uuid; v_attempt int := 0; v_max_players int;
begin
  if auth.uid() is null then return jsonb_build_object('error','not_authenticated'); end if;
  select max_players into v_max_players from public.quizzes where id = p_quiz_id and owner_id = auth.uid();
  if not found then return jsonb_build_object('error','quiz_not_found'); end if;
  if not exists (select 1 from public.questions where quiz_id = p_quiz_id) then
    return jsonb_build_object('error','quiz_empty');
  end if;
  loop
    v_attempt := v_attempt + 1;
    v_pin := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.rooms where pin = v_pin and status <> 'ended');
    if v_attempt >= 50 then return jsonb_build_object('error','pin_unavailable'); end if;
  end loop;
  insert into public.rooms (pin, quiz_id, host_id, allow_late, max_players)
  values (v_pin, p_quiz_id, auth.uid(), p_allow_late, v_max_players) returning id into v_id;
  return jsonb_build_object('room_id', v_id, 'pin', v_pin,
    'quiz_title', (select title from public.quizzes where id = p_quiz_id), 'max_players', v_max_players);
end $$;
revoke all on function public.create_room(uuid, boolean) from public, anon;
grant execute on function public.create_room(uuid, boolean) to authenticated;

-- Return same per-question metadata on the host's immediate next-question RPC.
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
  update public.rooms set status = 'question', current_index = v_next,
    question_started_at = now(), question_ends_at = now() + make_interval(secs => v_q.time_limit)
   where id = v_room.id;
  return jsonb_build_object('finished', false, 'question_count', v_count,
    'question_started_at', now(), 'question_ends_at', now() + make_interval(secs => v_q.time_limit),
    'question', jsonb_build_object('id', v_q.id, 'index', v_q.position, 'prompt', v_q.prompt,
      'image_url', v_q.image_url, 'options', v_q.options, 'time_limit', v_q.time_limit,
      'points', v_q.points, 'correct_index', v_q.correct_index, 'background', v_q.background));
end $$;
revoke all on function public.host_next_question(uuid) from public, anon;
grant execute on function public.host_next_question(uuid) to authenticated;

-- Idempotent account-owner purge. Never accepts an arbitrary owner_id from the client.
create or replace function public.purge_my_data()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid := auth.uid(); v_quizzes int; v_rooms int; v_players int; v_answers int; v_questions int;
begin
  if v_owner is null then return jsonb_build_object('error','not_authenticated'); end if;
  select count(*) into v_quizzes from public.quizzes where owner_id = v_owner;
  select count(*) into v_rooms from public.rooms r
   where r.host_id = v_owner or r.quiz_id in (select id from public.quizzes where owner_id = v_owner);
  select count(*) into v_players from public.players p where p.room_id in
   (select r.id from public.rooms r where r.host_id = v_owner or r.quiz_id in (select id from public.quizzes where owner_id = v_owner));
  select count(*) into v_answers from public.answers a where a.room_id in
   (select r.id from public.rooms r where r.host_id = v_owner or r.quiz_id in (select id from public.quizzes where owner_id = v_owner));
  select count(*) into v_questions from public.questions q
   where q.quiz_id in (select id from public.quizzes where owner_id = v_owner);
  delete from public.rooms r
   where r.host_id = v_owner or r.quiz_id in (select id from public.quizzes where owner_id = v_owner);
  delete from public.quizzes where owner_id = v_owner;
  return jsonb_build_object('ok', true, 'quizzes_removed', v_quizzes, 'rooms_removed', v_rooms,
    'questions_removed', v_questions, 'players_removed', v_players, 'answers_removed', v_answers);
end $$;
revoke all on function public.purge_my_data() from public, anon;
grant execute on function public.purge_my_data() to authenticated;
