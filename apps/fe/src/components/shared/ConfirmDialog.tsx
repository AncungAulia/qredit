"use client";

import type { ReactNode } from "react";
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen and what it costs; written as complete sentences. */
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** An irreversible action uses the danger button. */
  destructive?: boolean;
  /** Extra content between the body and the actions (a summary block). */
  children?: ReactNode;
  /** A message under the summary: the refusal of a chain action. */
  status?: ReactNode;
  /** Replaces the Cancel and Confirm buttons (a waiting state, or a single Close). */
  actions?: ReactNode;
  /** False while an action is in flight: the dialog cannot be closed. */
  dismissible?: boolean;
};

/** The design's ConfirmDialog and ConfirmSheet: one component, a dialog on tablet and up and a sheet on a phone. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive,
  children,
  status,
  actions,
  dismissible = true,
}: Props) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} role="alertdialog" dismissible={dismissible}>
      <p className="text-[15px] leading-normal text-text-secondary">{body}</p>
      {children}
      {status}
      {actions ?? (
        <div className="flex gap-2.5 max-md:flex-col-reverse md:justify-end">
          <Button variant="ghost" size="lg" className="h-11 px-4 max-md:w-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="lg"
            className="h-11 px-4 max-md:w-full"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      )}
    </ResponsiveDialog>
  );
}
