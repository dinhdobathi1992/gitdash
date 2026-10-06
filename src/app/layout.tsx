import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr";
import { AuthProvider } from "@/components/AuthProvider";
import { FeatureFlagsProvider } from "@/components/FeatureFlagsProvider";
import AppShell from "@/components/AppShell";
import { siteUrl } from "@/lib/site";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Canonical, Open Graph and sitemap URLs resolve against the public origin.
  metadataBase: siteUrl(),
  title: "GitDash — GitHub Actions Dashboard",
  description: "Monitor all your GitHub Actions workflows in one place",
  openGraph: { siteName: "GitDash", type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-ground text-fg min-h-screen`}>
        <SWRProvider>
          <AuthProvider>
            <FeatureFlagsProvider>
              <AppShell>{children}</AppShell>
            </FeatureFlagsProvider>
          </AuthProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
