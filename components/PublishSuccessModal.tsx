'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Sparkles, X } from 'lucide-react';

interface PublishSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemCount: number;
}

export default function PublishSuccessModal({ isOpen, onClose, itemCount }: PublishSuccessModalProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShow(true);
      // Auto-close after 4 seconds
      const timer = setTimeout(() => {
        handleClose();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = () => {
    setShow(false);
    setTimeout(onClose, 300); // Wait for animation
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className={`relative bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl shadow-2xl border-2 border-green-500 dark:border-green-600 p-8 max-w-md w-full transform transition-all duration-300 ${
          show ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <X size={20} />
        </button>

        {/* Success animation */}
        <div className="flex flex-col items-center text-center space-y-4">
          {/* Animated icon */}
          <div className="relative">
            <div className="absolute inset-0 bg-green-500 dark:bg-green-600 rounded-full animate-ping opacity-75" />
            <div className="relative bg-green-500 dark:bg-green-600 rounded-full p-6">
              <CheckCircle size={48} className="text-white" strokeWidth={2.5} />
            </div>
            {/* Sparkles */}
            <Sparkles
              size={24}
              className="absolute -top-2 -right-2 text-yellow-400 animate-pulse"
            />
            <Sparkles
              size={20}
              className="absolute -bottom-1 -left-2 text-yellow-300 animate-pulse"
              style={{ animationDelay: '150ms' }}
            />
          </div>

          {/* Success message */}
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-green-700 dark:text-green-300">
              Published! 🎉
            </h2>
            <p className="text-lg text-gray-700 dark:text-gray-300">
              Your mute list has been published to relays
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {itemCount} {itemCount === 1 ? 'item' : 'items'} now active across the network
            </p>
          </div>

          {/* Done button */}
          <button
            onClick={handleClose}
            className="mt-4 px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
