import axios, { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ApiError, parseResponse, toApiError, type ApiErrorKind } from "./apiClient";

const httpError = (status: number) =>
  new AxiosError("request failed", "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);

describe("toApiError", () => {
  test("maps a missing response to network", () => {
    const e = toApiError(new AxiosError("Network Error", "ERR_NETWORK"));
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).kind).toBe("network");
  });

  test.each<[number, ApiErrorKind]>([
    [404, "notFound"],
    [429, "rateLimited"],
    [500, "server"],
    [400, "invalid"],
  ])("maps status %i to %s", (status, kind) => {
    const e = toApiError(httpError(status)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.kind).toBe(kind);
    expect(e.status).toBe(status);
  });

  test("sets the error name", () => {
    expect((toApiError(httpError(500)) as ApiError).name).toBe("ApiError");
  });

  test("rethrows a cancel unchanged", () => {
    const cancel = new axios.CanceledError("canceled");
    expect(toApiError(cancel)).toBe(cancel);
  });
});

describe("parseResponse", () => {
  const schema = z.object({ id: z.number() });

  test("returns the parsed data when it matches", () => {
    expect(parseResponse(schema, { id: 1 })).toEqual({ id: 1 });
  });

  test("throws an invalid ApiError when it does not match", () => {
    expect(() => parseResponse(schema, { id: "x" })).toThrow(ApiError);
    try {
      parseResponse(schema, { id: "x" });
    } catch (e) {
      expect((e as ApiError).kind).toBe("invalid");
    }
  });
});
