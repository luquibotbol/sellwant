-- A test-maintenance function was callable by anyone with the public anon key.
--
-- reset_completed_deals(jsonb) restores the fixture accounts' reputation after
-- the live advance_deal suite. In the production catalog it is SECURITY
-- DEFINER, checks no caller, and was never revoked, so anon could set
-- completed_deals -- the "completed handoffs" figure on public profiles -- to
-- any value for any @example.edu account, bypassing the column grant that
-- keeps that number read-only. Reproduced on the catalog export.
--
-- It is defined in the dashboard-built base schema, not in any migration, so
-- this tolerates its absence on a fresh database. Supabase grants EXECUTE to
-- anon and authenticated by name, so each is revoked explicitly.
--
-- Consequence: tests/advance-deal.test.ts restores the counters with a user
-- token, which now fails. That suite already ignores the result and no longer
-- runs in CI; run any restore with the service key.

begin;
do $$
begin
  if to_regprocedure('public.reset_completed_deals(jsonb)') is not null then
    revoke all on function public.reset_completed_deals(jsonb) from public, anon, authenticated;
    grant execute on function public.reset_completed_deals(jsonb) to service_role;
  end if;
end $$;
commit;
