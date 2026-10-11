create type public.user_mode as enum ('employed', 'job_seeker');
create type public.pay_frequency as enum ('weekly', 'biweekly', 'semi_monthly', 'monthly');
create type public.day_type as enum ('duty', 'off', 'leave', 'sick', 'holiday');
create type public.application_status as enum ('pending', 'interview', 'offer', 'rejected', 'no_response');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  mode public.user_mode not null default 'job_seeker',
  currency char(3),
  pay_frequency public.pay_frequency,
  timezone text,
  onboarded boolean not null default false,
  created_at timestamptz default now(),
  constraint profiles_onboarded_required_fields check (
    not onboarded or (currency is not null and timezone is not null)
  ),
  constraint profiles_currency_format check (currency is null or currency ~ '^[A-Z]{3}$')
);

create table public.employments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  employer_name text not null,
  job_title text,
  hourly_rate numeric(10, 2),
  start_date date,
  end_date date,
  is_current boolean not null default true
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  employment_id uuid references public.employments (id) on delete set null,
  work_date date not null,
  day_type public.day_type not null default 'duty',
  time_in timestamptz,
  time_out timestamptz,
  break_minutes int not null default 0,
  is_overtime boolean not null default false,
  notes text,
  constraint shifts_time_order check (time_out is null or time_in is null or time_out > time_in),
  constraint shifts_nonnegative_break check (break_minutes >= 0)
);

create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  employment_id uuid references public.employments (id) on delete set null,
  pay_date date not null,
  period_start date,
  period_end date,
  gross numeric(12, 2),
  deductions numeric(12, 2) not null default 0,
  net numeric(12, 2) not null,
  notes text,
  constraint payroll_entries_period_order check (period_end is null or period_start is null or period_end >= period_start)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  company text not null,
  position text not null,
  source text,
  job_url text,
  location text,
  date_applied date not null,
  status public.application_status not null default 'pending',
  contact_name text,
  contact_email text,
  notes text,
  updated_at timestamptz not null default now()
);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null,
  event_date timestamptz not null,
  notes text
);

create index employments_user_id_idx on public.employments (user_id);
create index shifts_user_id_work_date_idx on public.shifts (user_id, work_date);
create index shifts_employment_id_idx on public.shifts (employment_id);
create index payroll_entries_user_id_pay_date_idx on public.payroll_entries (user_id, pay_date);
create index payroll_entries_employment_id_idx on public.payroll_entries (employment_id);
create index applications_user_id_status_idx on public.applications (user_id, status);
create index applications_user_id_date_applied_idx on public.applications (user_id, date_applied);
create index application_events_application_id_idx on public.application_events (application_id);
create index application_events_user_id_idx on public.application_events (user_id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$function$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.set_application_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

create trigger applications_set_updated_at
before update on public.applications
for each row execute function public.set_application_updated_at();

alter table public.profiles enable row level security;
alter table public.employments enable row level security;
alter table public.shifts enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;

create policy profiles_select_own on public.profiles
for select to authenticated
using (id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy employments_owner_access on public.employments
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy shifts_owner_access on public.shifts
for all to authenticated
using (
  user_id = (select auth.uid())
  and (
    employment_id is null
    or exists (
      select 1
      from public.employments as e
      where e.id = shifts.employment_id
        and e.user_id = (select auth.uid())
    )
  )
)
with check (
  user_id = (select auth.uid())
  and (
    employment_id is null
    or exists (
      select 1
      from public.employments as e
      where e.id = shifts.employment_id
        and e.user_id = (select auth.uid())
    )
  )
);

create policy payroll_entries_owner_access on public.payroll_entries
for all to authenticated
using (
  user_id = (select auth.uid())
  and (
    employment_id is null
    or exists (
      select 1
      from public.employments as e
      where e.id = payroll_entries.employment_id
        and e.user_id = (select auth.uid())
    )
  )
)
with check (
  user_id = (select auth.uid())
  and (
    employment_id is null
    or exists (
      select 1
      from public.employments as e
      where e.id = payroll_entries.employment_id
        and e.user_id = (select auth.uid())
    )
  )
);

create policy applications_owner_access on public.applications
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy application_events_owner_access on public.application_events
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.applications as a
    where a.id = application_events.application_id
      and a.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.applications as a
    where a.id = application_events.application_id
      and a.user_id = (select auth.uid())
  )
);

create view public.shifts_with_hours
with (security_invoker = true)
as
select
  s.*,
  case
    when s.day_type = 'duty' and s.time_in is not null and s.time_out is not null
      then greatest(0, extract(epoch from (s.time_out - s.time_in)) / 60 - s.break_minutes)
    else 0
  end as worked_minutes
from public.shifts as s;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.employments,
  public.shifts,
  public.payroll_entries,
  public.applications,
  public.application_events
to authenticated;
grant select on public.shifts_with_hours to authenticated;

revoke delete on table public.profiles from authenticated;
revoke all privileges on table
  public.profiles,
  public.employments,
  public.shifts,
  public.payroll_entries,
  public.applications,
  public.application_events
from anon;
revoke all privileges on public.shifts_with_hours from anon;
revoke execute on function public.handle_new_user() from PUBLIC, anon, authenticated;
revoke execute on function public.set_application_updated_at() from PUBLIC, anon, authenticated;
