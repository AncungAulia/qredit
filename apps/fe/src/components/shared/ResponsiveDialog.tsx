"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

// Tablet breakpoint from the UI profile: a dialog from tablet up, a sheet from the bottom on a phone.
const TABLET_UP = "(min-width: 768px)";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** False while the chain is still deciding: Escape, the backdrop, the close button and a swipe do nothing. */
  dismissible?: boolean;
  /** Extra classes for the content area. */
  className?: string;
  /** "alertdialog" for a confirmation that interrupts the user. */
  role?: "dialog" | "alertdialog";
};

/** Dialog on tablet and desktop, bottom sheet on a phone (design components ConnectDialog and ConnectSheet). */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  dismissible = true,
  className,
  role = "dialog",
}: Props) {
  const wide = useMediaQuery(TABLET_UP);
  const change = (next: boolean) => {
    if (dismissible || next) onOpenChange(next);
  };

  if (wide) {
    return (
      <Dialog open={open} onOpenChange={change} disablePointerDismissal={!dismissible}>
        <DialogContent
          role={role}
          showCloseButton={dismissible && role === "dialog"}
          className={cn(
            "max-h-[calc(100dvh-4rem)] gap-5 overflow-y-auto rounded-[24px] bg-surface p-7 shadow-[0_24px_64px_var(--shadow)] ring-1 ring-border transition-opacity data-[nested-dialog-open]:opacity-40 sm:max-w-[440px]",
            className,
          )}
        >
          <div className="flex flex-col gap-1 pr-8">
            <DialogTitle className="text-xl leading-snug font-medium">{title}</DialogTitle>
            {description && (
              <DialogDescription className="text-[13px] text-text-secondary">
                {description}
              </DialogDescription>
            )}
          </div>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={change} showSwipeHandle={dismissible} disablePointerDismissal={!dismissible}>
      <DrawerContent role={role} className="rounded-t-[24px] bg-surface">
        <DrawerHeader className="gap-1 px-5 pt-4 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="text-xl leading-snug font-medium">{title}</DrawerTitle>
          {description && (
            <DrawerDescription className="text-[13px] text-balance text-text-secondary">
              {description}
            </DrawerDescription>
          )}
        </DrawerHeader>
        <div className={cn("flex min-h-0 flex-col gap-5 overflow-y-auto px-5 pt-4 pb-7", className)}>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
