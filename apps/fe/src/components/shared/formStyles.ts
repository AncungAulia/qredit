// Classes that bring the shadcn form controls to the design's Input component: 48 px, strong border, accent focus, danger when invalid.
export const controlClass =
  "h-12 rounded-md border-border-strong bg-surface px-3.5 text-base placeholder:text-text-tertiary focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger dark:bg-surface md:text-base";

/** The error line under a field: danger text, an icon comes first in the markup. */
export const fieldErrorClass = "flex items-start gap-1.5 text-[13px] text-danger";

/** The help line under a field. */
export const fieldHelpClass = "text-[13px] text-text-tertiary";
