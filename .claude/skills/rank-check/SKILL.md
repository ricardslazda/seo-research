---
name: rank-check
description: Read what a published site earned. Runs on the rank readings `seo rank` has stored, says what each reading means, names the page to work on next, and scores the screen that chose the market. Use after the pages are live, or when asked how the site is doing, whether it ranks, why a page is not moving, or which page to work on next.
allowed-tools: Bash(pnpm seo:*)
---

# Rank check

You judge; the code has already read the pages. Work only through `pnpm seo`. Once a month, not
weekly: a new domain moves over months and a weekly reading measures noise.

## How to work

Work autonomously. Summarize the readings, name the next page to work on, and record anything a
later phase must act on as a decision with a reason. Ask the user only when `seo rank` refuses to
run above the site's spending threshold. If invoked with the word `confirm`, show your reading
before writing anything.

## Read

1. `pnpm seo query rank --slug <slug> --json`. Read `meta.counts` and `meta.mismatches` first,
   then the rows. Work down the ladder; each step assumes the ones above came back clean:
   absent means indexing and citations, not copy; a wrong page ranking means the cluster or the
   plan, not the copy; the edge band is where a rewrite pays; the first page means wait.
2. `pnpm seo query plan-pages --slug <slug> --json` for what each page was supposed to be.

## Write

3. A keyword whose ranking URL is not the page the plan claims: move it with `pnpm seo decide
keyword <id> --slug <slug> -d cluster=<primary id>` or give it `-d cluster=own`, then
   `pnpm seo plan --slug <slug>`.
4. A page that is absent after months: a `pnpm seo decide page <key> --slug <slug> -d build=false
--reason "..."` is honest if nothing supports it; otherwise leave it and send the user to the
   off-page list.
5. `pnpm seo report --slug <slug>`, then tell the user: the ladder counts, the mismatches, the
   next page to work on and why, and whether the screen's read of this market held.
