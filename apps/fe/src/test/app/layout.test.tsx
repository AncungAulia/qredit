import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Providers } from "../../../app/Providers";

test("providers render children", () => {
  render(
    <Providers>
      <p>Hello</p>
    </Providers>,
  );
  expect(screen.getByText("Hello")).toBeInTheDocument();
});
