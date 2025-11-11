import { Metadata } from 'next';
import { fetchPublicListByEventId, fetchPublicListByDTag, fetchProfile } from '@/lib/nostr';

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

  // Default values
  let packName = 'Mutable Community Pack';
  let creatorName = 'Anonymous';
  let itemCount = 0;

  // Fetch pack data
  try {
    const defaultRelays = [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine'
    ];

    // Get pack data
    let packEvent;
    if (eventId) {
      packEvent = await Promise.race([
        fetchPublicListByEventId(eventId, defaultRelays),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Pack fetch timeout')), 5000))
      ]) as any;
    } else if (author && dtag) {
      packEvent = await Promise.race([
        fetchPublicListByDTag(author, dtag, defaultRelays),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Pack fetch timeout')), 5000))
      ]) as any;

      // Convert dtag to display name
      packName = dtag
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    if (packEvent) {
      itemCount = packEvent.tags.filter((t: string[]) => t[0] === 'p').length;
    }

    // Get creator profile
    if (author) {
      try {
        const profile = await Promise.race([
          fetchProfile(author, defaultRelays),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Profile fetch timeout')), 5000))
        ]) as any;

        if (profile) {
          creatorName = profile.display_name || profile.name || 'Anonymous';
        }
      } catch (error) {
        console.error('Failed to fetch creator profile:', error);
      }
    }
  } catch (error) {
    console.error('Failed to fetch pack data for metadata:', error);
  }

  // Build static OG image URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const ogImageUrl = `${baseUrl}/mutable_community_pack.png`;

  const title = `${packName} by ${creatorName}`;
  const description = `A curated mute list for Nostr with ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;

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
