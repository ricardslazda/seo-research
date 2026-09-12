---
name: cluster-review
description: Judge the clusters that `seo cluster` has already computed from the result pages. Reviews merges and splits, settles intent where the page and the endpoint disagree, and fixes page types. Use after `pnpm seo cluster`, or when asked which keywords belong on one page, whether two pages would compete, or what a page is for.
allowed-tools: Bash(pnpm seo:*)
---

# Cluster review

You judge; the code has already gathered and grouped. Work only through `pnpm seo`.

## How to work

Work autonomously. Make every judgment this skill describes, write it with `pnpm seo decide
... --by claude` with a one-line reason, run the report, and tell the user what was decided and
why in a short summary. Do not stop to ask for confirmation of individual decisions: the user
reviews the report and overrides through `seo decide` where they disagree. Ask the user only
when a command refuses to run because the estimated spend exceeds the site's threshold, or when
a judgment is theirs alone (which services the business offers). If the user invoked this skill
with the word `confirm`, show the proposed decisions as a table and wait before writing.

## Read

1. `pnpm seo query clusters --slug <slug> --json`. Read `meta.degenerate` first: when most pairs
   share three or more results the field is small and the overlap rule collapses everything
   into one page; read the tie-breakers before trusting a merge.
2. `pnpm seo query serp-overlap --slug <slug> --json -p min_shared=2`. For each merged pair,
   check `purposeBuiltNarrow` and `packDiffers`. For each pair that stayed apart with two
   shared results, ask whether a competitor holds one page for both.

## Propose

3. Merges to undo (two questions on one page that deserve two) and merges to make (one question
   split across two clusters, which the build would reject as two pages for one keyword).
4. Intent where the page and the label disagree: the page wins, but say why in one line.
5. Page types: a price or comparison term is a guide, a service term with a place is an
   intersection, a bare service term is a service page, a question belongs on the nearest page.

## Write

1. Write: `pnpm seo decide keyword <id> --slug <slug> -d cluster=<primary keyword id>`
   to move a keyword into another cluster, `-d cluster=own` to give it a page of its own,
   `-d intent=<label>` and `-d page_type=<type>` on the cluster's primary keyword. Then
   `pnpm seo report --slug <slug>`.
