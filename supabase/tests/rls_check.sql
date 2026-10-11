begin;

-- Seed two temporary users and rows owned by user B. The transaction is rolled
-- back at the end so the test leaves no auth users or application data behind.
do $test_setup$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_employment_b uuid;
  v_shift_b uuid;
  v_application_b uuid;
  v_worked_minutes numeric;
begin
  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@workpath.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@workpath.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  if not exists (select 1 from public.profiles where id = v_user_a) then
    raise exception 'Profile was not automatically created for user A';
  end if;

  perform set_config('workpath.test_user_a', v_user_a::text, true);
  perform set_config('workpath.test_user_b', v_user_b::text, true);

  insert into public.employments (user_id, employer_name)
  values (v_user_b, 'Test employer')
  returning id into v_employment_b;
  perform set_config('workpath.test_employment_b', v_employment_b::text, true);

  insert into public.shifts (
    user_id,
    employment_id,
    work_date,
    day_type,
    time_in,
    time_out,
    break_minutes
  ) values (
    v_user_b,
    v_employment_b,
    date '2026-01-01',
    'duty',
    timestamptz '2026-01-01 22:00:00+00',
    timestamptz '2026-01-02 06:00:00+00',
    60
  ) returning id into v_shift_b;
  perform set_config('workpath.test_shift_b', v_shift_b::text, true);

  insert into public.payroll_entries (user_id, employment_id, pay_date, net)
  values (v_user_b, v_employment_b, date '2026-01-15', 1000);

  insert into public.applications (user_id, company, position, date_applied)
  values (v_user_b, 'Test company', 'Test position', date '2026-01-05')
  returning id into v_application_b;
  perform set_config('workpath.test_application_b', v_application_b::text, true);

  insert into public.application_events (application_id, user_id, event_type, event_date)
  values (v_application_b, v_user_b, 'status_changed', timestamptz '2026-01-06 12:00:00+00');

  select worked_minutes into v_worked_minutes
  from public.shifts_with_hours
  where id = v_shift_b;

  if v_worked_minutes is distinct from 420 then
    raise exception 'Expected overnight shift to compute 420 worked minutes, got %', v_worked_minutes;
  end if;
end;
$test_setup$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('workpath.test_user_a'), true);

do $test_rls$
declare
  v_user_a uuid := current_setting('workpath.test_user_a')::uuid;
  v_user_b uuid := current_setting('workpath.test_user_b')::uuid;
  v_employment_b uuid := current_setting('workpath.test_employment_b')::uuid;
  v_application_b uuid := current_setting('workpath.test_application_b')::uuid;
  v_employment_a uuid;
  v_shift_a uuid;
  v_payroll_a uuid;
  v_application_a uuid;
  v_event_a uuid;
  v_rows integer;
  v_worked_minutes numeric;
begin
  if exists (select 1 from public.profiles where id = v_user_b) then
    raise exception 'User A can read user B profile';
  end if;
  if exists (select 1 from public.employments where user_id = v_user_b) then
    raise exception 'User A can read user B employment';
  end if;
  if exists (select 1 from public.shifts where user_id = v_user_b) then
    raise exception 'User A can read user B shift';
  end if;
  if exists (select 1 from public.shifts_with_hours where user_id = v_user_b) then
    raise exception 'User A can read user B shift through shifts_with_hours';
  end if;
  if exists (select 1 from public.payroll_entries where user_id = v_user_b) then
    raise exception 'User A can read user B payroll entry';
  end if;
  if exists (select 1 from public.applications where user_id = v_user_b) then
    raise exception 'User A can read user B application';
  end if;
  if exists (select 1 from public.application_events where user_id = v_user_b) then
    raise exception 'User A can read user B application event';
  end if;

  update public.profiles set display_name = 'Changed by A' where id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A updated user B profile'; end if;
  begin
    delete from public.profiles where id = v_user_b;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'User A deleted user B profile'; end if;
  exception when insufficient_privilege then
    null;
  end;

  update public.employments set employer_name = 'Changed by A' where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A updated user B employment'; end if;
  delete from public.employments where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A deleted user B employment'; end if;

  update public.shifts set notes = 'Changed by A' where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A updated user B shift'; end if;
  delete from public.shifts where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A deleted user B shift'; end if;

  update public.payroll_entries set notes = 'Changed by A' where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A updated user B payroll entry'; end if;
  delete from public.payroll_entries where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A deleted user B payroll entry'; end if;

  update public.applications set company = 'Changed by A' where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A updated user B application'; end if;
  delete from public.applications where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A deleted user B application'; end if;

  update public.application_events set notes = 'Changed by A' where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A updated user B application event'; end if;
  delete from public.application_events where user_id = v_user_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'User A deleted user B application event'; end if;

  begin
    insert into public.shifts (user_id, employment_id, work_date)
    values (auth.uid(), v_employment_b, date '2026-01-20');
    raise exception 'User A inserted a shift referencing user B employment';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.payroll_entries (user_id, employment_id, pay_date, net)
    values (auth.uid(), v_employment_b, date '2026-01-20', 0);
    raise exception 'User A inserted a payroll entry referencing user B employment';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.application_events (application_id, user_id, event_type, event_date)
    values (v_application_b, auth.uid(), 'status_changed', now());
    raise exception 'User A inserted an event referencing user B application';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.employments (user_id, employer_name)
  values (v_user_a, 'User A employer')
  returning id into v_employment_a;
  if not exists (
    select 1 from public.employments where id = v_employment_a and user_id = v_user_a
  ) then
    raise exception 'User A cannot select their own employment';
  end if;

  insert into public.shifts (
    user_id, employment_id, work_date, day_type, time_in, time_out, break_minutes
  ) values (
    v_user_a,
    v_employment_a,
    date '2026-01-21',
    'duty',
    timestamptz '2026-01-21 09:00:00+00',
    timestamptz '2026-01-21 17:00:00+00',
    30
  ) returning id into v_shift_a;
  if not exists (
    select 1 from public.shifts where id = v_shift_a and user_id = v_user_a
  ) then
    raise exception 'User A cannot select their own shift';
  end if;
  select worked_minutes into v_worked_minutes
  from public.shifts_with_hours
  where id = v_shift_a and user_id = v_user_a;
  if v_worked_minutes is distinct from 450 then
    raise exception 'User A cannot read own shift hours, or expected 450 minutes, got %', v_worked_minutes;
  end if;

  insert into public.payroll_entries (user_id, employment_id, pay_date, net)
  values (v_user_a, v_employment_a, date '2026-01-22', 900)
  returning id into v_payroll_a;
  if not exists (
    select 1 from public.payroll_entries where id = v_payroll_a and user_id = v_user_a
  ) then
    raise exception 'User A cannot select their own payroll entry';
  end if;

  insert into public.applications (user_id, company, position, date_applied)
  values (v_user_a, 'User A company', 'User A position', date '2026-01-23')
  returning id into v_application_a;
  if not exists (
    select 1 from public.applications where id = v_application_a and user_id = v_user_a
  ) then
    raise exception 'User A cannot select their own application';
  end if;

  insert into public.application_events (application_id, user_id, event_type, event_date)
  values (v_application_a, v_user_a, 'status_changed', timestamptz '2026-01-24 12:00:00+00')
  returning id into v_event_a;
  if not exists (
    select 1 from public.application_events where id = v_event_a and user_id = v_user_a
  ) then
    raise exception 'User A cannot select their own application event';
  end if;

  update public.profiles set display_name = 'User A display name' where id = v_user_a;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 or not exists (
    select 1 from public.profiles where id = v_user_a and display_name = 'User A display name'
  ) then
    raise exception 'User A cannot update and select their own profile';
  end if;

  begin
    delete from public.profiles where id = v_user_a;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'User A deleted their own profile'; end if;
  exception when insufficient_privilege then
    null;
  end;
  if not exists (select 1 from public.profiles where id = v_user_a) then
    raise exception 'User A profile is missing after the delete attempt';
  end if;

  begin
    update public.profiles
    set onboarded = true, currency = null
    where id = v_user_a;
    raise exception 'The onboarded profile check accepted a null currency';
  exception when check_violation then
    null;
  end;
  if not exists (
    select 1 from public.profiles
    where id = v_user_a and onboarded = false and currency is null
  ) then
    raise exception 'The rejected onboarding update changed user A profile';
  end if;

  begin
    insert into public.employments (user_id, employer_name)
    values (v_user_b, 'Spoofed employment');
    raise exception 'User A inserted an employment with user B user_id';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.shifts (user_id, employment_id, work_date)
    values (v_user_b, v_employment_a, date '2026-01-25');
    raise exception 'User A inserted a shift with user B user_id';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.payroll_entries (user_id, employment_id, pay_date, net)
    values (v_user_b, v_employment_a, date '2026-01-25', 0);
    raise exception 'User A inserted a payroll entry with user B user_id';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.applications (user_id, company, position, date_applied)
    values (v_user_b, 'Spoofed company', 'Spoofed position', date '2026-01-25');
    raise exception 'User A inserted an application with user B user_id';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.application_events (application_id, user_id, event_type, event_date)
    values (v_application_a, v_user_b, 'status_changed', now());
    raise exception 'User A inserted an application event with user B user_id';
  exception when insufficient_privilege then
    null;
  end;
end;
$test_rls$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $test_anon$
begin
  begin
    if exists (select 1 from public.profiles) then raise exception 'Anon can read profiles'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    if exists (select 1 from public.employments) then raise exception 'Anon can read employments'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    if exists (select 1 from public.shifts) then raise exception 'Anon can read shifts'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    if exists (select 1 from public.payroll_entries) then raise exception 'Anon can read payroll_entries'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    if exists (select 1 from public.applications) then raise exception 'Anon can read applications'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    if exists (select 1 from public.application_events) then raise exception 'Anon can read application_events'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    if exists (select 1 from public.shifts_with_hours) then raise exception 'Anon can read shifts_with_hours'; end if;
  exception when insufficient_privilege then null;
  end;
end;
$test_anon$;

reset role;
rollback;
