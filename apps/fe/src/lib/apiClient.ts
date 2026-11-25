import axios, { AxiosError } from "axios";
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
  }
}

export const api = axios.create({ baseURL: env.apiUrl, timeout: 20_000 });

api.interceptors.response.use(undefined, (e: AxiosError) => {
  const s = e.response?.status;
  if (!s) return Promise.reject(new ApiError("network"));
  if (s === 404) return Promise.reject(new ApiError("notFound", s));
  if (s === 429) return Promise.reject(new ApiError("rateLimited", s));
  if (s >= 500) return Promise.reject(new ApiError("server", s));
  return Promise.reject(new ApiError("invalid", s));
});
