# Mutable - Reset & Clear Data Guide

This guide explains how to delete stored content and reset the Mutable application.

## What Data Does Mutable Store Locally?

Mutable stores the following data in your browser's localStorage:

1. **Backups** (`mutable-backups`)
   - Mute list backups (up to 50)
   - Follow list backups (up to 50)
   - Backup metadata and timestamps

2. **Application State** (`mutable-storage`)
   - Current session information
   - Active mute list (cached)
   - Application preferences
   - Active tab selection
   - Onboarding completion status
   - Unsaved changes flags

## Important Note About Nostr Data

**⚠️ Clearing local data does NOT affect your actual Nostr data:**
- Your mute lists on Nostr relays remain unchanged
- Your follow lists on Nostr relays remain unchanged
- Your profile and posts are unaffected
- This only clears the LOCAL cache and backups

## Method 1: Using the Built-in Reset Feature (Recommended)

### Steps:
1. Open Mutable and log in
2. Navigate to the **Backups** tab
3. Scroll to the bottom to find the **"Danger Zone: Reset Application"** section
4. Click **"Reset Application"**
5. Confirm by clicking **"Yes, Reset Everything"**
6. The app will clear all data and redirect you to the home page

### What Gets Deleted:
✓ All backups from browser storage
✓ All application settings and preferences
✓ Session data (you'll need to reconnect)
✓ Cached mute list and follow list data
✓ Onboarding completion status

## Method 2: Manual Browser Developer Console

### Steps:
1. Open your browser's Developer Console:
   - **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
   - **Firefox**: Press `F12` or `Ctrl+Shift+K` (Windows) / `Cmd+Option+K` (Mac)
   - **Safari**: Enable Developer menu in Preferences, then press `Cmd+Option+C`

2. Go to the **Console** tab

3. Run one of the following commands:

#### Clear Everything (Complete Reset)
```javascript
localStorage.clear();
location.reload();
```

#### Clear Only Backups
```javascript
localStorage.removeItem('mutable-backups');
location.reload();
```

#### Clear Only Application State
```javascript
localStorage.removeItem('mutable-storage');
location.reload();
```

#### View Current Storage (Check what's stored)
```javascript
console.log('Backups:', localStorage.getItem('mutable-backups'));
console.log('App State:', localStorage.getItem('mutable-storage'));
```

## Method 3: Browser Settings (Complete Browser Data Clear)

### Chrome/Edge:
1. Go to `Settings` → `Privacy and security` → `Clear browsing data`
2. Select **"Cookies and other site data"** and **"Cached images and files"**
3. Choose time range: **"All time"**
4. Click **"Clear data"**

### Firefox:
1. Go to `Settings` → `Privacy & Security`
2. Under "Cookies and Site Data", click **"Clear Data"**
3. Select both options and click **"Clear"**

### Safari:
1. Go to `Preferences` → `Privacy`
2. Click **"Manage Website Data"**
3. Find `mutable` or your app domain
4. Click **"Remove"** or **"Remove All"**

## Method 4: Using Browser DevTools Application Tab

### Steps:
1. Open Developer Tools (`F12`)
2. Go to the **Application** tab (Chrome/Edge) or **Storage** tab (Firefox)
3. In the left sidebar, expand **Local Storage**
4. Click on your Mutable app domain
5. You'll see stored keys like `mutable-backups` and `mutable-storage`
6. Right-click and select **"Delete"** for each key, or click **"Clear All"**
7. Refresh the page

## Selective Data Management

### Delete Only Specific Backups
Use the Backups tab interface to:
- Delete individual backups (click trash icon on any backup)
- Delete all backups (click "Delete All" button in the actions bar)
- Filter by type before deleting

### Reset Onboarding
In the browser console:
```javascript
let state = JSON.parse(localStorage.getItem('mutable-storage'));
state.hasCompletedOnboarding = false;
localStorage.setItem('mutable-storage', JSON.stringify(state));
location.reload();
```

### Clear Only Session (Log Out)
Just click the **"Disconnect"** button in the top right of the dashboard.

## Troubleshooting

### "Reset didn't work"
- Hard refresh the page: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Close and reopen the browser
- Check if using Private/Incognito mode (data may not persist anyway)

### "I want my data back"
- If you exported backups to JSON files, you can re-import them via the Backups tab
- Reconnect your Nostr account to re-fetch your mute and follow lists from relays
- If no backup exists, your Nostr relay data is still safe and will reload when you reconnect

### "App is slow/buggy"
Try these steps in order:
1. Export your backups first (just in case)
2. Use the built-in Reset Application feature
3. Reconnect your Nostr account
4. Re-import backups if needed

## Best Practices

✅ **Before Resetting:**
- Export important backups to JSON files (Download button on each backup)
- Note down any custom settings you want to recreate

✅ **Regular Maintenance:**
- Create backups before making major changes
- Export critical backups to your computer monthly
- Review and delete old unnecessary backups

✅ **Privacy:**
- Clear app data if using a shared/public computer
- Export backups to encrypted storage if needed
- Remember: Nostr data is public unless encrypted

## Support

If you need help:
- Check the Mutable documentation
- Open an issue on GitHub
- Join the Nostr community for support

---

**Last Updated:** October 2025
