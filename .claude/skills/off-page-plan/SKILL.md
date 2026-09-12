---
name: off-page-plan
description: Judge the off-page reading that `seo offpage` has already gathered. Turns the strongest competitor's referring domains into the citation list to pursue, reads the business listings around each place into a profile plan, and writes the verdicts. Use after `pnpm seo offpage`, or when asked about citations, directories, backlinks, the business profile, reviews, or why a site is not appearing.
allowed-tools: Bash(pnpm seo:*)
---

# Off-page plan

You judge; the code has already gathered and sorted. Work only through `pnpm seo`.

## How to work

Work autonomously. Make every judgment this skill describes, write it with `pnpm seo decide
... --by claude` with a one-line reason, run the report, and summarize. Ask the user only when a
command refuses to run above the site's spending threshold, or for facts about the business:
whether it has an address in a place, and what its profile is called. If invoked with the word
`confirm`, show the proposed decisions first.

## Read

1. `pnpm seo query citations --slug <slug> --json`. The rules sorted the strongest competitor's
   referring domains into pursue, review and ignore. Read the review rows: a home-market site
   with a weak rank may still offer a listing anyone can take, or may be a one-off mention.
2. `pnpm seo query listings --slug <slug> --json`. Per place: how many listings match the trade,
   the median review count (the pack's entry price), which competitors are there, and whether
   the business's own listing exists.

## Propose and write

3. Move review rows to pursue or ignore with `pnpm seo decide citation <domain> --slug <slug>
-d verdict=pursue|ignore --reason "..."`. Never mark a spam or foreign-network domain pursue.
4. Summarize the profile plan per place: the category to hold, the review count to reach the
   median, and which competitors already sit in the pack. A place without an address the
   business can verify has no pack to enter; say so rather than planning one.
5. `pnpm seo report --slug <slug>` and tell the user the citation list, the review targets per
   place, and the two or three actions that come first.
