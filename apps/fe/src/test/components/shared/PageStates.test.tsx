import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";

test("the title of a state is a heading", () => {
  render(<EmptyState art="search" title="No businesses are listed yet." />);
  expect(screen.getByRole("heading", { level: 2, name: "No businesses are listed yet." })).toBeInTheDocument();
});

test("an error state titles itself with a heading, and a whole-page state can use a level one heading", () => {
  const { rerender } = render(<ErrorState title="The market could not be loaded." />);
  expect(screen.getByRole("heading", { level: 2, name: "The market could not be loaded." })).toBeInTheDocument();
  rerender(<EmptyState art="notfound" titleAs="h1" title="This page does not exist" />);
  expect(screen.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeInTheDocument();
});