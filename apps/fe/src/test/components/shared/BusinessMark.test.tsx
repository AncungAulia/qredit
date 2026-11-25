import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { BusinessMark } from "@/components/shared/BusinessMark";

test("a known business shows its two themed images", () => {
  const { container } = render(<BusinessMark slug="counterparty-check" />);
  expect(container.querySelectorAll("img")).toHaveLength(2);
});

test("an unknown slug shows a placeholder, not a broken image", () => {
  const { container } = render(<BusinessMark slug="no-such-agent" />);
  expect(container.querySelectorAll("img")).toHaveLength(0);
  expect(container.querySelector("svg")).not.toBeNull();
});
