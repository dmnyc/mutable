import { Suspense } from "react";
import { Metadata } from "next";
import MuggableWrapper from "@/components/MuggableWrapper";

interface Props {
  params: Promise<{ identifier: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params;
  const decoded = decodeURIComponent(identifier);
  const title = `Muggable: ${decoded}`;
  return {
    title,
    description:
      "Check if this Nostr identity controls Bitcoin on-chain. A Nostr nsec is also a Bitcoin private key — see the exposure before someone else does.",
    openGraph: {
      title,
      description:
        "Check if this Nostr identity controls Bitcoin on-chain. A Nostr nsec is also a Bitcoin private key — see the exposure before someone else does.",
      images: ["/muggable_social_card.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description:
        "Check if this Nostr identity controls Bitcoin on-chain. A Nostr nsec is also a Bitcoin private key — see the exposure before someone else does.",
      images: ["/muggable_social_card.png"],
    },
  };
}

export default async function MuggableIdentifierPage({ params }: Props) {
  const { identifier } = await params;
  const initialQuery = decodeURIComponent(identifier);

  return (
    <Suspense
      fallback={
        <div className="min-h-screen" />
      }
    >
      <MuggableWrapper initialQuery={initialQuery} />
    </Suspense>
  );
}
