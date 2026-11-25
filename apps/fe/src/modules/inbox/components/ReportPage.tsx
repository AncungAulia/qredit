"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Box, Check, Hash, KeyRound, Lock, LoaderCircle, Mail, MailCheck, MailOpen, MailX, ShieldAlert, X, type LucideIcon } from "lucide-react";
import { ReportUnreadable } from "@qredit/qore";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/useNow";
import { ApiError } from "@/lib/apiClient";
import { formatCount, formatDateTime, formatFusd, shortHash } from "@/lib/format";
import type { Business, Order } from "@/lib/schemas";
import { serviceName } from "@/lib/serviceName";
import { cn, focusRing } from "@/lib/utils";
import { ReportDoesNotMatch, type Delivery, type OpenedReport } from "@/modules/inbox/api/inbox.api";
import { useDeliveryQuery, useOpenReport, useReportContextQuery } from "@/modules/inbox/api/useInbox";
import { ReclaimButton } from "@/modules/inbox/components/ReclaimButton";
import { ReportView } from "@/modules/inbox/components/ReportView";
import { downloadReport } from "@/modules/inbox/lib/download";
import { isLate } from "@/modules/inbox/lib/inboxOrders";
import { parseReport } from "@/modules/inbox/schemas/report.schema";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { useWalletReadiness } from "@/modules/wallet/components/RequireReadyWallet";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Hex = `0x${string}`;
type Tone = "ok" | "working" | "failed" | "idle";
type Phase = { kind: "sealed" } | { kind: "opening" } | { kind: "failed" } | { kind: "unreadable" } | { kind: "opened"; opened: OpenedReport };

const FRAME = "mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-5 md:gap-7";
const DOT: Record<Tone, { box: string; Icon: LucideIcon }> = {
  ok: { box: "bg-success", Icon: Check },
  working: { box: "bg-accent-strong", Icon: LoaderCircle },
  failed: { box: "bg-danger", Icon: X },
  idle: { box: "bg-text-tertiary", Icon: Lock },
};

function CheckCard({ icon: Icon, tone, title, detail }: { icon: LucideIcon; tone: Tone; title: string; detail: string }) {
  const dot = DOT[tone];
  return (
    <li className="flex flex-1 items-center gap-3 rounded-2xl bg-surface p-4">
      <span className="relative grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-muted text-text-primary">
        <Icon className="size-[17px]" aria-hidden />
        <span className={cn("absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full text-surface", dot.box)}>
          <dot.Icon className={cn("size-2.5", tone === "working" && "animate-spin motion-reduce:animate-none")} aria-hidden />
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium text-text-primary">{title}</span>
        <span className="text-[13px] break-words text-text-tertiary">{detail}</span>
      </span>
    </li>
  );
}

type CheckSet = { delivered: ReactNode; envelope: ReactNode; opened: ReactNode };

function Checks({ checks }: { checks: CheckSet }) {
  return (
    <ul className="flex flex-col gap-2 md:flex-row md:gap-3">
      {checks.delivered}
      {checks.envelope}
      {checks.opened}
    </ul>
  );
}

function Breadcrumb() {
  return (
    <Link href="/inbox" className={cn("inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary pointer-coarse:min-h-11", focusRing)}>
      <ArrowLeft className="size-4" aria-hidden />
      Inbox
    </Link>
  );
}

function Head({ title, description, icon: Icon, tone, action }: { title: string; description: string; icon: LucideIcon; tone: "accent" | "danger"; action?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl md:size-14", tone === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-strong")}>
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[24px] font-medium tracking-[-0.6px] text-text-primary md:text-[28px] md:tracking-[-0.8px]">{title}</h1>
          <p className="text-sm leading-normal text-text-secondary md:text-[15px]">{description}</p>
        </div>
      </div>
      {action}
    </header>
  );
}

/** The card under the checks: a seal, a title, a sentence and the one thing to do next. */
function StateCard({ icon: Icon, tone = "accent", title, children, role }: { icon: LucideIcon; tone?: "accent" | "danger"; title: string; children: ReactNode; role?: "alert" }) {
  return (
    <section role={role} className="flex flex-col items-center gap-4 rounded-3xl bg-surface px-5 py-10 text-center md:px-10 md:py-16">
      <span className={cn("grid size-[88px] place-items-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-strong")}>
        <Icon className="size-9" aria-hidden />
      </span>
      <h2 className="text-xl font-medium text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

const lead = "max-w-prose text-[15px] leading-normal text-text-secondary";

function BackToInbox() {
  return (
    <Button variant="secondary" size="lg" className="h-11" render={<Link href="/inbox" />} nativeButton={false} role="link">
      Back to the inbox
    </Button>
  );
}

function ReportSkeleton() {
  return (
    <div role="status" aria-busy="true" className={FRAME}>
      <span className="sr-only">Loading</span>
      <Skeleton className="h-5 w-20 rounded-lg" />
      <Skeleton className="h-14 w-full max-w-md rounded-2xl" />
      <div className="flex flex-col gap-3 md:flex-row">
        <Skeleton className="h-[68px] flex-1 rounded-2xl" />
        <Skeleton className="h-[68px] flex-1 rounded-2xl" />
        <Skeleton className="h-[68px] flex-1 rounded-2xl" />
      </div>
      <Skeleton className="h-80 w-full rounded-3xl" />
    </div>
  );
}

/** What stands in place of the open button when the session holds no seal keys. */
function OpenGate({ kind }: { kind: string }) {
  const text =
    kind === "qorex"
      ? "QoreX cannot open sealed reports. Use the test wallet that holds the key this report was sealed to."
      : kind === "locked"
        ? "Unlock your test wallet to open this report. Its key stays in this browser."
        : "Connect the test wallet that holds the key this report was sealed to.";
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="max-w-prose text-sm text-text-secondary">{text}</p>
      <ConnectPrompt size="lg" className="h-11" />
    </div>
  );
}

type Loaded = { business: Business; order: Order };

function WaitingOrder({ ctx }: { ctx: Loaded }) {
  const { order, business } = ctx;
  const readiness = useWalletReadiness();
  const late = isLate(order, useNow());
  const base = { business, order };
  let card: ReactNode;
  if (order.status === "delivered") card = null;
  else if (late) {
    card = (
      <EmptyState
        art="waiting"
        layout="section"
        title="This order is late"
        message="The deadline has passed without a delivery. You can take your payment back."
        action={readiness.state === "ready" ? <ReclaimButton order={base.order} business={business} withAmount size="lg" className="h-11" /> : undefined}
      />
    );
  } else if (order.status === "open" || order.status === "claimed") {
    card = (
      <EmptyState
        art="waiting"
        layout="section"
        title="Waiting for the agent"
        message={`The agent has not delivered this report yet. It appears here once it is delivered, and this page checks again on its own. The deadline is ${formatDateTime(order.deadline)}.`}
      />
    );
  } else if (order.status === "declined") {
    card = <EmptyState art="search" layout="section" title="The agent declined this order" message={`The business did not take order ${order.orderId}, and ${formatFusd(order.price)} was returned to your wallet.`} />;
  } else {
    card = <EmptyState art="lending" layout="section" title="You reclaimed this order" message={`${formatFusd(order.price)} was returned to your wallet.`} />;
  }
  return <>{card}</>;
}

function OpenedHeadAction({ opened, vault, orderId }: { opened: OpenedReport | null; vault: Hex; orderId: string }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="max-md:h-11 max-md:w-full"
      disabled={!opened}
      onClick={() => opened && downloadReport(opened.report, `qredit-report-${vault.slice(0, 8)}-${orderId}.json`)}
    >
      Download report
    </Button>
  );
}

/** The report page (/inbox/[vault]/[orderId]): the checks, then the sealed report that opens in this browser. */
export function ReportPage({ vault, orderId }: { vault: Hex; orderId: string }) {
  const ctx = useReportContextQuery(vault, orderId);
  const loaded = ctx.data as Loaded | undefined;
  const order = loaded?.order;
  const delivered = order?.status === "delivered";
  const delivery = useDeliveryQuery(vault, orderId, order?.placedBlock ?? 0, Boolean(delivered));
  const open = useOpenReport();
  const wallet = useWallet((s) => testWalletOf(s.session));
  const kind = useWallet((s) => s.session.kind);
  const [phase, setPhase] = useState<Phase>({ kind: "sealed" });

  if (!loaded || !order) {
    if (ctx.isError) {
      return ctx.error instanceof ApiError && ctx.error.kind === "notFound" ? (
        <EmptyState art="notfound" title="This order does not exist." titleAs="h1" />
      ) : (
        <ErrorState title="This order could not be loaded." message="The service did not respond. Please try again shortly." onRetry={() => void ctx.refetch()} />
      );
    }
    return <ReportSkeleton />;
  }

  const { business } = loaded;
  const title = serviceName(business, order.serviceId);
  const from = `Order ${order.orderId} from ${business.name}`;

  if (!delivered) {
    return (
      <div className={FRAME}>
        <Breadcrumb />
        <Head title={title} description={`${from}.`} icon={Mail} tone="accent" action={<OpenedHeadAction opened={null} vault={vault} orderId={orderId} />} />
        <WaitingOrder ctx={loaded} />
      </div>
    );
  }

  const failure = delivery.isError ? delivery.error : null;
  if (failure instanceof ReportDoesNotMatch) {
    return (
      <div className={FRAME}>
        <Breadcrumb />
        <Head title={title} description={`${from}.`} icon={MailX} tone="danger" action={<OpenedHeadAction opened={null} vault={vault} orderId={orderId} />} />
        <Checks
          checks={{
            delivered: <CheckCard icon={Box} tone="ok" title="Delivered on chain" detail="The delivery is recorded on chain" />,
            envelope: <CheckCard icon={Hash} tone="failed" title="Envelope does not match" detail={`Expected ${shortHash(failure.expected)}`} />,
            opened: <CheckCard icon={KeyRound} tone="idle" title="Not opened" detail="Blocked for your safety" />,
          }}
        />
        <StateCard icon={ShieldAlert} tone="danger" title="This report was not opened" role="alert">
          <p className={lead}>The envelope does not match the one delivered on chain, so its contents cannot be trusted. This page did not open it.</p>
          <BackToInbox />
        </StateCard>
      </div>
    );
  }
  if (failure) {
    return (
      <div className={FRAME}>
        <Breadcrumb />
        <Head title={title} description={`${from}.`} icon={Mail} tone="accent" action={<OpenedHeadAction opened={null} vault={vault} orderId={orderId} />} />
        <ErrorState layout="section" title="The delivery could not be checked." message="The chain or the service did not respond. Nothing was opened. Please try again shortly." onRetry={() => void delivery.refetch()} />
      </div>
    );
  }

  const d: Delivery | undefined = delivery.data as Delivery | undefined;
  const when = d?.deliveredAt ? `, delivered on ${formatDateTime(d.deliveredAt)}` : "";
  const description = `${from}${when}.`;

  if (!d) {
    return (
      <div className={FRAME}>
        <Breadcrumb />
        <Head title={title} description={`${from}.`} icon={Mail} tone="accent" action={<OpenedHeadAction opened={null} vault={vault} orderId={orderId} />} />
        <Checks
          checks={{
            delivered: <CheckCard icon={Box} tone="working" title="Checking the delivery" detail="Reading the chain" />,
            envelope: <CheckCard icon={Hash} tone="idle" title="Envelope not checked yet" detail="Waiting for the chain" />,
            opened: <CheckCard icon={KeyRound} tone="idle" title="Not opened yet" detail="Opens in this browser only" />,
          }}
        />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  const opened = phase.kind === "opened" ? phase.opened : null;
  const parsed = opened ? parseReport(opened.report) : null;
  const unreadable = phase.kind === "unreadable";
  const opening = phase.kind === "opening";
  const keyCheck = opened ? (
    <CheckCard icon={KeyRound} tone="ok" title="Opened with your key" detail="In this browser only" />
  ) : unreadable ? (
    <CheckCard icon={KeyRound} tone="failed" title="Cannot be opened with this wallet" detail="Sealed to another key" />
  ) : opening ? (
    <CheckCard icon={KeyRound} tone="working" title="Opening with your key" detail="In this browser only" />
  ) : (
    <CheckCard icon={KeyRound} tone="idle" title="Not opened yet" detail="Opens in this browser only" />
  );

  const onOpen = async () => {
    setPhase({ kind: "opening" });
    // Let the opening state paint before the keys do their work.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      setPhase({ kind: "opened", opened: open(vault, orderId, d) });
    } catch (e) {
      setPhase(e instanceof ReportUnreadable ? { kind: "unreadable" } : { kind: "failed" });
    }
  };

  let card: ReactNode;
  if (opened) {
    card = parsed ? (
      <ReportView parsed={parsed} />
    ) : (
      <StateCard icon={MailOpen} title="This report has a format this page cannot show.">
        <p className={lead}>The report was opened with your key and checked, but its layout is not one this page knows. Download it to read it elsewhere.</p>
      </StateCard>
    );
  } else if (unreadable) {
    card = (
      <StateCard icon={Lock} tone="danger" title="This report cannot be opened with this wallet" role="alert">
        <p className={lead}>
          The report is sealed to the key of the wallet that placed order {order.orderId}, and only that key opens it. The delivery itself was checked against the chain and matches.
        </p>
        <BackToInbox />
      </StateCard>
    );
  } else if (opening) {
    card = (
      <StateCard icon={LoaderCircle} title="Opening your report">
        <p className={lead}>The report is opened here and never leaves this browser.</p>
        <Button size="lg" className="h-11" disabled>
          Opening
        </Button>
      </StateCard>
    );
  } else {
    card = (
      <StateCard icon={MailCheck} title="Your report is sealed">
        <p className={lead}>It opens in this browser with your wallet key. Nothing is sent to Qredit.</p>
        {phase.kind === "failed" && <Notice tone="danger">The report could not be opened. Please try again.</Notice>}
        {wallet ? (
          <Button size="lg" className="h-11" onClick={() => void onOpen()}>
            Open report
          </Button>
        ) : (
          <OpenGate kind={kind} />
        )}
      </StateCard>
    );
  }

  return (
    <div className={FRAME}>
      <Breadcrumb />
      <Head title={title} description={description} icon={opened ? MailOpen : Mail} tone="accent" action={<OpenedHeadAction opened={opened} vault={vault} orderId={orderId} />} />
      <Checks
        checks={{
          delivered: <CheckCard icon={Box} tone="ok" title="Delivered on chain" detail={`Block ${formatCount(d.blockNumber)}`} />,
          envelope: <CheckCard icon={Hash} tone="ok" title="Envelope matches the delivery" detail={`Hash ${shortHash(d.envelopeHash)}`} />,
          opened: keyCheck,
        }}
      />
      {card}
    </div>
  );
}
