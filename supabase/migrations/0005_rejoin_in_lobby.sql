-- ============================================================================
--  ONLIVE QUIZ — migration 0005
--  แก้บั๊กที่พบจากการทดสอบ E2E (รอบที่ 10):
--
--  ปัญหา: ผู้เล่นที่เข้าห้องไปแล้ว (สถานะ lobby) แล้วกลับมาเข้าซ้ำด้วยชื่อเดิม
--         — เปลี่ยนเครื่อง / ล้างข้อมูลเบราว์เซอร์ / เปิดสองแท็บ / กดเข้าร่วมรัว ๆ
--         จะได้ error "nickname_taken" ทั้งที่มันคือตัวเขาเอง
--         (ระหว่างเกมระบบจำได้อยู่แล้ว แต่ช่วง lobby ยังไม่ได้ทำ)
--
--  วิธีแก้: ถ้าห้องยังอยู่ใน lobby และแถวชื่อซ้ำนั้น "ยังไม่เคยตอบข้อไหนเลย"
--         ให้คืน token เดิม = กลับเข้าที่นั่งเดิม พร้อมอัปเดตตัวละคร
--         ถ้าเคยตอบแล้ว (เข้าห้องกลางเกม) พฤติกรรมเดิมยังคงอยู่
-- ============================================================================

create or replace function public.join_room(p_pin text, p_nickname text, p_avatar jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_player public.players; v_name text; v_answered boolean;
begin
  select * into v_room from public.rooms
   where pin = trim(p_pin) and status <> 'ended' order by created_at desc limit 1;
  if v_room is null then return jsonb_build_object('error','room_not_found'); end if;

  v_name := trim(regexp_replace(coalesce(p_nickname,''), '\s+', ' ', 'g'));
  if length(v_name) < 1 then return jsonb_build_object('error','nickname_required'); end if;
  if length(v_name) > 24 then v_name := left(v_name, 24); end if;

  -- ชื่อซ้ำ: ถ้าเป็นคนเดิม (ยังไม่ตอบข้อไหน / อยู่ระหว่างเกม) ให้คืนที่นั่งเดิม
  select * into v_player from public.players
   where room_id = v_room.id and lower(nickname) = lower(v_name) limit 1;
  if v_player is not null then
    select exists (select 1 from public.answers a where a.player_id = v_player.id) into v_answered;
    -- ระหว่างเกม = กลับเข้ามาใหม่ได้เสมอ
    -- ใน lobby = ได้เฉพาะคนที่ยังไม่ได้เริ่มเล่น (กันการแอบสวมสิทธิ์คนที่ตอบไปแล้ว)
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

  begin
    insert into public.players (room_id, nickname, avatar)
    values (v_room.id, v_name, coalesce(p_avatar, '{}'::jsonb))
    returning * into v_player;
  exception when unique_violation then
    -- มีคนยิงเข้าพร้อมกันด้วยชื่อเดียวกัน: คนที่แพ้ให้ลองใหม่ (ไม่ทำให้ทั้งห้องพัง)
    return jsonb_build_object('error','nickname_taken');
  end;

  return jsonb_build_object('player_id', v_player.id, 'token', v_player.token,
    'nickname', v_player.nickname, 'avatar', v_player.avatar, 'rejoined', false,
    'state', public.room_public_state(v_room.pin));
end $$;

revoke all on function public.join_room(text, text, jsonb) from public;
grant execute on function public.join_room(text, text, jsonb) to anon, authenticated;
