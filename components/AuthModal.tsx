"use client";

import { useState } from "react";
import { X, Zap, Key, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const { connectWithNip07, hasNip07Extension } = useAuth();

  if (!isOpen) return null;

  const handleNip07Connect = async () => {
    try {
      setError(null);
      setConnecting(true);
      await connectWithNip07();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
          Connect to Nostr
        </h2>

        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Choose how you want to connect your Nostr profile
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* NIP-07 Option */}
          <button
            onClick={handleNip07Connect}
            disabled={connecting || !hasNip07Extension}
            className={`w-full p-4 border-2 rounded-lg text-left transition-colors ${
              hasNip07Extension && !connecting
                ? "border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                : "border-gray-300 dark:border-gray-600 opacity-50 cursor-not-allowed"
            }`}
          >
            <div className="flex items-center mb-2">
              {connecting ? (
                <Loader2
                  className="mr-2 text-purple-600 animate-spin"
                  size={24}
                />
              ) : (
                <Zap className="mr-2 text-purple-600" size={24} />
              )}
              <span className="font-semibold text-gray-900 dark:text-white">
                {connecting ? "Connecting..." : "Browser Extension (NIP-07)"}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {connecting
                ? "Please approve the connection in your extension"
                : hasNip07Extension
                  ? "Connect using Alby, nos2x, or another NIP-07 extension"
                  : "No extension detected. Please install a NIP-07 compatible extension."}
            </p>
          </button>

          {/* NIP-46 Option (Coming Soon) */}
          <button
            disabled
            className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg text-left opacity-50 cursor-not-allowed"
          >
            <div className="flex items-center mb-2">
              <Key className="mr-2 text-gray-500" size={24} />
              <span className="font-semibold text-gray-900 dark:text-white">
                Remote Signer (NIP-46)
              </span>
              <span className="ml-auto text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">
                Coming Soon
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Connect using a remote signer connection string
            </p>
          </button>
        </div>

        {!hasNip07Extension && (
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
            <p className="text-sm text-blue-900 dark:text-blue-200 font-semibold mb-2">
              Need a Nostr extension?
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Install{" "}
              <a
                href="https://getalby.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                Alby
              </a>{" "}
              or{" "}
              <a
                href="https://github.com/fiatjaf/nos2x"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                nos2x
              </a>{" "}
              to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
