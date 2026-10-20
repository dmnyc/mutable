import { Suspense } from "react";
import { Metadata } from "next";
import BloomReaperWrapper from "@/components/BloomReaperWrapper";

const title = "Bloom Reaper by Mutable: Find and reap your Blossom uploads";
const description =
  "Every file you've uploaded to Blossom, on every server you use. Find the images you lost track of, copy their links, see which posts still point at files that are gone, or ask the servers to delete them.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    url: "https://www.mutable.top/bloom-reaper",
    type: "website",
    images: ["/bloom_reaper_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/bloom_reaper_social_card.png"],
  },
};

export default function BloomReaperPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <BloomReaperWrapper />
    </Suspense>
  );
}
