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

  // Build OG image URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const ogImageUrl = new URL('/api/og', baseUrl);

  if (eventId) {
    ogImageUrl.searchParams.set('eventId', eventId);
  } else if (author && dtag) {
    ogImageUrl.searchParams.set('author', author);
    ogImageUrl.searchParams.set('dtag', dtag);
  }

  return {
    title: 'Mutable Community Pack',
    description: 'A curated mute list for Nostr',
    openGraph: {
      title: 'Mutable Community Pack',
      description: 'A curated mute list for Nostr',
      images: [
        {
          url: ogImageUrl.toString(),
          width: 1200,
          height: 630,
          alt: 'Mutable Community Pack Preview',
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Mutable Community Pack',
      description: 'A curated mute list for Nostr',
      images: [ogImageUrl.toString()],
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
