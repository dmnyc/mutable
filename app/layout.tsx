import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mutable - Nostr Mute List Manager",
  description: "Manage, backup, and share your Nostr mute lists",
  icons: {
    icon: '/mutable_logo.svg',
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
