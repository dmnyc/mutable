'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import AuthModal from '@/components/AuthModal';
import { Lock, Unlock } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { isConnected } = useAuth();

  useEffect(() => {
    if (isConnected) {
      router.push('/dashboard');
    }
  }, [isConnected, router]);

  if (isConnected) {
    return <div>Redirecting...</div>;
  }

  return (
    <>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-purple-50 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <Image
              src="/mutable_logo.svg"
              alt="Mutable Logo"
              width={150}
              height={150}
              priority
            />
          </div>
          <div className="flex justify-center mb-4">
            {/* Light mode: dark text, Dark mode: white text with shadow */}
            <Image
              src="/mutable_text_dark.svg"
              alt="Mutable"
              width={300}
              height={60}
              priority
              className="block dark:hidden"
            />
            <Image
              src="/mutable_text.svg"
              alt="Mutable"
              width={300}
              height={60}
              priority
              className="hidden dark:block"
            />
          </div>
          <p className="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-8">
            Your Nostr Mute List Manager
          </p>

          {/* Main Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-8 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              <Lock size={20} />
              Connect with Nostr
            </button>

            <Link
              href="/mute-o-scope"
              className="px-8 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              <Image
                src="/mute_o_scope_icon_white.svg"
                alt="Mute-o-Scope"
                width={20}
                height={20}
              />
              Mute-o-Scope
            </Link>
          </div>

          {/* Mute-o-Scope Info Card */}
          <div className="max-w-md mx-auto mt-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3">
              <Unlock className="text-green-600 dark:text-green-400 flex-shrink-0 mt-1" size={24} />
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Try Mute-o-Scope - No Login Required
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Search any npub to see who is publicly muting them. Perfect for checking your reputation or investigating profiles.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
