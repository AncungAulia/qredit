// src/app/Providers.tsx: theme, server-state and toast providers, wrapped around {children} in layout.tsx.
"use client";

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { getQueryClient } from "@/lib/queryClient";

// Tablet breakpoint from the UI profile: toasts sit top-center on a phone, bottom-right from tablet up.
const TABLET_UP = "(min-width: 768px)";

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const isTabletUp = useMediaQuery(TABLET_UP);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster position={isTabletUp ? "bottom-right" : "top-center"} />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
