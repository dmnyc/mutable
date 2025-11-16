import { Suspense } from 'react';
import MuteOScope from '@/components/Mute-o-Scope';

export const metadata = {
  title: 'Mute-o-Scope by Mutable: Search any npub to see who is publicly muting them',
  description: 'Search any npub to see who is publicly muting them. No sign-in required.',
  openGraph: {
    title: 'Mute-o-Scope by Mutable: Search any npub to see who is publicly muting them',
    description: 'Search any npub to see who is publicly muting them. No sign-in required.',
    images: ['/mute-o-scope_social_card.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mute-o-Scope by Mutable: Search any npub to see who is publicly muting them',
    description: 'Search any npub to see who is publicly muting them. No sign-in required.',
    images: ['/mute-o-scope_social_card.png'],
  },
};

export default function MuteOScopePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />}>
      <MuteOScope />
    </Suspense>
  );
}
