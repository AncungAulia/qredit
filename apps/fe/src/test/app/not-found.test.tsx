import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
import NotFound from "../../../app/not-found";

test("the not-found page has one level one heading", () => {
  render(<NotFound />);
  expect(screen.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeInTheDocument();
});