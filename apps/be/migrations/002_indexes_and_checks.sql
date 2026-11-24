-- History queries (vault, newest first) and input shape checks.
create index orders_vault_history_idx on qredit.orders (vault, placed_block desc);

-- Tables created later by the owner role must not be readable through the Data API either.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema qredit revoke all on tables from anon, authenticated';
  end if;
end $$;

alter table qredit.orders
  add constraint orders_vault_hex check (vault ~ '^0x[0-9a-f]{40}$') not valid,
  add constraint orders_buyer_hex check (buyer ~ '^0x[0-9a-f]{40}$') not valid,
  add constraint orders_order_id_digits check (order_id ~ '^[0-9]+$') not valid,
  add constraint orders_price_digits check (price ~ '^[0-9]+$') not valid,
  add constraint orders_request_ref_hex check (request_ref ~ '^0x[0-9a-f]{64}$') not valid;
alter table qredit.decisions
  add constraint decisions_cost_digits check (cost ~ '^[0-9]+$') not valid;

alter table qredit.orders
  validate constraint orders_vault_hex,
  validate constraint orders_buyer_hex,
  validate constraint orders_order_id_digits,
  validate constraint orders_price_digits,
  validate constraint orders_request_ref_hex;
alter table qredit.decisions validate constraint decisions_cost_digits;
