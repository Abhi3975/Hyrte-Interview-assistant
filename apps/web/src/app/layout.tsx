import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ThemeScript } from '@/components/theme-script';

export const metadata: Metadata = {
  title: 'HYRTE — AI Interviews & Zero-Trust Proctoring',
  description:
    'Conduct human-like AI voice & video interviews, DSA and full-stack assessments, with enterprise-grade proctoring. Built to scale to 100k+ concurrent users.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
