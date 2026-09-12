---
name: competitor-teardown
description: Judge a competitor teardown that `seo competitors` has already gathered. Reads the competitors, their earning pages, service menus, seed keywords and the coverage gaps through the CLI, and turns them into the researched service list, the page types that earn, and the gaps to build in. Use after `pnpm seo competitors`, or when asked what to write about, which services to offer pages for, or who the real competitors are.
allowed-tools: Bash(pnpm seo:*)
---

# Competitor teardown

You judge; the code has already gathered. Work only through `pnpm seo`. Never open a database
file, never edit anything under `sites/`, never call an endpoint yourself. Use what you read for
the topic map, never the prose: a competitor's subject list is fair, their sentences are not.

## How to work

Work autonomously. Make every judgment this skill describes, write it with `pnpm seo decide
... --by claude` with a one-line reason, run the report, and tell the user what was decided and
why in a short summary. Do not stop to ask for confirmation of individual decisions: the user
reviews the report and overrides through `seo decide` where they disagree. Ask the user only
when a command refuses to run because the estimated spend exceeds the site's threshold, or when
a judgment is theirs alone (which services the business offers). If the user invoked this skill
with the word `confirm`, show the proposed decisions as a table and wait before writing.

## Read

1. `pnpm seo query competitors --slug <slug> --json`. Which of them are real businesses? A
   business ranks for tens to a few hundred database keywords and holds a real page per service;
   a portal ranks for thousands. Breadth on the screen is a number, not a verdict.
2. `pnpm seo query competitor-menus --slug <slug> --json`. This is what every competitor chose
   to have a page for. Count how many competitors carry each subject.
3. `pnpm seo query competitor-keywords --slug <slug> --json` per language. These are observed
   forms. Note the head term per subject, its plural and unaccented variants, and every term that
   looks commercial but is not: courses, jobs, materials, brands.
4. `pnpm seo query competitor-pages --slug <slug> --json`. Which page types earn: service hubs,
   place pages, intersections or guides. Read value per keyword, not value alone.
5. `pnpm seo query coverage --slug <slug> --json`. Where nobody holds a purpose-built page.

## Propose

6. The researched service list: one entry per subject that at least two competitors carry or
   that has measured demand, with the head term per language taken from the observed forms and
   the plain spelling beside it. Say which of the site's current services stay, merge or go, and
   which new ones enter. Present it as the `services:` block of `site.config.yaml`.
7. Which page types to build first, from what earns. Which competitor holds the strongest
   profile, by referring domains among the businesses. The gaps worth taking, by language.
8. The exclusions the keyword phase must apply: recruitment, training, materials, brands.

## Write

1. Write: `pnpm seo decide domain <domain> --slug <slug> -d kind=business --reason "..."` for
   the businesses, `-d strongest=true` for one of them, `-d competitor=false` for any domain that
   is not one. Then tell the user to paste the services block into `site.config.yaml` and run
   `pnpm seo screen --slug <slug>` again so the towns are read for the researched set.
