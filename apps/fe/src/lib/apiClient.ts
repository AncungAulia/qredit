import axios from "axios";
import type { z } from "zod";
import { env } from "./env";

export type ApiErrorKind = "network" | "notFound" | "rateLimited" | "server" | "invalid";
const MESSAGES: Record<ApiErrorKind, string> = {
  network: "Qredit could not be reached. Check your connection and try again.",
  notFound: "This item could not be found.",
  rateLimited: "Too many requests were sent. Please wait a moment and try again.",
  server: "Something went wrong on our side. Please try again.",
  invalid: "The request could not be processed.",
};

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status?: number) {
    super(MESSAGES[kind]);
    this.name = "ApiError";
  }
}

/** Maps a failed request to an ApiError by status. Cancels pass through unchanged so callers can ignore them. */
export function toApiError(e: unknown): unknown {
  if (axios.isCancel(e)) return e;
  const s = axios.isAxiosError<unknown, unknown>(e) ? e.response?.status : undefined;
  if (!s) return new ApiError("network");
  if (s === 404) return new ApiError("notFound", s);
  if (s === 429) return new ApiError("rateLimited", s);
  if (s >= 500) return new ApiError("server", s);
  return new ApiError("invalid", s);
}

/** Parses a response body; a body that does not match the schema is an invalid response. */
export function parseResponse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiError("invalid");
  return result.data;
}

export const api = axios.create({ baseURL: env.apiUrl, timeout: 20_000 });

api.interceptors.response.use(undefined, (e: unknown) => Promise.reject(toApiError(e)));
