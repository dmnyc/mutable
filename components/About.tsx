"use client";

import Link from "next/link";
import { Github, Info } from "lucide-react";
import AppShell from "@/components/system/AppShell";
import PageHeader from "@/components/system/PageHeader";
import packageJson from "@/package.json";

const TOOLS: { name: string; href: string; text: string }[] = [
  {
    name: "Mute-o-Scope",
    href: "/mute-o-scope",
    text: "See who is publicly muting any profile, with a Mute Score",
  },
  {
    name: "The Dossier",
    href: "/dossier",
    text: "Mutes, reports, deletions, on-chain Bitcoin, DMs and footprint for any account in one report",
  },
  {
    name: "Reportable",
    href: "/reportable",
    text: "Public reports filed about an account, and by it",
  },
  {
    name: "Redactable",
    href: "/redactable",
    text: "An account’s deletion requests and the posts it deleted",
  },
  {
    name: "Snoopable",
    href: "/snoopable",
    text: "The public metadata of anyone’s NIP-04 DMs: who, when and how often",
  },
  {
    name: "Muggable",
    href: "/muggable",
    text: "Check whether a Nostr key holds Bitcoin on-chain",
  },
  {
    name: "Clonable",
    href: "/clonable",
    text: "Copy your profile, follows, mutes and relays from an old key to a new one",
  },
  {
    name: "Draftable",
    href: "/draftable",
    text: "Follow packs, including the ones that have drafted you",
  },
  {
    name: "My Mutes",
    href: "/dashboard?tab=myList",
    text: "View, edit and publish your mute list, with public and private entries (NIP-51)",
  },
  {
    name: "Mute Packs",
    href: "/dashboard?tab=publicLists",
    text: "Subscribe to public mute lists, or publish your own",
  },
  {
    name: "Muteuals",
    href: "/dashboard?tab=muteuals",
    text: "Who has publicly muted you",
  },
  {
    name: "Reciprocals",
    href: "/reciprocals",
    text: "Who you follow that doesn’t follow you back",
  },
  {
    name: "Purgatory",
    href: "/purgatory",
    text: "Find follows by client or hellthread participation",
  },
  {
    name: "Decimator",
    href: "/decimator",
    text: "Trim your follow list by percentage or count, with protected users",
  },
  {
    name: "Note Nuke",
    href: "/note-nuke",
    text: "Ask every relay we can reach to delete a note",
  },
  {
    name: "List Cleaner",
    href: "/dashboard?tab=listCleaner",
    text: "Scan your mute list for inactive profiles",
  },
  {
    name: "Domain Purge",
    href: "/dashboard?tab=domainPurge",
    text: "Remove every follow from a NIP-05 domain",
  },
  {
    name: "Backups",
    href: "/dashboard?tab=backups",
    text: "Local snapshots, JSON and signed-event export, and recovery from relay history",
  },
];

export default function About() {
  const build =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || "local";

  return (
    <AppShell navActive="muteOScope" hideNav width="regular">
      <PageHeader
        icon={<Info size={25} />}
        iconBg="from-blue-500 to-blue-700"
        title="About Mutable"
        subtitle="A toolkit for your mute list, your follows and your public record on Nostr."
      />

      <section className="panel relative rounded-xl border border-line shadow-panel mt-6 p-6">
        <p className="text-sm text-mid">
          Mutable helps you manage your Nostr mute list and follows, and shows
          what the network can see about any account. Most lookups work without
          logging in.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-mut">Version</dt>
          <dd className="text-hi font-medium">{packageJson.version}</dd>
          <dt className="text-mut">Build</dt>
          <dd className="text-hi font-medium font-mono">{build}</dd>
        </dl>
        <a
          href="https://github.com/dmnyc/mutable"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-mid hover:text-hi transition-colors"
        >
          <Github size={15} />
          Source on GitHub
        </a>
      </section>

      <section className="panel relative rounded-xl border border-line shadow-panel mt-5 p-6">
        <h2 className="font-display font-semibold text-base tracking-tight text-hi mb-3">
          Tools
        </h2>
        <ul className="divide-y divide-line">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="py-2.5">
              <Link
                href={tool.href}
                className="text-sm font-semibold text-hi hover:underline underline-offset-2"
              >
                {tool.name}
              </Link>
              <p className="text-sm text-mut mt-0.5">{tool.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
