import { describe, expect, test } from "vitest";
import { formatBps, formatCount, formatDateTime, formatFusd, formatRelative, parseFusd, shortAddress, shortHash } from "@/lib/format";

describe("fUSD", () => {
  test("formats 6-decimal units with two decimals", () => {
    expect(formatFusd(250000n)).toBe("0.25 fUSD");
    expect(formatFusd("3000000")).toBe("3.00 fUSD");
    expect(formatFusd(1234567890n, { unit: false })).toBe("1,234.57");
  });
  test("keeps precision below one cent", () => {
    expect(formatFusd(5000n)).toBe("0.005 fUSD");
    expect(formatFusd(1n)).toBe("0.000001 fUSD");
    expect(formatFusd(0n)).toBe("0.00 fUSD");
  });
  test("parses user text into units", () => {
    expect(parseFusd("0.25")).toBe(250000n);
    expect(parseFusd("1,000.5")).toBe(1000500000n);
    expect(parseFusd("0.0000001")).toBeNull();
    expect(parseFusd("abc")).toBeNull();
    expect(parseFusd("")).toBeNull();
  });
});

describe("other formats", () => {
  test("basis points", () => expect(formatBps(7000)).toBe("70%"));
  test("date and time in UTC", () => expect(formatDateTime(Date.UTC(2026, 10, 24, 18, 49))).toBe("24 Nov 2026, 18:49 UTC"));
  test("relative time", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0);
    expect(formatRelative(now - 30_000, now)).toBe("just now");
    expect(formatRelative(now - 2 * 60_000, now)).toBe("2 minutes ago");
    expect(formatRelative(now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(formatRelative(now - 26 * 60 * 60_000, now)).toBe("yesterday");
    expect(formatRelative(now - 3 * 24 * 60 * 60_000, now)).toBe("22 Nov 2026");
  });
  test("future times never read as just now", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0);
    expect(formatRelative(now + 30_000, now)).toBe("in less than a minute");
    expect(formatRelative(now + 59_999, now)).toBe("in less than a minute");
    expect(formatRelative(now + 60_000, now)).toBe("in 1 minute");
    expect(formatRelative(now + 2 * 60_000, now)).toBe("in 2 minutes");
    expect(formatRelative(now + 60 * 60_000, now)).toBe("in 1 hour");
    expect(formatRelative(now + 3 * 60 * 60_000, now)).toBe("in 3 hours");
    expect(formatRelative(now + 26 * 60 * 60_000, now)).toBe("26 Nov 2026");
  });
  test("exactly now is just now", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0);
    expect(formatRelative(now, now)).toBe("just now");
  });
  test("short forms", () => {
    expect(shortAddress("0x487f449c21a48eaf9d2eb3804f511dfb7715eea9")).toBe("0x487f…eea9");
    expect(shortAddress("qor1abcdefghijklmnopqrstuvwxyz0123456789ab")).toBe("qor1ab…89ab");
    expect(shortHash("0x2b65030eba743f8980aef7bde0b48dc4056b81a5d080a5b76ee03c34792ed85f")).toBe("0x2b65…d85f");
  });
});

test("counts get thousands separators", () => {
  expect(formatCount(1234)).toBe("1,234");
});

test("durations use the largest exact unit", async () => {
  const { formatDuration } = await import("@/lib/format");
  expect(formatDuration(3600)).toBe("1 hour");
  expect(formatDuration(7200)).toBe("2 hours");
  expect(formatDuration(5400)).toBe("90 minutes");
  expect(formatDuration(86400)).toBe("1 day");
  expect(formatDuration(45)).toBe("45 seconds");
});
