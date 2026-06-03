/**
 * src/main.tsx
 * Application entry point.
 * Wraps App with ErrorBoundary, AuthProvider, QueryClientProvider, and ThemeProvider.
 */
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import App from './app/App.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import { ErrorBoundary } from './app/components/ErrorBoundary.tsx';
import { queryClient } from './lib/queryClient.ts';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>,
);