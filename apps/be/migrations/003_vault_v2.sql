-- Vault v2: a business can have a v1 and a v2 vault (same slug), so businesses are keyed by vault and carry the
-- version of their vault; the watcher records the end of a loan; orders gain the buyer review statuses.
alter table qredit.businesses add column version smallint not null default 1;
alter table qredit.businesses add constraint businesses_version_known check (version in (1, 2));
alter table qredit.businesses add column ended text;
alter table qredit.businesses add constraint businesses_ended_known check (ended is null or ended in ('defaulted', 'closed'));
alter table qredit.businesses drop constraint businesses_pkey;
alter table qredit.businesses add constraint businesses_pkey primary key (vault);
create unique index businesses_slug_version_idx on qredit.businesses (slug, version);

alter table qredit.orders drop constraint orders_status_check;
alter table qredit.orders add constraint orders_status_check
  check (status in ('open', 'claimed', 'delivered', 'in_review', 'settled', 'rejected', 'declined', 'reclaimed'));
alter table qredit.orders add column review_ends bigint;
alter table qredit.orders add column refund text;
alter table qredit.orders add constraint orders_refund_digits check (refund is null or refund ~ '^[0-9]+$');
create index orders_in_review_idx on qredit.orders (vault, review_ends) where status = 'in_review';
