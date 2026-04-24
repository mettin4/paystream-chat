import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { getOperatorAddressSafe } from "@/lib/circle";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "PayStream",
  description:
    "Pay per word, not per month. Stream USDC nanopayments to AI on Arc Testnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-app-base text-ink-primary`}
      >
        <TopNav />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}

function TopNav() {
  const operator = getOperatorAddressSafe();
  return (
    <nav className="sticky top-0 z-50 border-b border-stroke-subtle bg-app-base/95 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-[1200px] items-center justify-between px-6">
        <Link
          href="/"
          className="text-[13px] font-semibold tracking-tight text-ink-primary"
        >
          PayStream
        </Link>
        <div className="flex items-center gap-2">
          {operator && (
            <span
              className="rounded-full border border-stroke-subtle bg-app-elevated px-2.5 py-1 font-mono text-[11px] text-ink-secondary"
              title={operator}
            >
              {truncateAddress(operator)}
            </span>
          )}
          <div className="flex items-center gap-1.5 rounded-full border border-stroke-subtle bg-app-elevated px-2.5 py-1 font-mono text-[11px] text-ink-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent soft-pulse" />
            Live
          </div>
        </div>
      </div>
    </nav>
  );
}

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-stroke-subtle">
      <div className="mx-auto flex h-11 max-w-[1200px] items-center px-6 font-mono text-[11px] text-ink-tertiary">
        Built for Agentic Economy on Arc Hackathon 2026 · Team MTHOCP
      </div>
    </footer>
  );
}
