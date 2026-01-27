"use client";

import { useState } from "react";
import { User, LogOut } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import Purgatory from "./Purgatory";
import Footer from "./Footer";
import DashboardNav from "./DashboardNav";
import { Profile } from "@/types";
import UserProfileModal from "./UserProfileModal";
import GlobalUserSearch from "./GlobalUserSearch";
import AuthModal from "./AuthModal";

export default function PurgatoryWrapper() {
  const { session, disconnect } = useAuth();
  const { userProfile } = useStore();
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const handleDisconnect = () => {
    disconnect();
    window.location.href = "/";
  };

  const handleUserSelect = (profile: Profile) => {
    setSelectedProfile(profile);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {session ? (
        <>
          {/* Signed-in Header */}
          <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16 gap-4">
                <Link
                  href="/dashboard"
                  className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
                  title="Go to Dashboard"
                >
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
                    className="hidden sm:block"
                  />
                </Link>

                <GlobalUserSearch onSelectUser={handleUserSelect} />

                <div className="flex items-center space-x-4 flex-shrink-0">
                  {/* User Profile Display - Desktop */}
                  <div className="hidden md:flex items-center space-x-3">
                    {userProfile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userProfile.picture}
                        alt={
                          userProfile.display_name || userProfile.name || "User"
                        }
                        className="w-8 h-8 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                        <User
                          size={16}
                          className="text-gray-600 dark:text-gray-300"
                        />
                      </div>
                    )}
                    <div className="flex flex-col">
                      {userProfile && (
                        <>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {userProfile.display_name ||
                              userProfile.name ||
                              "Anonymous"}
                          </span>
                          {userProfile.nip05 && (
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              {userProfile.nip05}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* User Avatar - Mobile */}
                  <div className="md:hidden">
                    {userProfile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userProfile.picture}
                        alt={
                          userProfile.display_name || userProfile.name || "User"
                        }
                        className="w-8 h-8 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                        <User
                          size={16}
                          className="text-gray-600 dark:text-gray-300"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleDisconnect}
                    className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                    title="Disconnect"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Tab Navigation */}
          <DashboardNav activePage="purgatory" />
        </>
      ) : (
        <>
          {/* Anonymous Header */}
          <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16 gap-4">
                <Link
                  href="/"
                  className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
                  title="Go to Home"
                >
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
                    className="hidden sm:block"
                  />
                </Link>

                <div className="flex-1" />

                <div className="flex items-center gap-3">
                  <span className="hidden md:inline text-sm text-gray-600 dark:text-gray-400">
                    Sign in to use Purgatory
                  </span>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium flex items-center gap-2"
                  >
                    <User size={16} />
                    Connect with Nostr
                  </button>
                </div>
              </div>
            </div>
          </header>
        </>
      )}

      <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow">
          {session ? (
            <Purgatory />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <svg
                    width={32}
                    height={32}
                    viewBox="0 0 64 64"
                    fill="currentColor"
                    className="text-orange-600 dark:text-orange-400"
                  >
                    <path d="M63.6707 20.7427C63.5443 20.6172 63.3869 20.5276 63.2146 20.4828C63.0423 20.438 62.8611 20.4397 62.6897 20.4877L51.6777 23.6347C51.4685 23.6943 51.2845 23.8204 51.1535 23.994C51.0225 24.1676 50.9516 24.3792 50.9517 24.5967V28.8967L50.4587 29.3967C48.7503 31.1053 46.5362 32.2171 44.1454 32.5668C41.7546 32.9165 39.3149 32.4854 37.1887 31.3377L52.3637 16.1577H56.6697C56.887 16.1578 57.0985 16.0871 57.2721 15.9563C57.4457 15.8255 57.5719 15.6417 57.6317 15.4327L60.7787 4.42169C60.8276 4.25026 60.8298 4.06886 60.785 3.8963C60.7403 3.72373 60.6502 3.56626 60.5242 3.4402C60.3981 3.31415 60.2406 3.22408 60.0681 3.17933C59.8955 3.13458 59.7141 3.13677 59.5427 3.18569L48.5317 6.33069C48.3227 6.39046 48.1389 6.51669 48.0081 6.69028C47.8772 6.86386 47.8065 7.07533 47.8067 7.29269V11.6007L32.6277 26.7757C31.4792 24.6502 31.0473 22.2109 31.3961 19.8203C31.7449 17.4297 32.8558 15.2154 34.5637 13.5067L35.0637 13.0127H39.3637C39.5812 13.0127 39.7927 12.9419 39.9663 12.8109C40.1399 12.6799 40.2661 12.4959 40.3257 12.2867L43.4767 1.27469C43.5257 1.10315 43.5279 0.921632 43.4831 0.748947C43.4383 0.576262 43.3482 0.418703 43.222 0.292607C43.0958 0.166512 42.9381 0.0764716 42.7654 0.0318239C42.5927 -0.0128238 42.4112 -0.0104533 42.2397 0.0386895L31.2287 3.18569C31.0197 3.24523 30.8358 3.37124 30.7048 3.54463C30.5738 3.71803 30.5028 3.92938 30.5027 4.14669V8.45169L30.0097 8.94469C27.1005 11.8708 25.3031 15.7199 24.9271 19.8288C24.5511 23.9378 25.62 28.0492 27.9497 31.4547L1.01966 58.3847C0.42476 58.9581 0.0641256 59.7321 0.00776531 60.5564C-0.048595 61.3808 0.203339 62.1966 0.714664 62.8457C1.00265 63.1892 1.35877 63.4692 1.76052 63.668C2.16226 63.8668 2.60089 63.9801 3.04866 64.0007C3.09466 64.0007 3.14066 64.0007 3.18766 64.0007C4.04284 63.9997 4.86288 63.6603 5.46866 63.0567L32.5097 36.0147C35.9151 38.3446 40.0266 39.4136 44.1356 39.0376C48.2446 38.6615 52.0937 36.864 55.0197 33.9547L55.5127 33.4617H59.8177C60.035 33.4615 60.2463 33.3906 60.4197 33.2596C60.5931 33.1286 60.7191 32.9447 60.7787 32.7357L63.9257 21.7247C63.9746 21.5531 63.9768 21.3716 63.9319 21.1989C63.8871 21.0263 63.7969 20.8687 63.6707 20.7427Z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Purgatory
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Find follows engaging in destructive behavior like
                  mass-tagging hellthreads or using spam apps, then bulk mute
                  them.
                </p>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                >
                  Connect with Nostr to Get Started
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      <Footer />

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
