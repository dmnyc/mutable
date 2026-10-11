"use client";

import { ReactNode, createContext, useContext, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { useTheme } from "@/hooks/useTheme";
import type { Theme } from "@/lib/theme";
import type { Profile } from "@/types";
import GlobalUserSearch from "@/components/GlobalUserSearch";
import UserProfileModal from "@/components/UserProfileModal";
import AuthModal from "@/components/AuthModal";
import SiteNav, { SiteNavActive } from "@/components/system/SiteNav";
import Footer from "@/components/Footer";

const SignInContext = createContext<() => void>(() => {});

/** Opens the Connect-with-Nostr modal from anywhere inside the shell. */
export function useRequestSignIn() {
  return useContext(SignInContext);
}

type Width = "wide" | "tool" | "regular" | "narrow";

const widthClasses: Record<Width, string> = {
  wide: "max-w-7xl",
  tool: "max-w-6xl",
  regular: "max-w-4xl",
  narrow: "max-w-2xl",
};

export interface AppShellProps {
  /** Which nav item is active. */
  navActive: SiteNavActive;
  /** Optional when authGate replaces the content for signed-out visitors. */
  children?: ReactNode;
  /** Main container width. Default "tool" (max-w-6xl). */
  width?: Width;
  /** Extra classes on <main> (e.g. the dashboard's banner bottom padding). */
  mainClassName?: string;
  /** Show the signed-in global user search in the header. Default true. */
  showSearch?: boolean;
  /** Hide the SiteNav bar (pack cards, diagnostics). */
  hideNav?: boolean;
  /** Overrides the mobile nav label (e.g. "Settings", which has no tab). */
  navActiveLabel?: string;
  /**
   * When set and signed out, children are replaced by a sign-in gate card
   * (icon, title, text) with a Connect button that opens the auth modal.
   */
  authGate?: { icon: ReactNode; title: string; text: ReactNode };
  /**
   * Dashboard mode: brand click and tab switching stay in-page (no
   * scroll), and the user menu can take extra items (Edit Profile,
   * Settings) via userMenuExtras.
   */
  onBrandClick?: () => void;
  onTabChange?: (tab: string) => void;
  /** Extra user-menu entries; call closeUserMenu() after acting. */
  userMenuExtras?: (closeUserMenu: () => void) => ReactNode;
}

/**
 * The one chrome: glass header (brand, search, theme, user menu), the
 * shared SiteNav, a width-consistent main, and the footer. Replaces the
 * per-tool wrappers and the dashboard's inline header/nav copies.
 */
export default function AppShell({
  navActive,
  children,
  width = "tool",
  mainClassName = "",
  showSearch = true,
  hideNav = false,
  navActiveLabel,
  authGate,
  onBrandClick,
  onTabChange,
  userMenuExtras,
}: AppShellProps) {
  const router = useRouter();
  const { session, disconnect } = useAuth();
  const { userProfile } = useStore();
  const [theme, setTheme] = useTheme();
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleDisconnect = async () => {
    await disconnect();
    router.push("/");
  };

  const brand = session ? (
    onBrandClick ? (
      <button
        onClick={onBrandClick}
        className="flex items-center gap-2.5 flex-none hover:opacity-80 transition-opacity"
        title="Go to My Mute List"
      >
        <BrandMark />
      </button>
    ) : (
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 flex-none hover:opacity-80 transition-opacity"
        title="Go to Dashboard"
      >
        <BrandMark />
      </Link>
    )
  ) : (
    <Link
      href="/"
      className="flex items-center gap-2.5 flex-none hover:opacity-80 transition-opacity"
      title="Go to Home"
    >
      <BrandMark />
    </Link>
  );

  return (
    <SignInContext.Provider value={() => setShowAuthModal(true)}>
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <header className="glass-header sticky top-0 z-50 border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            {brand}

            {session && showSearch ? (
              <div className="flex-1 flex justify-center min-w-0">
                <GlobalUserSearch onSelectUser={(p) => setSelectedProfile(p)} />
              </div>
            ) : null}

            {session ? (
              <div className="flex items-center gap-2 flex-none">
                <ThemeToggle theme={theme} setTheme={setTheme} />
                <div
                  className="relative"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setUserMenuOpen(false);
                    }
                  }}
                >
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-[10px] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    aria-expanded={userMenuOpen}
                  >
                    <Avatar />
                    <span className="hidden md:flex flex-col text-left">
                      {userProfile ? (
                        <>
                          <span className="text-sm font-medium text-hi leading-tight">
                            {userProfile.display_name ||
                              userProfile.name ||
                              "Anonymous"}
                          </span>
                          {userProfile.nip05 ? (
                            <span className="text-xs text-mut leading-tight">
                              {userProfile.nip05}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                    <ChevronDown
                      size={15}
                      className={`text-mut transition-transform ${
                        userMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {userMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-52 panel border border-line-2 rounded-xl shadow-panel z-50 py-1.5">
                      {userMenuExtras?.(() => setUserMenuOpen(false))}
                      <UserMenuTheme theme={theme} setTheme={setTheme} />
                      <div className="flex items-center gap-2.5 px-4 py-2 text-xs text-mut border-t border-line mt-1.5 pt-2">
                        <span className="w-4 text-center text-[10px]">🟢</span>
                        <span>
                          {session?.signerType === "nip46"
                            ? "NIP-46 Remote Signer"
                            : "NIP-07 Extension"}
                        </span>
                      </div>
                      <button
                        onClick={handleDisconnect}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      >
                        <LogOut size={15} />
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-none">
                <Link
                  href="/"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-mut hover:text-hi hover:bg-black/5 dark:hover:bg-white/5 rounded-[10px] transition-colors"
                  title="Back to the Mutable home screen"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </Link>
                <ThemeToggle theme={theme} setTheme={setTheme} />
                <span className="hidden md:inline text-sm text-mut">
                  Sign in for more features
                </span>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-4 py-2 bg-gradient-to-b from-primary to-primary-deep text-white text-sm font-semibold rounded-[10px] shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all"
                >
                  <span className="flex items-center gap-2">
                    <UserIcon size={15} />
                    Connect with Nostr
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!hideNav ? (
        <SiteNav
          active={navActive}
          onTabChange={onTabChange}
          activeLabel={navActiveLabel}
        />
      ) : null}

      <main
        className={`flex-grow w-full ${widthClasses[width]} mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-rise ${mainClassName}`}
      >
        {!session && authGate ? (
          <div className="max-w-md mx-auto pt-10">
            <section className="panel relative rounded-xl border border-line shadow-panel p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                {authGate.icon}
              </div>
              <h2 className="text-xl font-bold text-hi mb-2">{authGate.title}</h2>
              <p className="text-mid mb-6">{authGate.text}</p>
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-6 py-3 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all"
              >
                Connect with Nostr to Get Started
              </button>
            </section>
          </div>
        ) : (
          children
        )}
      </main>

      <Footer />

      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
    </SignInContext.Provider>
  );
}

function BrandMark() {
  return (
    <>
      <Image src="/mutable_logo.svg" alt="Mutable" width={36} height={36} />
      <span className="hidden sm:block">
        <Image
          src="/mutable_text_dark.svg"
          alt="Mutable"
          width={112}
          height={22}
          className="dark:hidden"
        />
        <Image
          src="/mutable_text.svg"
          alt="Mutable"
          width={112}
          height={22}
          className="hidden dark:block"
        />
      </span>
    </>
  );
}

function Avatar() {
  const { userProfile } = useStore();
  if (userProfile?.picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={userProfile.picture}
        alt={userProfile.display_name || userProfile.name || "User"}
        className="w-8 h-8 rounded-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).src =
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
        }}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center">
      <UserIcon size={15} className="text-mut" />
    </div>
  );
}

function ThemeToggle({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      className="w-9 h-9 rounded-[10px] border border-line-2 text-mut hover:text-hi flex items-center justify-center transition-colors"
      title={`Switch to ${next} theme`}
    >
      {theme === "light" ? (
        <Moon size={16} />
      ) : (
        <Sun size={16} />
      )}
    </button>
  );
}

function UserMenuTheme({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  return (
    <div className="border-t border-line mt-1.5 pt-1.5">
      <div className="px-4 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-mut">
        Theme
      </div>
      {(
        [
          { value: "dark", label: "Dark", Icon: Moon },
          { value: "light", label: "Light", Icon: Sun },
          { value: "system", label: "System", Icon: Monitor },
        ] as { value: Theme; label: string; Icon: typeof Sun }[]
      ).map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
            theme === value
              ? "text-red-600 dark:text-red-400 font-medium"
              : "text-mid hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          <Icon size={15} />
          {label}
          {theme === value && <Check size={14} className="ml-auto" />}
        </button>
      ))}
    </div>
  );
}
