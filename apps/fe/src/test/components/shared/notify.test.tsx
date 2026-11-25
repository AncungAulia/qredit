import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { notifySuccess } from "@/components/shared/notify";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => toast.success.mockClear());

test("a title with a line of text passes the text as the description", () => {
  notifySuccess("Address copied", { text: "qor1x7m4…k29fk2 is on your clipboard." });
  expect(toast.success).toHaveBeenCalledWith("Address copied", {
    description: "qor1x7m4…k29fk2 is on your clipboard.",
  });
});

test("a transaction adds its link after the text", () => {
  notifySuccess("Order placed", { text: "Your payment has been sent.", hash: "0xabc123" });
  const { description } = toast.success.mock.calls[0][1];
  render(<>{description}</>);
  expect(screen.getByText("Your payment has been sent.")).toBeInTheDocument();
  expect(screen.getByTitle("0xabc123")).toBeInTheDocument();
});

test("a title alone has no description", () => {
  notifySuccess("Done");
  expect(toast.success).toHaveBeenCalledWith("Done", { description: undefined });
});
