"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react";

/**
 * Toast/Success and Toast/Error of the design: a status icon, a title, a secondary line and a close button on
 * the strong glass surface. Sonner's own styles win the cascade, so each class needs the important modifier.
 */
export const toastClassNames: NonNullable<ToasterProps["toastOptions"]>["classNames"] = {
  toast:
    "cn-toast !items-start !gap-3 !p-4 !shadow-[0_1px_2px_var(--shadow),0_12px_32px_var(--shadow)] !backdrop-blur-xl",
  content: "!gap-1",
  title: "!text-[15px] !leading-snug !font-medium !text-text-primary",
  description: "!text-sm !leading-snug !font-normal !text-text-secondary",
  icon: "!m-0 !size-[18px] !shrink-0 [&_svg]:!size-[18px]",
  closeButton:
    "!static !order-last !size-7 !shrink-0 !translate-none !rounded-full !border-0 !bg-transparent !text-text-tertiary hover:!bg-surface-hover hover:!text-text-primary",
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-[18px] text-success" />,
        info: <InfoIcon className="size-[18px] text-accent-strong" />,
        warning: <TriangleAlertIcon className="size-[18px] text-warning" />,
        error: <CircleAlertIcon className="size-[18px] text-danger" />,
        loading: <Loader2Icon className="size-[18px] animate-spin text-text-secondary" />,
        close: <XIcon className="size-3.5" />,
      }}
      style={
        {
          "--normal-bg": "var(--glass-strong)",
          "--normal-text": "var(--text-primary)",
          "--normal-border": "var(--glass-edge)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: toastClassNames }}
      {...props}
    />
  );
};

export { Toaster };
