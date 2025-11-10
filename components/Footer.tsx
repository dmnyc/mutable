'use client';

import { useState } from 'react';
import { Github, Zap, User } from 'lucide-react';
import packageJson from '@/package.json';

export default function Footer() {
  const [zapModal, setZapModal] = useState({
    show: false,
    lightningAddress: 'daniel@breez.tips',
    qrCode: ''
  });

  const version = packageJson.version;
  const creatorNpub = 'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx';

  const showZapModal = () => {
    // Generate QR code for the Lightning address
    const lightningAddress = zapModal.lightningAddress;
    const qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('lightning:' + lightningAddress)}`;

    setZapModal({
      ...zapModal,
      qrCode,
      show: true
    });
  };

  const closeZapModal = () => {
    setZapModal({
      ...zapModal,
      show: false
    });
  };

  const copyLightningAddress = () => {
    navigator.clipboard.writeText(zapModal.lightningAddress)
      .then(() => {
        // Visual feedback handled by button state
      })
      .catch(err => {
        console.error('Failed to copy Lightning address:', err);
      });
  };

  const zapOnNostr = () => {
    window.open(`https://jumble.social/users/${creatorNpub}`, '_blank');
  };

  return (
    <>
      <footer className="mt-auto py-6 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            <p className="text-gray-600 dark:text-gray-400 text-sm text-center lg:text-left">
              <span className="block sm:inline">Mutable v{version}</span>
              <span className="hidden sm:inline"> | </span>
              <span className="block sm:inline">Made with 💜 for the Nostr community</span>
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <a
                href={`https://jumble.social/users/${creatorNpub}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-full transition-colors inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white"
              >
                <User size={14} />
                Follow Creator
              </a>
              <button
                onClick={showZapModal}
                className="text-xs px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black rounded-full transition-colors inline-flex items-center gap-1.5 font-medium"
              >
                <Zap size={14} />
                Zap Creator
              </button>
              <a
                href="https://github.com/dmnyc/mutable/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full transition-colors inline-flex items-center gap-1.5"
              >
                <Github size={14} />
                Report Issue
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Zap Modal */}
      {zapModal.show && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={closeZapModal}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-yellow-500 flex items-center gap-2">
                <Zap size={20} />
                Zap the Creator
              </h3>
              <button
                onClick={closeZapModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="text-center space-y-4">
              <div className="text-gray-700 dark:text-gray-300">
                Show your appreciation for Mutable!
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                  <img
                    src={zapModal.qrCode}
                    alt="Lightning Address QR Code"
                    className="w-48 h-48"
                  />
                </div>
              </div>

              {/* Lightning Address */}
              <div className="space-y-2">
                <div className="text-sm text-gray-600 dark:text-gray-400">Lightning Address:</div>
                <div className="flex items-center gap-2">
                  <code className="bg-gray-100 dark:bg-gray-900 px-3 py-2 rounded text-yellow-600 dark:text-yellow-400 text-sm flex-grow text-center border border-gray-200 dark:border-gray-700">
                    {zapModal.lightningAddress}
                  </code>
                  <button
                    onClick={copyLightningAddress}
                    className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-2 rounded transition-colors"
                    title="Copy Lightning Address"
                  >
                    📋
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={zapOnNostr}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg transition-colors font-medium"
                >
                  Zap on Nostr
                </button>
                <button
                  onClick={closeZapModal}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg transition-colors font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
