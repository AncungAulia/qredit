-- Qredit backend schema. Private schema (not exposed by Supabase's Data API);
-- RLS is enabled with no policies, so only the backend's own role can read or write.

create table qredit.businesses (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  vault text not null unique check (vault ~ '^0x[0-9a-f]{40}$'),
  name text not null,
  tagline text not null,
  services jsonb not null,
  operator text not null check (operator ~ '^0x[0-9a-f]{40}$'),
  spender text not null check (spender ~ '^0x[0-9a-f]{40}$'),
  start_block bigint not null check (start_block >= 0),
  created_at timestamptz not null default now()
);

create table qredit.orders (
  vault text not null,
  order_id text not null,
  buyer text not null,
  service_id integer not null,
  price text not null,
  request_ref text not null,
  deadline bigint not null,
  status text not null check (status in ('open', 'claimed', 'delivered', 'declined', 'reclaimed')),
  placed_tx text not null,
  placed_block bigint not null,
  claimed_at timestamptz,
  envelope_hash text,
  closed_tx text,
  updated_at timestamptz not null default now(),
  primary key (vault, order_id)
);
create index orders_open_idx on qredit.orders (vault, placed_block) where status in ('open', 'claimed');

create table qredit.envelopes (
  hash text primary key check (hash ~ '^0x[0-9a-f]{64}$'),
  kind text not null check (kind in ('request', 'report', 'sample')),
  body text not null,
  size integer not null,
  created_at timestamptz not null default now()
);

create table qredit.cards (
  address text primary key,
  card jsonb not null,
  updated_at timestamptz not null default now()
);

create table qredit.decisions (
  id bigint generated always as identity primary key,
  vault text not null,
  order_id text,
  decision text not null check (decision in ('accepted', 'declined', 'delivered', 'failed')),
  reason text not null,
  suppliers jsonb not null default '[]'::jsonb,
  cost text not null default '0',
  created_at timestamptz not null default now()
);
create index decisions_vault_idx on qredit.decisions (vault, id desc);

create table qredit.watcher_state (
  vault text primary key,
  last_block bigint not null
);

create table qredit.faucet_grants (
  id bigint generated always as identity primary key,
  address text not null,
  ip_hash text not null,
  tx text not null,
  created_at timestamptz not null default now()
);
create index faucet_grants_address_idx on qredit.faucet_grants (address, created_at desc);
create index faucet_grants_ip_idx on qredit.faucet_grants (ip_hash, created_at desc);

alter table qredit.schema_migrations enable row level security;
alter table qredit.businesses enable row level security;
alter table qredit.orders enable row level security;
alter table qredit.envelopes enable row level security;
alter table qredit.cards enable row level security;
alter table qredit.decisions enable row level security;
alter table qredit.watcher_state enable row level security;
alter table qredit.faucet_grants enable row level security;

-- On Supabase, make sure the API roles have no access to this schema at all.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema qredit from anon, authenticated';
    execute 'revoke all on all tables in schema qredit from anon, authenticated';
  end if;
end $$;
