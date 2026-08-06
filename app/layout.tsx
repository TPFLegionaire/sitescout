import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteScout",
  description: "Evidence-led, multi-site website quality operations with human-reviewed findings.",
  openGraph: {
    title: "SiteScout",
    description: "Evidence-led website quality operations.",
    images: [{ url: "/quality-signal-card.png", width: 1664, height: 947, alt: "Abstract optical quality signal passing a verification gate" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SiteScout",
    description: "Evidence-led website quality operations.",
    images: ["/quality-signal-card.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
