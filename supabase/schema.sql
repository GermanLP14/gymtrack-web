-- Plitt Fit: cloud sync storage.
-- Run once in the Supabase dashboard (SQL Editor) of the project used by the apps.

-- One JSON document per synced thing (routine, workout, weight entry, setting, exercise).
create table public.sync_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  -- Device clock (epoch ms) of the last edit; the apps keep the most recent version.
  updated_at bigint not null,
  deleted boolean not null default false,
  -- Bumped on every write, so each device can ask for "everything after what I have".
  seq bigint not null,
  primary key (user_id, kind, id)
);

create sequence public.sync_items_seq owned by public.sync_items.seq;

create function public.sync_items_bump_seq() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.seq := nextval('public.sync_items_seq');
  return new;
end;
$$;

create trigger sync_items_bump_seq
before insert or update on public.sync_items
for each row execute function public.sync_items_bump_seq();

create index sync_items_user_seq on public.sync_items (user_id, seq);

-- Each account only sees and writes its own rows.
alter table public.sync_items enable row level security;

create policy "own rows" on public.sync_items
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.sync_items to authenticated;
