// src/lib/queryClient.ts
import { QueryClient, isServer } from "@tanstack/react-query";
import { ApiError } from "./apiClient";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // Retry once on network or 5xx errors; a 4xx will not fix itself.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status !== null && error.status < 500)
            return false;
          return failureCount < 1;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** New client per server request; one shared client in the browser. */
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
