'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import Image from 'next/image';
import { LogOut, User } from 'lucide-react';
import MyMuteList from '@/components/MyMuteList';
import PublicLists from '@/components/PublicLists';

export default function Dashboard() {
  const router = useRouter();
  const { session, isConnected, disconnect } = useAuth();
  const { activeTab, setActiveTab } = useStore();

  useEffect(() => {
    if (!isConnected) {
      router.push('/');
    }
  }, [isConnected, router]);

  if (!isConnected || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const handleDisconnect = () => {
    disconnect();
    router.push('/');
  };

  const truncatedPubkey = `${session.pubkey.slice(0, 8)}...${session.pubkey.slice(-8)}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={40}
                height={40}
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={120}
                height={24}
              />
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                <User size={16} />
                <span className="font-mono">{truncatedPubkey}</span>
              </div>
              <button
                onClick={handleDisconnect}
                className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
              >
                <LogOut size={16} />
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <button
              onClick={() => setActiveTab('myList')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'myList'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              My Mute List
            </button>
            <button
              onClick={() => setActiveTab('publicLists')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'publicLists'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Public Lists
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'myList' ? <MyMuteList /> : <PublicLists />}
      </main>
    </div>
  );
}
