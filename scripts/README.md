# Nostr List Management Scripts

This directory contains scripts for managing Nostr lists.

## `get-mute-list.ts`

This script fetches the public mute list of a given `npub` and saves it to a file.

### Usage

```bash
npm run get-mute-list <npub> [json|text]
```

-   `<npub>`: The `npub` of the user you want to fetch the mute list for.
-   `[json|text]`: The output format. Defaults to `text`.

### Example

```bash
npm run get-mute-list npub1... text
```

This will create a file named `npub1...-mutes.txt` in the `output` directory.

## `edit-custom-list.ts`

This script allows you to bulk update a custom list from `https://following.space/`.

### Usage

```bash
npm run edit-custom-list <nevent> <nsec> <path-to-npubs-file>
```

-   `<nevent>`: The `nevent` string of the list you want to edit.
-   `<nsec>`: Your `nsec` string to sign the new event. **Please be very careful with your `nsec` key. Do not share it publicly.**
-   `<path-to-npubs-file>`: A path to a text file containing the new `npubs` you want to add, one per line.

### Example

```bash
npm run edit-custom-list nevent1... nsec1... npubs.txt
```

This will fetch the existing list, add the `npubs` from `npubs.txt` (or any file you specify), and publish a new event with the updated list, signed with your `nsec`.

## `filter-npubs.ts`

This script filters a list of `npubs` against an existing custom list event to remove any duplicates.

### Usage

```bash
npm run filter-npubs <nevent> <path-to-npubs-file>
```

-   `<nevent>`: The `nevent` string of the list you want to filter against.
-   `<path-to-npubs-file>`: A path to a text file containing the `npubs` you want to filter.

### Example

```bash
npm run filter-npubs nevent1... npubs.txt
```

This will create a new file named `filtered-npubs.txt` in the `output` directory containing only the `npubs` that are not already in the list.
