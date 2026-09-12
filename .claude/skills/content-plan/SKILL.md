---
name: content-plan
description: Judge the plan that `seo plan` has already built from the clusters. Writes the angle of each page, records the evidence that unblocks a town page, strikes pages the evidence does not support, and hands over out/plan.json. Use after `pnpm seo plan`, or when asked what pages a site should have, in what order, or what each page must prove.
allowed-tools: Bash(pnpm seo:*)
---

# Content plan

You judge; the code has already built the plan. Work only through `pnpm seo`.

## How to work

Work autonomously. Make every judgment this skill describes, write it with `pnpm seo decide
... --by claude` with a one-line reason, run the report, and tell the user what was decided and
why in a short summary. Do not stop to ask for confirmation of individual decisions: the user
reviews the report and overrides through `seo decide` where they disagree. Ask the user only
when a command refuses to run because the estimated spend exceeds the site's threshold, or when
a judgment is theirs alone (which services the business offers). If the user invoked this skill
with the word `confirm`, show the proposed decisions as a table and wait before writing.

## Read

1. `pnpm seo query plan-pages --slug <slug> --json`. Read `meta.by_status`, the budget, and
   `notes` per page: a missing angle, missing evidence, a primary keyword two pages claim.
2. `pnpm seo query clusters --slug <slug> --json` for the questions and supporting keywords a
   page inherits, and `pnpm seo query coverage --slug <slug> --json` for what competitors hold in
   each town.

## Propose

3. An angle per page: one line saying what this page says that no sibling says. Neighboring
   town pages for one trade are where this bites; the answer is different evidence, not
   different wording.
4. Town evidence is derived by the tool from distance, demand, competition and seasonality. Read it in the plan and add a fact only where you know something the data does not; never invent one.
5. Pages to strike: a service with no demand and no conversion role, a town with no facts.

## Write

1. Write: `pnpm seo decide page <key> --slug <slug> -d angle="..."`, and for towns
   `-d justification="..." -d fact_1="..." -d fact_2="..." -d fact_3="..." -d source="..."`,
   `--by human` for the evidence. `-d build=false` strikes a page. Then `pnpm seo plan --slug
<slug>` to rebuild out/plan.json and the report, and tell the user which pages are planned,
   which are blocked and why, and the build order.
