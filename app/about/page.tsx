import type { Metadata } from "next";
import About from "@/components/About";

export const metadata: Metadata = {
  title: "About — Mutable",
  description:
    "A toolkit for your Nostr mute list, your follows and your public record.",
};

export default function AboutPage() {
  return <About />;
}
