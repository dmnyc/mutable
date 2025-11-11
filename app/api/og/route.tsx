import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { fetchPublicListByEventId, fetchPublicListByDTag, fetchProfile } from '@/lib/nostr';

export const runtime = 'nodejs';
export const maxDuration = 30; // Allow up to 30 seconds for OG image generation

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Get parameters from URL
    const author = searchParams.get('author');
    const dtag = searchParams.get('dtag');
    const eventId = searchParams.get('eventId');

    console.log('OG Image request:', { author, dtag, eventId });

    // Pack name comes from the dtag parameter (URL-friendly name)
    // For eventId format, we'll show a generic title
    let packName = 'Mutable Community Pack';
    let packDescription = 'A curated mute list for Nostr';

    if (dtag) {
      // The dtag IS the pack name, just need to make it display-friendly
      // Convert URL-friendly format to display format (e.g., "my-pack" -> "My Pack")
      packName = dtag
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      packDescription = `A curated mute list for Nostr`;
    }

    // Fetch creator profile to get display name
    let creatorName = 'Anonymous';
    if (author) {
      try {
        console.log('Fetching creator profile:', author);

        // Default relay list for profile fetching
        const defaultRelays = [
          'wss://relay.damus.io',
          'wss://relay.primal.net',
          'wss://nos.lol',
          'wss://relay.nostr.band',
          'wss://nostr.wine'
        ];

        const profile = await Promise.race([
          fetchProfile(author, defaultRelays),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Profile fetch timeout')), 8000))
        ]) as any;

        if (profile) {
          creatorName = profile.display_name || profile.name || 'Anonymous';
          console.log('Creator name:', creatorName);
        }
      } catch (error) {
        console.error('Failed to fetch creator profile:', error);
      }
    }

    console.log('Generating image with:', { packName, creatorName });

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
              fontWeight: '400',
              color: 'white',
              textAlign: 'center',
              maxWidth: '1000px',
              lineHeight: 1.2,
              marginBottom: '24px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
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
              {packDescription}
            </div>
          )}

          {/* Creator */}
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
