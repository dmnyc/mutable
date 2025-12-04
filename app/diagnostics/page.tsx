'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { fetchAppData, D_TAGS } from '@/lib/relayStorage';
import { getPool } from '@/lib/nostr';
import { Filter, Event } from 'nostr-tools';

// NIP-07 interface (browser extension)
interface WindowWithNostr extends Window {
  nostr?: {
    getPublicKey(): Promise<string>;
    signEvent(event: any): Promise<Event>;
    getRelays?(): Promise<{ [url: string]: { read: boolean; write: boolean } }>;
    nip04?: {
      encrypt(pubkey: string, plaintext: string): Promise<string>;
      decrypt(pubkey: string, ciphertext: string): Promise<string>;
    };
  };
}

declare const window: WindowWithNostr;

interface RelayDiagnostic {
  relay: string;
  hasData: boolean;
  timestamp?: number;
  userCount?: number;
  error?: string;
  responseTime?: number;
}

export default function DiagnosticsPage() {
  const { session } = useAuth();
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<RelayDiagnostic[]>([]);

  const testIndividualRelays = async () => {
    if (!session) return;

    setTesting(true);
    setResults([]);

    // Get all unique relays from session
    const allRelays = [...new Set([
      ...session.relays,
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine',
      'wss://offchain.pub',
      'wss://nostr.land',
      'wss://nostrelay.yeghro.com',
    ])];

    console.log(`Testing ${allRelays.length} relays individually...`);

    const pool = getPool();
    const diagnostics: RelayDiagnostic[] = [];

    // Test each relay individually
    for (const relay of allRelays) {
      const startTime = Date.now();

      try {
        const result = await new Promise<{ data: any; timestamp: number } | null>((resolve) => {
          const timeoutId = setTimeout(() => {
            sub.close();
            resolve(null);
          }, 3000); // 3 second timeout per relay

          let foundEvent: Event | null = null;

          const filter: Filter = {
            kinds: [30078],
            authors: [session.pubkey],
            '#d': [D_TAGS.PROTECTED_USERS],
          };

          console.log(`[Diagnostic] Querying ${relay} for kind:30078 with d:${D_TAGS.PROTECTED_USERS}`);

          const sub = pool.subscribeMany(
            [relay],
            filter,
            {
              onevent(event: Event) {
                console.log(`[Diagnostic] ${relay} returned event:`, {
                  id: event.id.substring(0, 8),
                  created_at: new Date(event.created_at * 1000).toISOString(),
                  tags: event.tags,
                  contentLength: event.content.length
                });
                if (!foundEvent || event.created_at > foundEvent.created_at) {
                  foundEvent = event;
                }
              },
              async oneose() {
                console.log(`[Diagnostic] ${relay} EOSE - found:`, !!foundEvent);
                clearTimeout(timeoutId);
                sub.close();

                if (foundEvent) {
                  try {
                    // Check if encrypted
                    const isEncrypted = foundEvent.tags.find(t => t[0] === 'encrypted')?.[1] === 'true';

                    let data;
                    if (isEncrypted) {
                      console.log(`[Diagnostic] ${relay} - event is encrypted, attempting NIP-04 decrypt`);
                      // Try to decrypt using NIP-04
                      if (window.nostr?.nip04?.decrypt) {
                        const decrypted = await window.nostr.nip04.decrypt(foundEvent.pubkey, foundEvent.content);
                        data = JSON.parse(decrypted);
                      } else {
                        console.warn(`[Diagnostic] ${relay} - encrypted but no NIP-04 available`);
                        resolve({
                          data: { encrypted: true, users: [] },
                          timestamp: foundEvent.created_at * 1000
                        });
                        return;
                      }
                    } else {
                      data = JSON.parse(foundEvent.content);
                    }

                    resolve({
                      data,
                      timestamp: foundEvent.created_at * 1000
                    });
                  } catch (e) {
                    console.error(`[Diagnostic] ${relay} - failed to parse/decrypt:`, e);
                    resolve(null);
                  }
                } else {
                  resolve(null);
                }
              }
            }
          );
        });

        const responseTime = Date.now() - startTime;

        if (result) {
          diagnostics.push({
            relay,
            hasData: true,
            timestamp: result.timestamp,
            userCount: result.data.users?.length || 0,
            responseTime,
          });
        } else {
          diagnostics.push({
            relay,
            hasData: false,
            responseTime,
          });
        }
      } catch (error) {
        diagnostics.push({
          relay,
          hasData: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          responseTime: Date.now() - startTime,
        });
      }

      // Update UI after each relay
      setResults([...diagnostics]);
    }

    setTesting(false);
    console.log('Diagnostics complete:', diagnostics);
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return 'N/A';
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const formatRelativeTime = (ts?: number) => {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-4 text-gray-900 dark:text-white">
            Relay Diagnostics
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Please log in to use the diagnostics tool.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">
          Relay Storage Diagnostics
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Test which relays have your protected users data
        </p>

        <div className="mb-6">
          <button
            onClick={testIndividualRelays}
            disabled={testing}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {testing ? 'Testing Relays...' : 'Test All Relays'}
          </button>
        </div>

        {results.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="p-4 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Results ({results.filter(r => r.hasData).length} / {results.length} relays have data)
              </h2>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`p-4 ${result.hasData ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-2xl ${result.hasData ? 'text-green-600' : 'text-red-600'}`}>
                          {result.hasData ? '✅' : '❌'}
                        </span>
                        <code className="text-sm font-mono text-gray-900 dark:text-white break-all">
                          {result.relay}
                        </code>
                      </div>

                      {result.hasData && (
                        <div className="ml-9 space-y-1 text-sm">
                          <div className="text-gray-700 dark:text-gray-300">
                            <strong>Protected Users:</strong> {result.userCount}
                          </div>
                          <div className="text-gray-700 dark:text-gray-300">
                            <strong>Timestamp:</strong> {formatTimestamp(result.timestamp)}
                            <span className="text-gray-500 dark:text-gray-400 ml-2">
                              ({formatRelativeTime(result.timestamp)})
                            </span>
                          </div>
                          <div className="text-gray-700 dark:text-gray-300">
                            <strong>Response:</strong> {result.responseTime}ms
                          </div>
                        </div>
                      )}

                      {!result.hasData && (
                        <div className="ml-9 text-sm text-gray-600 dark:text-gray-400">
                          {result.error ? `Error: ${result.error}` : 'No data found'}
                          {result.responseTime && ` (${result.responseTime}ms)`}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {testing && (
          <div className="mt-4 text-center text-gray-600 dark:text-gray-400">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
            <p>Testing relays... ({results.length} tested)</p>
          </div>
        )}
      </div>
    </div>
  );
}
