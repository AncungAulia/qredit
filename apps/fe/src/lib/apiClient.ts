// src/lib/apiClient.ts: one axios instance; every failure becomes an ApiError with a kind
// and a message written for people. Copy follows the UI profile; translate it per product.
import axios from "axios";
import type { z } from "zod";
import { env } from "./env";

export type ApiErrorKind =
  | "offline"
  | "unreachable"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "server"
  | "invalid_response"
  | "unknown";

const MESSAGES: Record<ApiErrorKind, string> = {
  offline: "This device is offline. Please check the internet connection and try again.",
  unreachable: "The server could not be reached. Please check the connection and try again.",
  timeout: "The server took too long to respond. Please try again shortly.",
  unauthorized: "Your session has ended. Please sign in again.",
  forbidden: "You do not have access to this data.",
  not_found: "The data could not be found. It may have been removed.",
  conflict: "The data was changed elsewhere. Please reload and try again.",
  validation: "Some input is not valid. Please review it and try again.",
  server: "The server has a problem. Please try again shortly.",
  invalid_response: "The data received could not be read. Please try again later.",
  unknown: "An unexpected error occurred. Please try again.",
};

/**
 * Show the backend's own message instead of the mapped one. Turn on only when the UI profile
 * says the API returns messages in the UI language; otherwise they stay in `details`.
 */
const SHOW_SERVER_MESSAGES = false;

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    /** HTTP status, or null when no response arrived. */
    readonly status: number | null = null,
    /** Raw response body or validation issues, for logs, never for the screen. */
    readonly details?: unknown,
    message: string = MESSAGES[kind],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiClient = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "unknown";
}

function serverMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return undefined;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const { status, data } = error.response;
      const kind = kindFromStatus(status);
      const fromServer = SHOW_SERVER_MESSAGES ? serverMessage(data) : undefined;
      return new ApiError(kind, status, data, fromServer ?? MESSAGES[kind]);
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return new ApiError("timeout");
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return new ApiError(offline ? "offline" : "unreachable");
  }
  return new ApiError("unknown", null, error);
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Cancellations (query unmounted, filter changed) must stay cancellations.
    if (axios.isCancel(error)) return Promise.reject(error);
    return Promise.reject(toApiError(error));
  },
);

/** Validate a response body. A shape mismatch is an error, never patched with defaults. */
export function parseResponse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiError("invalid_response", null, result.error.issues);
  return result.data;
}
