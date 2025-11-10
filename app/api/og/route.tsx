import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { fetchPublicListByEventId, fetchPublicListByDTag, fetchProfile } from '@/lib/nostr';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Get parameters from URL
    const author = searchParams.get('author');
    const dtag = searchParams.get('dtag');
    const eventId = searchParams.get('eventId');

    // Default relay list (same as your pack page)
    const defaultRelays = [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine',
      'wss://relay.snort.social',
      'wss://nostr.mom',
      'wss://purplepag.es',
      'wss://nostr-pub.wellorder.net',
      'wss://nostr.land',
      'wss://relay.nostr.bg'
    ];

    // Fetch pack data from Nostr
    let pack = null;
    if (eventId) {
      pack = await fetchPublicListByEventId(eventId, defaultRelays);
    } else if (author && dtag) {
      pack = await fetchPublicListByDTag(author, dtag, defaultRelays);
    }

    // Fetch creator profile if we have the pack
    let creatorName = 'Anonymous';
    if (pack?.author) {
      try {
        const profile = await fetchProfile(pack.author, defaultRelays);
        if (profile) {
          creatorName = profile.display_name || profile.name || 'Anonymous';
        }
      } catch (error) {
        console.error('Failed to fetch creator profile:', error);
      }
    }

    // Fallback data if pack not found
    const packName = pack?.name || 'Mutable Community Pack';
    const packDescription = pack?.description || 'A curated mute list for Nostr';
    const mutedCount = pack ? (
      pack.list.pubkeys.length +
      pack.list.words.length +
      pack.list.tags.length +
      pack.list.threads.length
    ) : 0;

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            backgroundImage: 'linear-gradient(to bottom right, #1e293b, #0f172a)',
            padding: '80px',
          }}
        >
          {/* Logo and Brand */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              marginBottom: '60px',
            }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '16px',
                backgroundColor: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                fontWeight: 'bold',
                color: 'white',
              }}
            >
              M
            </div>
            <div
              style={{
                fontSize: '56px',
                fontWeight: 'bold',
                color: 'white',
              }}
            >
              mutable
            </div>
          </div>

          {/* Pack Name */}
          <div
            style={{
              fontSize: '64px',
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
              maxWidth: '1000px',
              lineHeight: 1.2,
              marginBottom: '24px',
            }}
          >
            {packName}
          </div>

          {/* Description */}
          {packDescription && (
            <div
              style={{
                fontSize: '32px',
                color: '#94a3b8',
                textAlign: 'center',
                maxWidth: '900px',
                marginBottom: '40px',
                lineHeight: 1.4,
              }}
            >
              {packDescription.length > 100
                ? packDescription.substring(0, 100) + '...'
                : packDescription}
            </div>
          )}

          {/* Creator and Stats */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                fontSize: '28px',
                color: '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span>Created by</span>
              <span
                style={{
                  color: '#ef4444',
                  fontWeight: 'bold',
                }}
              >
                {creatorName}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '40px',
                fontSize: '24px',
                color: '#94a3b8',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 'bold', color: '#cbd5e1' }}>{mutedCount}</span>
                <span>muted items</span>
              </div>
              {pack?.categories && pack.categories.length > 0 && (
                <>
                  <span>•</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{pack.categories.join(', ')}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (error) {
    console.error('OG Image generation error:', error);

    // Return a fallback error image
    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            color: 'white',
            gap: '20px',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '16px',
              backgroundColor: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '48px',
              fontWeight: 'bold',
            }}
          >
            M
          </div>
          <div style={{ fontSize: '40px' }}>
            Mutable - Community Pack
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  }
}
