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

    // Load logo as base64 for Satori
    const logoUrl = process.env.NEXT_PUBLIC_BASE_URL
      ? `${process.env.NEXT_PUBLIC_BASE_URL}/mutable_logo_transparent.png`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/mutable_logo_transparent.png`
      : 'http://localhost:3000/mutable_logo_transparent.png';

    let logoData;
    try {
      const logoResponse = await fetch(logoUrl);
      const logoBuffer = await logoResponse.arrayBuffer();
      logoData = `data:image/png;base64,${Buffer.from(logoBuffer).toString('base64')}`;
    } catch (error) {
      console.error('Failed to load logo:', error);
      logoData = null;
    }

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
            backgroundColor: '#101827',
            padding: '80px',
          }}
        >
          {/* Logo */}
          {logoData && (
            <div
              style={{
                display: 'flex',
                marginBottom: '40px',
              }}
            >
              <img
                src={logoData}
                width="200"
                height="200"
                style={{
                  objectFit: 'contain',
                }}
              />
            </div>
          )}

          {/* Pack Name */}
          <div
            style={{
              fontSize: '72px',
              fontWeight: 700,
              color: 'white',
              textAlign: 'center',
              maxWidth: '1000px',
              lineHeight: 1.2,
              marginBottom: '24px',
              fontFamily: 'sans-serif',
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
                fontFamily: 'sans-serif',
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
              fontFamily: 'sans-serif',
            }}
          >
            <span>Created by</span>
            <span
              style={{
                color: '#BE1E2D',
                fontWeight: 700,
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
        fonts: [
          {
            name: 'Inter',
            data: await fetch(
              'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff'
            ).then((res) => res.arrayBuffer()),
            weight: 700,
            style: 'normal',
          },
        ],
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
            backgroundColor: '#101827',
            color: 'white',
          }}
        >
          <div
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '60px',
              backgroundColor: '#BE1E2D',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '40px',
            }}
          >
            <div
              style={{
                width: '76px',
                height: '76px',
                borderRadius: '38px',
                backgroundColor: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '48px',
                  fontWeight: 700,
                  color: '#BE1E2D',
                }}
              >
                X
              </div>
            </div>
          </div>
          <div style={{ fontSize: '40px', color: '#ededed', fontWeight: 700, fontFamily: 'sans-serif' }}>
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
