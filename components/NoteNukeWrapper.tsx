"use client";

import { useState } from "react";
import { User, LogOut, X, Menu } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import NoteNuke from "./NoteNuke";
import Footer from "./Footer";
import { Profile } from "@/types";
import UserProfileModal from "./UserProfileModal";
import GlobalUserSearch from "./GlobalUserSearch";

export default function NoteNukeWrapper() {
  const { session, disconnect } = useAuth();
  const { userProfile } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);

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
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {/* Desktop Navigation */}
              <div className="hidden lg:flex space-x-8">
                <Link
                  href="/dashboard?tab=myList"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  My Mutes
                </Link>
                <Link
                  href="/dashboard?tab=publicLists"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Mute Packs
                </Link>
                <Link
                  href="/dashboard?tab=muteuals"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Muteuals
                </Link>
                <Link
                  href="/dashboard?tab=reciprocals"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Reciprocals
                </Link>
                <Link
                  href="/mute-o-scope"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Mute-o-Scope
                </Link>
                <div className="py-4 px-1 border-b-2 border-red-600 text-red-600 dark:border-red-500 dark:text-red-500 font-semibold text-sm">
                  Note Nuke
                </div>
                <Link
                  href="/dashboard?tab=domainPurge"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Domain Purge
                </Link>
                <Link
                  href="/dashboard?tab=decimator"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Decimator
                </Link>
                <Link
                  href="/dashboard?tab=listCleaner"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  List Cleaner
                </Link>
                <Link
                  href="/dashboard?tab=backups"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Backups
                </Link>
                <Link
                  href="/dashboard?tab=settings"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-sm transition-colors"
                >
                  Settings
                </Link>
              </div>

              {/* Mobile Navigation */}
              <div className="lg:hidden">
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="flex items-center justify-between w-full py-4"
                >
                  <span className="font-semibold text-base text-gray-900 dark:text-white">
                    Note Nuke
                  </span>
                  {mobileMenuOpen ? (
                    <X size={20} className="text-gray-900 dark:text-white" />
                  ) : (
                    <Menu size={20} className="text-gray-900 dark:text-white" />
                  )}
                </button>

                {/* Mobile Dropdown Menu */}
                {mobileMenuOpen && (
                  <div className="absolute left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
                      <Link
                        href="/dashboard?tab=myList"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        My Mutes
                      </Link>
                      <Link
                        href="/dashboard?tab=publicLists"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Mute Packs
                      </Link>
                      <Link
                        href="/dashboard?tab=muteuals"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Muteuals
                      </Link>
                      <Link
                        href="/dashboard?tab=reciprocals"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Reciprocals
                      </Link>
                      <Link
                        href="/mute-o-scope"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Mute-o-Scope
                      </Link>
                      <div className="block w-full text-left py-3 px-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-semibold text-sm">
                        Note Nuke
                      </div>
                      <Link
                        href="/dashboard?tab=domainPurge"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Domain Purge
                      </Link>
                      <Link
                        href="/dashboard?tab=decimator"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Decimator
                      </Link>
                      <Link
                        href="/dashboard?tab=listCleaner"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        List Cleaner
                      </Link>
                      <Link
                        href="/dashboard?tab=backups"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Backups
                      </Link>
                      <Link
                        href="/dashboard?tab=settings"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-left py-3 px-4 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-sm"
                      >
                        Settings
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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
                    Get the full experience!
                  </span>
                  <Link
                    href="/"
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2"
                  >
                    <User size={16} />
                    Connect with Nostr
                  </Link>
                </div>
              </div>
            </div>
          </header>
        </>
      )}

      <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow">
          <NoteNuke />
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
    </div>
  );
}
