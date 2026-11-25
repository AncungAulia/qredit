import { CircleCheck, LoaderCircle, Circle } from "lucide-react";
import type { PlaceOrderProgress } from "@/modules/orders/api/orders.api";
import { cn } from "@/lib/utils";

type Running = Exclude<PlaceOrderProgress, "placed">;

const STEPS: { id: Running; label: string }[] = [
  { id: "sealing", label: "Sealing your request to the agent's key" },
  { id: "posting", label: "Storing the sealed request" },
  { id: "window", label: "Preparing your wallet" },
  { id: "approving", label: "Allowing the business to take payment" },
  { id: "buying", label: "Paying into escrow" },
];

/** The steps of an order while it is sent: the finished ones are ticked, the running one shows a spinner. */
export function OrderProgress({ step, reached, slow }: { step: Running; reached: Running[]; slow?: boolean }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <ol className="flex flex-col gap-2.5">
        {STEPS.map((s, i) => {
          const state = i < at ? "done" : i === at ? "running" : "waiting";
          return (
            <li
              key={s.id}
              aria-current={state === "running" ? "step" : undefined}
              className={cn("flex items-center gap-2.5 text-sm", state === "waiting" ? "text-text-tertiary" : "text-text-primary")}
            >
              {state === "done" ? (
                <CircleCheck className="size-[18px] shrink-0 text-success" aria-hidden />
              ) : state === "running" ? (
                <LoaderCircle className="size-[18px] shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Circle className="size-[18px] shrink-0" aria-hidden />
              )}
              <span>{s.id === "approving" && state === "done" && !reached.includes("approving") ? "Already allowed" : s.label}</span>
              <span className="sr-only">{state === "done" ? "Done" : state === "running" ? "In progress" : "Waiting"}</span>
            </li>
          );
        })}
      </ol>
      {slow && <p className="text-[13px] text-text-secondary">The chain is taking longer than usual. Your funds are safe.</p>}
    </div>
  );
}
