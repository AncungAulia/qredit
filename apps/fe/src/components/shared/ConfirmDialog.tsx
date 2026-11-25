"use client";

import type { ReactNode } from "react";
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const TABLET_UP = "(min-width: 768px)";

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
  /** Replaces the Cancel and Confirm buttons (a waiting state, or Close and Try again). */
  actions?: ReactNode;
  /** False while an action is in flight: the dialog cannot be closed. */
  dismissible?: boolean;
};

/**
 * The design's ConfirmDialog and ConfirmSheet. From tablet up it is a shadcn alert dialog (it never closes on an
 * outside click); on a phone it is the same content in a bottom sheet.
 */
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
  const wide = useMediaQuery(TABLET_UP);
  const buttons = actions ?? (
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
  );

  if (!wide) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} role="alertdialog" dismissible={dismissible}>
        <p className="text-[15px] leading-normal text-text-secondary">{body}</p>
        {children}
        {status}
        {buttons}
      </ResponsiveDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (dismissible || next) && onOpenChange(next)}>
      <AlertDialogContent className="gap-5 rounded-[24px] bg-surface p-7 shadow-[0_24px_64px_var(--shadow)] ring-1 ring-border data-[size=default]:max-w-[440px] data-[size=default]:sm:max-w-[440px]">
        <AlertDialogTitle className="text-xl leading-snug font-medium">{title}</AlertDialogTitle>
        <AlertDialogDescription className="text-[15px] leading-normal text-text-secondary md:text-[15px]">
          {body}
        </AlertDialogDescription>
        {children}
        {status}
        {buttons}
      </AlertDialogContent>
    </AlertDialog>
  );
}
