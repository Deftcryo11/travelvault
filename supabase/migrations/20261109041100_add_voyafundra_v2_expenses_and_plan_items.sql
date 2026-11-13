-- Applied to the existing Supabase project as
-- 20261109041100_add_voyafundra_v2_expenses_and_plan_items.
-- Additive only: existing public.trips rows remain untouched.
create or replace function public.voyafundra_set_activity_revision()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  elsif tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    new.user_id := old.user_id;
    new.trip_id := old.trip_id;
    new.id := old.id;
  end if;
  return new;
end;
$$;

create table if not exists public.trip_expenses (
  id text not null,
  user_id uuid not null,
  trip_id text not null,
  expense_date date not null,
  category text not null default 'Other' check (length(category) between 1 and 70),
  description text not null check (length(description) between 1 and 250),
  original_amount numeric(14,2) not null check (original_amount >= 0 and original_amount <= 1000000000),
  currency text not null default 'MVR' check (currency in ('MVR','USD')),
  exchange_rate numeric(14,6) not null default 1 check (exchange_rate > 0 and exchange_rate <= 1000000),
  amount_mvr numeric(14,2) not null check (amount_mvr >= 0 and amount_mvr <= 1000000000),
  entry_type text not null default 'expense' check (entry_type in ('expense','refund')),
  payment_status text not null default 'paid' check (payment_status in ('paid','planned')),
  booking_id text,
  notes text not null default '' check (length(notes) <= 2000),
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_expenses_pkey primary key (user_id,trip_id,id),
  constraint trip_expenses_parent_fkey foreign key (user_id,trip_id)
    references public.trips (user_id,id) on delete cascade,
  constraint trip_expenses_booking_len check
    (booking_id is null or length(booking_id) between 1 and 150)
);

create table if not exists public.trip_plan_items (
  id text not null,
  user_id uuid not null,
  trip_id text not null,
  kind text not null default 'activity'
    check (kind in ('flight','hotel','transport','activity','meal','custom')),
  title text not null check (length(title) between 1 and 250),
  start_date date not null,
  start_time time without time zone,
  end_date date,
  end_time time without time zone,
  time_zone text not null default '' check (length(time_zone) <= 80),
  location text not null default '' check (length(location) <= 250),
  provider text not null default '' check (length(provider) <= 160),
  booking_reference text not null default '' check (length(booking_reference) <= 160),
  booking_status text not null default 'idea' check (booking_status in ('idea','pending','confirmed','cancelled')),
  committed_mvr numeric(14,2) not null default 0 check (committed_mvr >= 0 and committed_mvr <= 1000000000),
  notes text not null default '' check (length(notes) <= 2000),
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_plan_items_pkey primary key (user_id,trip_id,id),
  constraint trip_plan_items_parent_fkey foreign key (user_id,trip_id)
    references public.trips (user_id,id) on delete cascade,
  constraint trip_plan_items_end_after_start
    check (end_date is null or end_date >= start_date)
);

create index if not exists trip_expenses_by_trip_date
  on public.trip_expenses(user_id,trip_id,expense_date desc);
create index if not exists trip_plan_items_by_trip_date
  on public.trip_plan_items(user_id,trip_id,start_date,start_time);

drop trigger if exists voyafundra_expense_revision on public.trip_expenses;
create trigger voyafundra_expense_revision
  before insert or update on public.trip_expenses for each row
  execute function public.voyafundra_set_activity_revision();
drop trigger if exists voyafundra_plan_revision on public.trip_plan_items;
create trigger voyafundra_plan_revision
  before insert or update on public.trip_plan_items for each row
  execute function public.voyafundra_set_activity_revision();

alter table public.trip_expenses enable row level security;
alter table public.trip_plan_items enable row level security;

create policy "Read own expenses" on public.trip_expenses
  for select to authenticated using ((select auth.uid())=user_id);
create policy "Create own expenses" on public.trip_expenses
  for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own expenses" on public.trip_expenses
  for update to authenticated using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id);
create policy "Delete own expenses" on public.trip_expenses
  for delete to authenticated using ((select auth.uid())=user_id);

create policy "Read own plan items" on public.trip_plan_items
  for select to authenticated using ((select auth.uid())=user_id);
create policy "Create own plan items" on public.trip_plan_items
  for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own plan items" on public.trip_plan_items
  for update to authenticated using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id);
create policy "Delete own plan items" on public.trip_plan_items
  for delete to authenticated using ((select auth.uid())=user_id);

grant select,insert,update,delete on
  public.trip_expenses,public.trip_plan_items to authenticated;
revoke all on public.trip_expenses,public.trip_plan_items from anon;
revoke execute on function public.voyafundra_set_activity_revision()
  from public,anon,authenticated;
