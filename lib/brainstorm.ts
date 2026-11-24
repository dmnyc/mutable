/**
 * Brainstorm (NosFabrica) search relay.
 *
 * A NIP-50 aggregator relay with a large archive. Reads without NIP-42 auth
 * are refused unless the filter carries a search token: `include:spam` asks
 * for the whole corpus unranked, `observer:<hex pubkey>` ranks results
 * through that pubkey's web of trust. Plain NIP-01 filters (authors, kinds,
 * since/until, limit) work alongside either token, as does NIP-45 COUNT.
 */

export const BRAINSTORM_SEARCH_RELAY = "wss://search.brainstorm.world";

/** Search token for unranked, unauthenticated reads of the full corpus. */
export const BRAINSTORM_UNRANKED = "include:spam";
