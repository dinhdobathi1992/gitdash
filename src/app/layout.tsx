import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr";
import { AuthProvider } from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GitDash — GitHub Actions Dashboard",
  description: "Monitor all your GitHub Actions workflows in one place",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-950 text-slate-100 min-h-screen`}>
        <SWRProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
