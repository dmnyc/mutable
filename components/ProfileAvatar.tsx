import { User } from "lucide-react";

const FALLBACK_SVG =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';

const SIZE_CLASSES = {
  sm: "w-8 h-8",
  md: "w-8 h-8 sm:w-10 sm:h-10",
  lg: "w-16 h-16",
} as const;

const ICON_SIZES = {
  sm: 14,
  md: 14,
  lg: 20,
} as const;

interface ProfileAvatarProps {
  src?: string;
  name?: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export default function ProfileAvatar({
  src,
  name,
  size = "md",
  className = "",
}: ProfileAvatarProps) {
  const sizeClass = SIZE_CLASSES[size];

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || "User"}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0 ${className}`}
        onError={(e) => {
          (e.target as HTMLImageElement).src = FALLBACK_SVG;
        }}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0 ${className}`}
    >
      <User
        size={ICON_SIZES[size]}
        className="text-gray-600 dark:text-gray-300"
      />
    </div>
  );
}
