-- ============================================================================
-- ONLIVE QUIZ — migration 0008
-- Hide room PINs and room metadata from other hosts and anonymous clients.
-- The player flow reads public room state only through SECURITY DEFINER RPCs;
-- only the owning authenticated host needs direct SELECT access to rooms.
-- ============================================================================

drop policy if exists rooms_read on public.rooms;
drop policy if exists rooms_host_read on public.rooms;
create policy rooms_host_read on public.rooms for select to authenticated
  using (host_id = auth.uid());
