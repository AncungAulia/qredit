import { expect, test } from "vitest";
import { serviceName } from "@/lib/serviceName";

const business = { services: [{ id: 0, name: "Grade", priceUnits: 250000n }] };

test("names a listed service and numbers an unlisted one", () => {
  expect(serviceName(business, 0)).toBe("Grade");
  expect(serviceName(business, 7)).toBe("Service 7");
});