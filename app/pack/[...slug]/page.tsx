'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PublicMuteList } from '@/types';
import { fetchPublicListByEventId, fetchPublicListByDTag } from '@/lib/nostr';
import PublicListCard from '@/components/PublicListCard';
import Footer from '@/components/Footer';
import AuthModal from '@/components/AuthModal';
import { RefreshCw, LogIn } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';

export default function PackPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string[];
  const { session } = useAuth();

  // Determine if we're using event ID format or author+dTag format
  const isEventIdFormat = slug.length === 1;
  const eventId = isEventIdFormat ? slug[0] : null;
  const author = !isEventIdFormat ? slug[0] : null;
  const dtag = !isEventIdFormat ? slug[1] : null;

  const [pack, setPack] = useState<PublicMuteList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const loadPack = async () => {
      try {
        setLoading(true);
        setError(null);

        // Use a comprehensive relay list for public viewing
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

        let fetchedPack: PublicMuteList | null = null;

        if (isEventIdFormat && eventId) {
          console.log('Loading pack with event ID:', eventId);
          fetchedPack = await fetchPublicListByEventId(eventId, defaultRelays);
        } else if (author && dtag) {
          console.log('Loading pack with author:', author, 'and d-tag:', dtag);
          fetchedPack = await fetchPublicListByDTag(author, dtag, defaultRelays);
        }

        console.log('Fetched pack:', fetchedPack);

        if (fetchedPack) {
          setPack(fetchedPack);
        } else {
          console.log('Pack not found');
          setError('Pack not found');
        }
      } catch (err) {
        console.error('Failed to load pack:', err);
        setError(err instanceof Error ? err.message : 'Failed to load pack');
      } finally {
        setLoading(false);
      }
    };

    if ((isEventIdFormat && eventId) || (author && dtag)) {
      loadPack();
    }
  }, [isEventIdFormat, eventId, author, dtag]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/mutable_logo.svg"
                  alt="Mutable"
                  width={32}
                  height={32}
                  priority
                />
                <Image
                  src="/mutable_text_dark.svg"
                  alt="Mutable"
                  width={100}
                  height={24}
                  priority
                  className="block dark:hidden"
                />
                <Image
                  src="/mutable_text.svg"
                  alt="Mutable"
                  width={100}
                  height={24}
                  priority
                  className="hidden dark:block"
                />
              </Link>
            </div>
          </div>
        </header>

        {/* Loading State */}
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
            <RefreshCw className="animate-spin mx-auto mb-3 text-gray-400" size={32} />
            <p className="text-gray-600 dark:text-gray-400">Loading pack...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/mutable_logo.svg"
                  alt="Mutable"
                  width={32}
                  height={32}
                  priority
                />
                <Image
                  src="/mutable_text_dark.svg"
                  alt="Mutable"
                  width={100}
                  height={24}
                  priority
                  className="block dark:hidden"
                />
                <Image
                  src="/mutable_text.svg"
                  alt="Mutable"
                  width={100}
                  height={24}
                  priority
                  className="hidden dark:block"
                />
              </Link>
              {!session && (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  <LogIn size={18} />
                  <span className="hidden sm:inline">Sign In</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Error State */}
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
            <p className="text-red-600 dark:text-red-400 mb-4">{error || 'Pack not found'}</p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              <LogIn size={18} />
              <span>Sign In to Import</span>
            </button>
          </div>
        </main>
        <Footer />
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={32}
                height={32}
                priority
              />
              <Image
                src="/mutable_text_dark.svg"
                alt="Mutable"
                width={100}
                height={24}
                priority
                className="block dark:hidden"
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={100}
                height={24}
                priority
                className="hidden dark:block"
              />
            </Link>
            {session ? (
              <Link
                href="/dashboard"
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <span className="hidden sm:inline">Go to Dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <LogIn size={18} />
                <span className="hidden sm:inline">Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Pack Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full">
        <PublicListCard list={pack} isOwner={false} />

        {!session && (
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>To import this pack:</strong> Sign in to Mutable and click the &quot;Add to My Mute List&quot; button above.
            </p>
          </div>
        )}
      </main>
      <Footer />
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
