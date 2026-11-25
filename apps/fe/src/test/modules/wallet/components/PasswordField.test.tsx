import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PasswordField } from "@/modules/wallet/components/PasswordField";

test("the eye button switches the field between hidden and shown", () => {
  render(<PasswordField id="p" label="Password" autoComplete="new-password" />);
  const input = screen.getByLabelText("Password");
  expect(input).toHaveAttribute("type", "password");
  const toggle = screen.getByRole("button", { name: "Show password" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(input).toHaveAttribute("type", "password");
});

test("toggling does not submit the form", () => {
  const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <PasswordField id="p" label="Password" autoComplete="current-password" />
    </form>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(onSubmit).not.toHaveBeenCalled();
});

test("each field toggles on its own and is hidden again after a remount", () => {
  const { unmount } = render(
    <>
      <PasswordField id="a" label="First" autoComplete="new-password" />
      <PasswordField id="b" label="Second" autoComplete="new-password" />
    </>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[0]);
  expect(screen.getByLabelText("First")).toHaveAttribute("type", "text");
  expect(screen.getByLabelText("Second")).toHaveAttribute("type", "password");
  unmount();
  render(<PasswordField id="a" label="First" autoComplete="new-password" />);
  expect(screen.getByLabelText("First")).toHaveAttribute("type", "password");
});
