/**
 * src/lib/queryClient.ts
 * Shared TanStack React Query client instance.
 *
 * Exported as a singleton so it can be used by:
 *  - main.tsx (QueryClientProvider)
 *  - sseClient.ts (cache invalidation on SSE events)
 *  - Any component that needs imperative access
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,       // 1 minute before refetch
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
