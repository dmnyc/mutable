import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mutable - Nostr Mute List Manager",
  description: "Your Nostr Mute List Manager",
  icons: {
    icon: '/mutable_logo.svg',
  },
  openGraph: {
    title: "Mutable - Nostr Mute List Manager",
    description: "Your Nostr Mute List Manager",
    images: ['/mutable_social_card.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Mutable - Nostr Mute List Manager",
    description: "Your Nostr Mute List Manager",
    images: ['/mutable_social_card.png'],
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
      </body>
    </html>
  );
}
