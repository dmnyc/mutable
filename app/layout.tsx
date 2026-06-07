import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.mutable.top"),
  title: "Mutable - Your Nostr Mute List Manager",
  description: "Your Nostr Mute List Manager",
  icons: {
    icon: '/mutable_logo.svg',
  },
  openGraph: {
    type: "website",
    title: "Mutable - Your Nostr Mute List Manager",
    description: "Your Nostr Mute List Manager",
    images: [
      {
        url: "/mutable_social_card.png",
        width: 1200,
        height: 630,
        alt: "Mutable — Your Nostr Mute List Manager",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mutable - Your Nostr Mute List Manager",
    description: "Your Nostr Mute List Manager",
    images: [
      {
        url: "/mutable_social_card.png",
        width: 1200,
        height: 630,
        alt: "Mutable — Your Nostr Mute List Manager",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
