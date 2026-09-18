import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://morbin.parthkhandelwal-dev.workers.dev";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Morbin — Early Access for Event Organisers",
    template: "%s — Morbin",
  },
  description:
    "Morbin is a new platform for people who organise events. Join the early-access list and be first in when we launch.",
  keywords: [
    "Morbin",
    "event organiser",
    "event planning",
    "early access",
    "event management",
  ],
  authors: [{ name: "Morbin" }],
  creator: "Morbin",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Morbin",
    title: "Morbin — Early Access for Event Organisers",
    description:
      "A new platform for people who organise events. Join the early-access list.",
  },
  twitter: {
    card: "summary",
    title: "Morbin — Early Access for Event Organisers",
    description:
      "A new platform for people who organise events. Join the early-access list.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Morbin",
      url: siteUrl,
    },
    {
      "@type": "WebSite",
      name: "Morbin",
      url: siteUrl,
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
