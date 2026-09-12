---
name: keyword-map
description: Judge a keyword expansion that `seo keywords` has already gathered. Reads the expanded set, its form groups and rule exclusions through the CLI, reviews the exclusions, sets the page budget, decides the second language, and shortlists the keywords that can be a page's primary keyword. Use after `pnpm seo keywords`, or when asked which keywords to target, how to group them, or whether the second language is worth its pages.
allowed-tools: Bash(pnpm seo:*)
---

# Keyword map

You judge; the code has already gathered. Work only through `pnpm seo`. Never open a database
file, never edit anything under `sites/`, never call an endpoint yourself.

## How to work

Work autonomously. Make every judgment this skill describes, write it with `pnpm seo decide
... --by claude` with a one-line reason, run the report, and tell the user what was decided and
why in a short summary. Do not stop to ask for confirmation of individual decisions: the user
reviews the report and overrides through `seo decide` where they disagree. Ask the user only
when a command refuses to run because the estimated spend exceeds the site's threshold, or when
a judgment is theirs alone (which services the business offers). If the user invoked this skill
with the word `confirm`, show the proposed decisions as a table and wait before writing.

## Read

1. `pnpm seo query keywords-expanded --slug <slug> --json -p language=<lang>` per language. Read
   `meta.counts` first: how many keywords, how many with measured city volume, how many form
   groups, and what the rules excluded and why. In a small language most rows sit below the
   reporting floor; a blank row is the absence of evidence and excludes nothing on its own.
2. `pnpm seo query keyword-exclusions --slug <slug> --json -p language=<lang>`. Check the rule
   exclusions for false positives and the kept rows for what the rules missed: recruitment,
   training, materials retail, brands, general construction, do-it-yourself, places outside the
   service area.
3. `pnpm seo query keyword-forms --slug <slug> --json -p language=<lang>`. A group is one page.
   Check the primary form is the one people type, and note groups the volume endpoint silently
   aggregated.

## Propose

4. Per service, the keywords that could be a page's primary keyword: the primary form of its
   group, not excluded, with measured demand or another witness (a competitor ranking for it,
   a question box, a purpose-built page in the screen). Questions become `questions` on the
   nearest page, not pages. Price and comparison modifiers become guides.
5. The page budget per language: how many pages the evidence supports, sized against what the
   real businesses in the teardown hold. A shortlist longer than that buys result pages for
   pages nobody will write.
6. The second-language verdict: compare its measured demand and bids against the first
   language. A mirrored tree keeps its pages either way; the verdict decides whether they are
   researched further or carried as navigation.

## Write

7. Show the exclusion corrections, the page budget, the second-language verdict and the
   shortlist per service, and stop.
1. Write: `pnpm seo decide keyword <id> --slug <slug> -d exclude=none --reason "..."`
   to keep a row the rules dropped, `-d exclude=<reason>` to drop one they kept, `-d shortlist=true`
   for each shortlisted keyword (batch them with `--batch -`), `-d service=<key>` where the
   attribution is wrong; `pnpm seo decide threshold keywords:<lang> --slug <slug> -d page_budget=<n>
-d second_language=take|leave --reason "..."`. Then `pnpm seo report --slug <slug>`.
