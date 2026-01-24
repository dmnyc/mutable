"use client";

import { useEffect, useState } from "react";
import { Radiation, Sparkles, X } from "lucide-react";

interface NoteNukeSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  successCount: number;
  totalCount: number;
}

export default function NoteNukeSuccessModal({
  isOpen,
  onClose,
  successCount,
  totalCount,
}: NoteNukeSuccessModalProps) {
  const [show, setShow] = useState(false);

  const handleClose = () => {
    setShow(false);
    setTimeout(onClose, 300);
  };

  useEffect(() => {
    if (isOpen) {
      setShow(true);
      const timer = setTimeout(() => {
        handleClose();
      }, 4500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className={`relative bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 rounded-2xl shadow-2xl border-2 border-red-500 dark:border-red-600 p-8 max-w-md w-full transform transition-all duration-300 ${
          show ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative">
            <div className="absolute inset-0 bg-red-500 dark:bg-red-600 rounded-full animate-ping opacity-75" />
            <div className="relative bg-red-500 dark:bg-red-600 rounded-full p-6">
              <Radiation size={48} className="text-white" strokeWidth={2.5} />
            </div>
            <Sparkles
              size={22}
              className="absolute -top-2 -right-2 text-yellow-400 animate-pulse"
            />
            <Sparkles
              size={18}
              className="absolute -bottom-1 -left-2 text-yellow-300 animate-pulse"
              style={{ animationDelay: "150ms" }}
            />
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-red-700 dark:text-red-300">
              Nuke deployed
            </h2>
            <p className="text-lg text-gray-700 dark:text-gray-300">
              Deletion event broadcast to relays
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Success: {successCount} / {totalCount}
            </p>
          </div>

          <button
            onClick={handleClose}
            className="mt-4 px-8 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
