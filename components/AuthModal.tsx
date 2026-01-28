"use client";

import { useState, useEffect } from "react";
import {
  X,
  Zap,
  Key,
  Loader2,
  ExternalLink,
  QrCode,
  Copy,
  Check,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/useAuth";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectingMethod, setConnectingMethod] = useState<
    "nip07" | "nip46" | "nostrconnect" | null
  >(null);
  const [showNip46Options, setShowNip46Options] = useState(false);
  const [nip46Mode, setNip46Mode] = useState<"bunker" | "qrcode" | null>(null);
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [nostrConnectUri, setNostrConnectUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const {
    connectWithNip07,
    connectWithNip46,
    generateNostrConnectURI,
    waitForNostrConnect,
    cancelNostrConnect,
    hasNip07Extension,
  } = useAuth();

  if (!isOpen) return null;

  const handleNip07Connect = async () => {
    try {
      setError(null);
      setConnecting(true);
      setConnectingMethod("nip07");
      await connectWithNip07();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
      setConnectingMethod(null);
    }
  };

  const handleNip46Connect = async () => {
    if (!bunkerUrl.trim()) {
      setError("Please enter a bunker URL or NIP-05 identifier");
      return;
    }

    try {
      setError(null);
      setAuthUrl(null);
      setConnecting(true);
      setConnectingMethod("nip46");

      await connectWithNip46(bunkerUrl.trim(), (url) => {
        // Handle auth challenge - show URL to user
        setAuthUrl(url);
      });

      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to remote signer",
      );
    } finally {
      setConnecting(false);
      setConnectingMethod(null);
      setAuthUrl(null);
    }
  };

  const handleShowQRCode = () => {
    setNip46Mode("qrcode");
    const uri = generateNostrConnectURI();
    setNostrConnectUri(uri);
    // Start waiting for connection in the background
    startNostrConnectWait();
  };

  const startNostrConnectWait = async () => {
    try {
      setError(null);
      setConnecting(true);
      setConnectingMethod("nostrconnect");

      await waitForNostrConnect((url) => {
        setAuthUrl(url);
      });

      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === "Connection cancelled") {
        // User cancelled, don't show error
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to remote signer",
      );
    } finally {
      setConnecting(false);
      setConnectingMethod(null);
      setAuthUrl(null);
    }
  };

  const handleCopyUri = async () => {
    if (nostrConnectUri) {
      await navigator.clipboard.writeText(nostrConnectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    // Cancel any active nostrconnect session
    if (connectingMethod === "nostrconnect") {
      cancelNostrConnect();
    }
    setError(null);
    setShowNip46Options(false);
    setNip46Mode(null);
    setBunkerUrl("");
    setAuthUrl(null);
    setNostrConnectUri(null);
    setCopied(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 relative">
        <button
          onClick={handleClose}
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

        {authUrl && (
          <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-700 rounded">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
              Your remote signer requires authentication:
            </p>
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-yellow-700 dark:text-yellow-300 underline hover:no-underline"
            >
              Open authentication page <ExternalLink size={14} />
            </a>
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
              {connectingMethod === "nip07" ? (
                <Loader2
                  className="mr-2 text-purple-600 animate-spin"
                  size={24}
                />
              ) : (
                <Zap className="mr-2 text-purple-600" size={24} />
              )}
              <span className="font-semibold text-gray-900 dark:text-white">
                {connectingMethod === "nip07"
                  ? "Connecting..."
                  : "Browser Extension (NIP-07)"}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {connectingMethod === "nip07"
                ? "Please approve the connection in your extension"
                : hasNip07Extension
                  ? "Connect using Alby, nos2x, or another NIP-07 extension"
                  : "No extension detected. Please install a NIP-07 compatible extension."}
            </p>
          </button>

          {/* NIP-46 Option */}
          {!showNip46Options ? (
            <button
              onClick={() => setShowNip46Options(true)}
              disabled={connecting}
              className={`w-full p-4 border-2 rounded-lg text-left transition-colors ${
                !connecting
                  ? "border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  : "border-gray-300 dark:border-gray-600 opacity-50 cursor-not-allowed"
              }`}
            >
              <div className="flex items-center mb-2">
                <Key className="mr-2 text-blue-600" size={24} />
                <span className="font-semibold text-gray-900 dark:text-white">
                  Remote Signer (NIP-46)
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Connect using Amber, Primal, or another remote signer
              </p>
            </button>
          ) : nip46Mode === null ? (
            // Show choice between QR code and bunker URL
            <div className="p-4 border-2 border-blue-500 rounded-lg">
              <div className="flex items-center mb-3">
                <Key className="mr-2 text-blue-600" size={24} />
                <span className="font-semibold text-gray-900 dark:text-white">
                  Remote Signer (NIP-46)
                </span>
              </div>

              <div className="space-y-2 mb-3">
                <button
                  onClick={handleShowQRCode}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-left flex items-center gap-3"
                >
                  <QrCode className="text-blue-600" size={20} />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      Scan QR Code
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      For Primal mobile and other apps
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setNip46Mode("bunker")}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-left flex items-center gap-3"
                >
                  <Key className="text-blue-600" size={20} />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      Paste Bunker URL
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      For Amber and other signers
                    </div>
                  </div>
                </button>
              </div>

              <button
                onClick={() => {
                  setShowNip46Options(false);
                  setNip46Mode(null);
                  setError(null);
                }}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          ) : nip46Mode === "qrcode" ? (
            // Show QR code for scanning
            <div className="p-4 border-2 border-blue-500 rounded-lg">
              <div className="flex items-center mb-3">
                <QrCode className="mr-2 text-blue-600" size={24} />
                <span className="font-semibold text-gray-900 dark:text-white">
                  Scan with Primal or another app
                </span>
              </div>

              {nostrConnectUri && (
                <div className="flex flex-col items-center">
                  <div className="bg-white p-4 rounded-lg mb-3">
                    <QRCodeSVG value={nostrConnectUri} size={200} />
                  </div>

                  <div className="flex items-center gap-2 mb-3 w-full">
                    <div className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
                      {nostrConnectUri.substring(0, 40)}...
                    </div>
                    <button
                      onClick={handleCopyUri}
                      className="p-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                      title="Copy URI"
                    >
                      {copied ? (
                        <Check size={16} className="text-green-600" />
                      ) : (
                        <Copy
                          size={16}
                          className="text-gray-600 dark:text-gray-400"
                        />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                    <Loader2 className="animate-spin" size={16} />
                    Waiting for connection...
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  cancelNostrConnect();
                  setNip46Mode(null);
                  setNostrConnectUri(null);
                  setError(null);
                }}
                disabled={false}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            // Show bunker URL input
            <div className="p-4 border-2 border-blue-500 rounded-lg">
              <div className="flex items-center mb-3">
                <Key className="mr-2 text-blue-600" size={24} />
                <span className="font-semibold text-gray-900 dark:text-white">
                  Remote Signer (NIP-46)
                </span>
              </div>

              <input
                type="text"
                value={bunkerUrl}
                onChange={(e) => setBunkerUrl(e.target.value)}
                placeholder="bunker://..."
                disabled={connecting}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setNip46Mode(null);
                    setBunkerUrl("");
                    setError(null);
                  }}
                  disabled={connecting}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleNip46Connect}
                  disabled={connecting || !bunkerUrl.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {connectingMethod === "nip46" ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Connecting...
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                Paste a bunker:// URL from Amber or another remote signer
              </p>
            </div>
          )}
        </div>

        {!hasNip07Extension && !showNip46Options && (
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
                href="https://github.com/nicokimmel/nossern"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                Nossern
              </a>{" "}
              to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
