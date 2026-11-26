import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";

const props = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("sonner", () => ({
  Toaster: (p: Record<string, unknown>) => {
    props.last = p;
    return null;
  },
}));

test("the toaster follows the design toast: close button, status icons, glass surface, title and description", () => {
  render(<Toaster />);
  const p = props.last as {
    closeButton: boolean;
    icons: Record<string, unknown>;
    style: Record<string, string>;
    toastOptions: { classNames: Record<string, string> };
  };
  expect(p.closeButton).toBe(true);
  expect(Object.keys(p.icons)).toEqual(expect.arrayContaining(["success", "error", "close"]));
  expect(p.style["--normal-bg"]).toBe("var(--glass-strong)");
  expect(p.style["--normal-border"]).toBe("var(--glass-edge)");
  expect(p.style["--border-radius"]).toBe("var(--radius-lg)");
  const c = p.toastOptions.classNames;
  expect(c.title).toContain("!text-text-primary");
  expect(c.description).toContain("!text-text-secondary");
  expect(c.closeButton).toContain("!order-last");
});
