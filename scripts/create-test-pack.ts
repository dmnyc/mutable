/**
 * Script to create a test community pack in mutable format
 * Shows the compatibility between nostrguard and mutable formats
 *
 * Usage: npx tsx scripts/create-test-pack.ts
 */

// Sample pack data (inspired by nostrguard format)
const testPackData = {
  name: "Test Scammer Pack",
  description: "A test pack of known scammer pubkeys for demonstration purposes",
  categories: ["scam", "impersonation"],
  pubkeys: [
    // These are fake test pubkeys for demonstration
    "npub1test1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc2",
    "npub1test2qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0z",
    "npub1test3qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqu4"
  ]
};

console.log('🧪 Test Community Pack Creator\n');
console.log('This demonstrates the mutable community pack format and compatibility.\n');

console.log('=' .repeat(80));
console.log('TEST PACK DATA');
console.log('=' .repeat(80));
console.log(JSON.stringify(testPackData, null, 2));

console.log('\n' + '='.repeat(80));
console.log('NOSTRGUARD FORMAT (kind 30001)');
console.log('=' .repeat(80));

const nostrguardFormat = {
  kind: 30001,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["d", "test-scammer-pack"],                    // Unique identifier
    ["title", testPackData.name],                   // Display name (nostrguard uses "title")
    ["description", testPackData.description],
    ...testPackData.categories.map(cat => ["t", cat]),
    ...testPackData.pubkeys.map(npub => ["p", npub])
  ],
  content: JSON.stringify({
    version: "1.0",
    npubs: testPackData.pubkeys
  })
};

console.log(JSON.stringify(nostrguardFormat, null, 2));

console.log('\n' + '='.repeat(80));
console.log('MUTABLE FORMAT (kind 30001)');
console.log('=' .repeat(80));

const mutableFormat = {
  kind: 30001,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["d", "test-scammer-pack"],                     // Unique identifier (same format)
    ["name", testPackData.name],                    // Display name (mutable uses "name")
    ["description", testPackData.description],       // Same
    ["L", "mutable"],                                // Namespace marker (mutable-specific)
    ["l", "community-pack", "mutable"],              // Category in namespace (mutable-specific)
    ...testPackData.categories.map(cat => ["t", cat]), // Same
    ...testPackData.pubkeys.map(npub => ["p", npub])   // Same
  ],
  content: ''  // Mutable uses empty content, all data in tags
};

console.log(JSON.stringify(mutableFormat, null, 2));

console.log('\n' + '='.repeat(80));
console.log('COMPATIBILITY ANALYSIS');
console.log('=' .repeat(80));

console.log(`
✅ COMPATIBLE ELEMENTS:
   - Both use kind 30001 (parameterized replaceable list)
   - Both use ["d", identifier] for unique ID
   - Both use ["description", ...] for description text
   - Both use ["t", category] for category tags
   - Both use ["p", pubkey/npub] for the actual pubkeys to mute
   - Both support multiple categories

❌ DIFFERENCES:
   1. Display Name Tag:
      - Nostrguard: ["title", "Pack Name"]
      - Mutable:    ["name", "Pack Name"]

   2. Namespace Tags (mutable only):
      - ["L", "mutable"]                    ← Namespace
      - ["l", "community-pack", "mutable"]  ← Category in namespace

   3. Content field:
      - Nostrguard: JSON with version and npubs
      - Mutable:    Empty string (all data in tags)

🔧 MAKING THEM COMPATIBLE:

Option 1: Dual Tag Support (Recommended)
   - Mutable reads BOTH "name" and "title" tags
   - When "title" exists but "name" doesn't, use "title" as display name
   - This makes mutable backward-compatible with nostrguard packs

Option 2: Shared Namespace
   - Both agree on using "title" or "name" consistently
   - Add namespace tags to differentiate app-specific features

Option 3: Import/Convert
   - Fetch nostrguard packs
   - Convert format and republish as mutable packs
   - User republishes with their signature

📝 RECOMMENDED IMPLEMENTATION:

Update mutable's parsePublicListEvent() function:

  export function parsePublicListEvent(event: Event) {
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';

    // Support both "name" (mutable) and "title" (nostrguard) tags
    const nameTag = event.tags.find(tag => tag[0] === 'name')?.[1];
    const titleTag = event.tags.find(tag => tag[0] === 'title')?.[1];
    const displayName = nameTag || titleTag || dTag;  // ← Use either one

    const descTag = event.tags.find(tag => tag[0] === 'description')?.[1];

    // Check for mutable namespace
    const isMutablePack = event.tags.some(tag =>
      tag[0] === 'L' && tag[1] === 'mutable'
    );

    // ... rest of parsing
  }

This way:
- Mutable packs work as before (with "name" tag + namespace)
- Nostrguard packs are readable (using "title" tag)
- Filtering by namespace keeps mutable packs separate when needed
- Users can choose to browse "all packs" or "mutable packs only"
`);

console.log('\n✅ Summary: The formats are highly compatible with minor modifications!');
