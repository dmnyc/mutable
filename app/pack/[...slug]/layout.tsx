import { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;

  // Determine format
  const isEventIdFormat = slug.length === 1;
  const eventId = isEventIdFormat ? slug[0] : null;
  const author = !isEventIdFormat ? slug[0] : null;
  const dtag = !isEventIdFormat ? slug[1] : null;

  // Use dtag for pack name if available
  let packName = 'Mutable Community Pack';
  if (dtag) {
    packName = dtag
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Build static OG image URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    ? process.env.NEXT_PUBLIC_BASE_URL
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const ogImageUrl = `${baseUrl}/mutable_community_pack.png`;

  const title = packName;
  const description = `A curated mute list for Nostr`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${packName} - Mutable Community Pack`,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function PackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
