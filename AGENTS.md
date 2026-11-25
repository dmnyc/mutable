# Agent guidelines

- Do not add AI agents as co-authors on commits. Claude is credited in the Readme file.
- Commit and push deliberately: batch related changes into one commit locally, and never push or open PRs unless explicitly asked. One push per requested milestone, not per tweak — every push triggers a Vercel preview deployment that counts against Vercel's build minutes and storage until someone purges it, plus PR noise.
- Button labels must never wrap or stack onto a second line, especially on mobile. Give text buttons `whitespace-nowrap` and enough room to render on one line — full width on its own row, a shorter label on small screens, or an icon-only compact form — rather than letting the flex row squeeze the label into two lines.
