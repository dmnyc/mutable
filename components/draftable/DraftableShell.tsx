"use client";

import { createContext, useContext, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Lock, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "../AuthModal";
import DashboardNav from "../DashboardNav";
import Footer from "../Footer";

const SignInContext = createContext<() => void>(() => {});

/** Opens the Connect with Nostr modal from anywhere inside the shell. */
export function useRequestSignIn() {
  return useContext(SignInContext);
}

/** Header, tool nav, and footer shared by every Draftable page. */
export default function DraftableShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, disconnect } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <SignInContext.Provider value={() => setShowAuthModal(true)}>
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-4">
              <Link
                href={session ? "/dashboard" : "/"}
                className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
                title={session ? "Go to Dashboard" : "Go to Home"}
              >
                <Image
                  src="/mutable_logo.svg"
                  alt="Mutable"
                  width={40}
                  height={40}
                />
                <Image
                  src="/mutable_text_dark.svg"
                  alt="Mutable"
                  width={120}
                  height={24}
                  className="hidden sm:block dark:hidden"
                />
                <Image
                  src="/mutable_text.svg"
                  alt="Mutable"
                  width={120}
                  height={24}
                  className="hidden sm:dark:block"
                />
              </Link>
              {!session && (
                <Link
                  href="/"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
                  title="Back to the Mutable home screen"
                >
                  <ArrowLeft size={16} />
                  <span className="hidden sm:inline">Back</span>
                </Link>
              )}

              <div className="flex-1" />

              {session ? (
                <button
                  onClick={disconnect}
                  className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors border border-gray-200 dark:border-gray-700 rounded-lg"
                  title="Disconnect"
                >
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Disconnect</span>
                </button>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2"
                >
                  <Lock size={16} />
                  <span className="hidden sm:inline">Connect with Nostr</span>
                  <span className="sm:hidden">Connect</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {session && <DashboardNav activePage="draftable" />}

        <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
          <main className="container mx-auto px-4 py-8 max-w-6xl">
            {children}
          </main>
        </div>

        <Footer />

        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        />
      </div>
    </SignInContext.Provider>
  );
}
