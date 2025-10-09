'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import AuthModal from '@/components/AuthModal';

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
            <Image
              src="/mutable_text.svg"
              alt="Mutable"
              width={300}
              height={60}
              priority
            />
          </div>
          <p className="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-8">
            Your Nostr Mute List Manager
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-8 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold shadow-lg hover:shadow-xl"
          >
            Connect with Nostr
          </button>
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
