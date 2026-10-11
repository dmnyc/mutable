import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter, Montserrat } from "next/font/google";
import { themeInitScript } from "@/lib/theme";
import AmbientBackdrop from "@/components/system/AmbientBackdrop";
import "./globals.css";

// Self-hosted at build time by next/font; exposed as CSS variables that
// tailwind.config.ts maps to font-sans and font-display.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mutable.top"),
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${montserrat.variable}`}
    >
      <body className="antialiased font-sans">
        {/* Applies the stored theme before first paint to avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AmbientBackdrop />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
