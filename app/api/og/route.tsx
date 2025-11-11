import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { fetchPublicListByEventId, fetchPublicListByDTag, fetchProfile } from '@/lib/nostr';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Get parameters from URL
    const author = searchParams.get('author');
    const dtag = searchParams.get('dtag');
    const eventId = searchParams.get('eventId');

    console.log('OG Image request:', { author, dtag, eventId });

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

    // Fetch pack data from Nostr with timeout
    let pack = null;
    try {
      if (eventId) {
        console.log('Fetching by eventId:', eventId);
        pack = await Promise.race([
          fetchPublicListByEventId(eventId, defaultRelays),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ]) as any;
      } else if (author && dtag) {
        console.log('Fetching by author+dtag:', author, dtag);
        pack = await Promise.race([
          fetchPublicListByDTag(author, dtag, defaultRelays),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ]) as any;
      }
      console.log('Pack fetched:', pack ? `${pack.name} (${pack.list.pubkeys.length} items)` : 'null');
    } catch (error) {
      console.error('Failed to fetch pack:', error);
    }

    // Fetch creator profile if we have the pack
    let creatorName = 'Anonymous';
    if (pack?.author) {
      try {
        console.log('Fetching creator profile:', pack.author);
        const profile = await Promise.race([
          fetchProfile(pack.author, defaultRelays),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]) as any;
        if (profile) {
          creatorName = profile.display_name || profile.name || 'Anonymous';
          console.log('Creator name:', creatorName);
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

    console.log('Generating image with:', { packName, creatorName, mutedCount });

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
            backgroundColor: '#0a0a0a',
            padding: '80px',
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        >
          {/* Logo - Red circle with white X */}
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
                borderRadius: '40px',
                backgroundColor: '#BE1E2D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  backgroundColor: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    fontSize: '36px',
                    fontWeight: 'bold',
                    color: '#BE1E2D',
                  }}
                >
                  ✕
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: '56px',
                fontWeight: 'normal',
                color: 'white',
                letterSpacing: '-0.02em',
              }}
            >
              mutable
            </div>
          </div>

          {/* Pack Name */}
          <div
            style={{
              fontSize: '72px',
              fontWeight: 'normal',
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
                fontSize: '28px',
                color: '#a3a3a3',
                textAlign: 'center',
                maxWidth: '900px',
                marginBottom: '48px',
                lineHeight: 1.4,
              }}
            >
              {packDescription.length > 120
                ? packDescription.substring(0, 120) + '...'
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
                fontSize: '26px',
                color: '#ededed',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span>Created by</span>
              <span
                style={{
                  color: '#BE1E2D',
                  fontWeight: 'normal',
                }}
              >
                {creatorName}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '32px',
                fontSize: '22px',
                color: '#a3a3a3',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 'bold', color: '#ededed' }}>{mutedCount}</span>
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
            backgroundColor: '#0a0a0a',
            color: 'white',
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              marginBottom: '40px',
            }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '40px',
                backgroundColor: '#BE1E2D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  backgroundColor: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '36px',
                    fontWeight: 'bold',
                    color: '#BE1E2D',
                  }}
                >
                  ✕
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: '56px',
                fontWeight: 'normal',
                color: 'white',
                letterSpacing: '-0.02em',
              }}
            >
              mutable
            </div>
          </div>
          <div style={{ fontSize: '40px', color: '#ededed' }}>
            Community Pack
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
