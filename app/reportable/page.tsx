import { Suspense } from 'react';
import Reportable from '@/components/Reportable';

export const metadata = {
  title: 'Reportable by Mutable: See who is publicly reporting whom on Nostr',
  description: 'Search any npub to see their public NIP-56 report history, or browse the live feed of reports across the network. No sign-in required.',
  openGraph: {
    title: 'Reportable by Mutable: See who is publicly reporting whom on Nostr',
    description: 'Search any npub to see their public NIP-56 report history, or browse the live feed of reports across the network. No sign-in required.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Reportable by Mutable: See who is publicly reporting whom on Nostr',
    description: 'Search any npub to see their public NIP-56 report history, or browse the live feed of reports across the network. No sign-in required.',
  },
};

export default function ReportablePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />}>
      <Reportable />
    </Suspense>
  );
}
