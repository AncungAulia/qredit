"use client";

import { useState } from "react";
import Link from "next/link";
import { BusinessMark } from "@/components/shared/BusinessMark";
import { KpiTile } from "@/components/shared/KpiTile";
import { Notice } from "@/components/shared/Notice";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/PageStates";
import { TxLink } from "@/components/shared/TxLink";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QOREX_INSTALL_URL } from "@/config/links";
import { formatFusd } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import { cn, focusRing } from "@/lib/utils";
import { useMarketQuery } from "@/modules/market";
import type { Rules } from "@/modules/owner/api/owner.api";
import { useOwnedVaultsQuery, useRulesQuery } from "@/modules/owner/api/useOwner";
import { OrderSignature, type AppliedOrder } from "@/modules/owner/components/OrderSignature";
import { PolicyOrderForm, type SignVia } from "@/modules/owner/components/PolicyOrderForm";
import type { PolicyOrderValues } from "@/modules/owner/schemas/policyOrder.schema";
import { ConnectDialog } from "@/modules/wallet/components/ConnectDialog";
import { useWallet } from "@/modules/wallet/WalletProvider";

function PageHead() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[30px] md:tracking-[-1px] xl:text-[32px]">
        Owner console
      </h1>
      <p className="max-w-prose text-sm leading-normal text-text-secondary md:text-[15px]">
        Change the rules of your business. Every change is a policy order signed with your post-quantum key and checked by the vault.
      </p>
    </div>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div aria-hidden className="grid grid-cols-2 gap-3 md:gap-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-3xl" />
        ))}
      </div>
      <ListSkeleton rows={3} rowClassName="h-[84px]" />
    </div>
  );
}

/** The state of a visitor who is not connected with QoreX: the owner key lives there, so no other wallet opens this page. */
function ConnectQorex({ installed }: { installed: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EmptyState
        art="wallet"
        title="Connect QoreX to open the owner console"
        message="Policy orders are signed with the post-quantum key kept in QoreX. Nothing is sent until you confirm."
        action={
          <div className="flex w-full max-w-md flex-col items-center gap-3">
            {!installed && (
              <Notice tone="info" title="QoreX is not installed in this browser" className="text-left">
                Install it first, then return to this page.
              </Notice>
            )}
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
                Connect QoreX
              </Button>
              {!installed && (
                <Button
                  variant="ghost"
                  size="sm"
                  render={<a href={QOREX_INSTALL_URL} target="_blank" rel="noreferrer" />}
                  nativeButton={false}
                  role="link"
                >
                  Get QoreX
                </Button>
              )}
            </div>
          </div>
        }
      />
      <ConnectDialog open={open} onOpenChange={setOpen} initialView="choose" />
    </>
  );
}

function BusinessPicker({
  owned,
  slug,
  onChange,
}: {
  owned: Business[];
  slug: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div role="group" aria-label="Business" className="flex flex-wrap gap-2">
      {owned.map((b) => (
        <button
          key={b.slug}
          type="button"
          aria-pressed={b.slug === slug}
          onClick={() => onChange(b.slug)}
          className={cn(
            "flex items-center gap-2.5 rounded-full bg-surface py-2 pr-4 pl-2 text-sm font-medium text-text-primary transition-colors duration-150 pointer-coarse:min-h-11",
            b.slug === slug ? "ring-1 ring-focus" : "text-text-secondary hover:text-text-primary",
            focusRing,
          )}
        >
          <BusinessMark slug={b.slug} size={32} className="rounded-full" />
          {b.name}
        </button>
      ))}
    </div>
  );
}

const percent = (part: bigint, whole: bigint) => (whole > 0n ? `${(part * 100n) / whole}%` : "0%");

function RulesCard({ rules }: { rules: Rules }) {
  const rows: [string, string][] = [
    ["Daily spending cap", formatFusd(rules.dailyCap)],
    ["Spent today", formatFusd(rules.spentToday)],
    ["Agent", rules.paused ? "Paused" : "Active"],
    ["Loan", `${rules.state}, ${percent(rules.repaid, rules.totalOwed)} repaid`],
    ["Loosening rules", rules.state === "Repaid" ? "Allowed" : "Locked during the loan"],
  ];
  return (
    <section aria-labelledby="owner-rules" className="flex flex-col gap-4 rounded-3xl bg-surface p-5 md:p-6 xl:sticky xl:top-[100px]">
      <div className="flex flex-col gap-1">
        <h2 id="owner-rules" className="text-xl font-medium text-text-primary">
          Current rules
        </h2>
        <p className="text-sm text-text-secondary">Read from the vault. They refresh when an order is applied.</p>
      </div>
      <dl className="flex flex-col gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="text-right font-medium text-text-primary tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type Draft = { values: PolicyOrderValues; via: SignVia; attempt: number };

function Console({ owned, qorexAddress }: { owned: Business[]; qorexAddress: string }) {
  const [slug, setSlug] = useState(owned[0].slug);
  const business = owned.find((b) => b.slug === slug) ?? owned[0];
  const rules = useRulesQuery(business.vault);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [applied, setApplied] = useState<AppliedOrder | null>(null);
  // Bumped by every applied order: the form remounts empty, so it never offers the old order against the new rules.
  const [formRound, setFormRound] = useState(0);
  const [attempts, setAttempts] = useState(0);

  const changeBusiness = (next: string) => {
    setSlug(next);
    setDraft(null);
    setApplied(null);
  };

  return (
    <div className="flex animate-in flex-col gap-6 duration-200 fade-in md:gap-8">
      <BusinessPicker owned={owned} slug={business.slug} onChange={changeBusiness} />
      {rules.isError && !rules.data ? (
        <ErrorState
          layout="section"
          title="The rules of this business could not be loaded."
          message="The chain did not respond. Please try again shortly."
          onRetry={() => void rules.refetch()}
        />
      ) : !rules.data ? (
        <ConsoleSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <KpiTile
              variant="feature"
              label="Agent spent today"
              value={formatFusd(rules.data.spentToday, { unit: false })}
              unit={`of ${formatFusd(rules.data.dailyCap)}`}
            />
            <KpiTile
              variant="soft"
              label="Loan"
              value={percent(rules.data.repaid, rules.data.totalOwed)}
              unit="repaid"
            />
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section aria-labelledby="owner-order" className="flex flex-col gap-5 rounded-3xl bg-surface p-5 md:p-6">
              <div className="flex flex-col gap-1">
                <h2 id="owner-order" className="text-xl font-medium text-text-primary">
                  New policy order
                </h2>
                <p className="text-sm text-text-secondary">
                  Choose what to change. Loosening a rule is locked until the loan is repaid.
                </p>
              </div>
              {applied && (
                <Notice tone="success" title={applied.title}>
                  The vault accepted your signed order. The new rules show in Current rules.
                  {applied.hash && (
                    <span className="mt-2 block">
                      <TxLink hash={applied.hash} />
                    </span>
                  )}
                </Notice>
              )}
              <PolicyOrderForm
                key={formRound}
                rules={rules.data}
                locked={draft !== null}
                onSubmit={(values, via) => {
                  setApplied(null);
                  setAttempts((n) => n + 1);
                  setDraft({ values, via, attempt: attempts + 1 });
                }}
                flow={
                  draft && (
                    <OrderSignature
                      key={draft.attempt}
                      business={business}
                      qorexAddress={qorexAddress}
                      values={draft.values}
                      via={draft.via}
                      onCancel={() => setDraft(null)}
                      onApplied={(done) => {
                        setApplied(done);
                        setDraft(null);
                        setFormRound((n) => n + 1);
                      }}
                    />
                  )
                }
              />
            </section>
            <RulesCard rules={rules.data} />
          </div>
        </>
      )}
    </div>
  );
}

/** The Owner console: a QoreX account that owns a business changes its rules with a signed policy order. */
export function OwnerPage() {
  const session = useWallet((s) => s.session);
  const hydrated = useWallet((s) => s.hydrated);
  const qorexState = useWallet((s) => s.qorexState);
  const market = useMarketQuery();
  const businesses = market.data?.map((row) => row.business);
  const qorex = session.kind === "qorex" ? session : null;
  const owned = useOwnedVaultsQuery(qorex?.evm ?? null, businesses);

  let body;
  if (!hydrated) {
    body = <ConsoleSkeleton />;
  } else if (!qorex) {
    body = <ConnectQorex installed={qorexState !== "notInstalled"} />;
  } else if ((market.isError && !businesses) || (owned.isError && !owned.data)) {
    body = (
      <ErrorState
        title="Your businesses could not be loaded."
        message="The chain or the service did not respond. Please try again shortly."
        onRetry={() => (market.isError && !businesses ? void market.refetch() : void owned.refetch())}
      />
    );
  } else if (!owned.data) {
    body = <ConsoleSkeleton />;
  } else if (owned.data.length === 0) {
    body = (
      <EmptyState
        art="owner"
        title="This wallet does not own a business"
        message="The owner console opens for the wallet that created a business with the owner tools. Connect that wallet to continue."
        action={
          <Button variant="secondary" size="sm" render={<Link href="/" />} nativeButton={false} role="link">
            Back to the market
          </Button>
        }
      />
    );
  } else {
    body = <Console owned={owned.data} qorexAddress={qorex.address} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 md:gap-8">
      <PageHead />
      {body}
    </div>
  );
}
