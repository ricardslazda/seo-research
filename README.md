# seo-research

A command-line tool that decides what a local-service site should be about before anyone
builds it. It runs the research phases against the DataForSEO REST API, keeps every response,
stores one SQLite database per site, hands each batch to a Claude Code skill for the judgment
step, records every judgment as a row, and ends in a validated plan naming every page of the
site with its keywords, intent, evidence and links.

Built for small, multi-language markets, where every keyword database is thin and the tool has to
be honest about what it does not know. Nothing about a market is built in: the country, its
currency, its languages, the trade's words and the URL words all come from the site's config.

## Decisions

1. **Raw first.** Every API response is stored verbatim with its request hash and cost before
   anything is derived from it. Derived rows carry the raw row id. A phase re-run reads the
   cache unless `--refresh` is passed.
2. **Judgments are rows.** Fact tables hold only what an endpoint returned or a rule computed
   from it. Every verdict, label, threshold and exclusion is a row in `decisions`, whether made
   by a rule, by Claude or by the user, keyed so the latest wins and the history stays.
3. **Silence is not zero.** Volume is nullable with a status: `measured`, `below_floor`,
   `missing`. Row counts are reconciled against what was sent on every batch call. In a small
   language every keyword database is sparse, so a blank row is the absence of evidence, never
   evidence of absence. No rule rejects a candidate, keyword or page on volume alone. Demand has
   more than one witness: a measured volume, a purpose-built page ranking for the query, the
   query appearing in People Also Ask or related searches, or a competitor ranking for it.
4. **The pair is gated.** A call for a location and language pair the support matrix does not
   list is refused by the client before any request is hashed or sent.
5. **Same call, every time.** Result-page readings use one fixed argument set (mobile, android,
   city-level location, depth 20) in every phase, so a later rank check compares to the screen.
6. **Skills go through the CLI.** A skill runs `seo query` to read and `seo decide` to write and
   holds no other tool. It never opens the database or edits an output file.
7. **Market facts per site, API and country facts per tool.** `reference/` holds the location
   codes, language support and prices synced from the API, and the known domains of each
   country. Everything learned about a market lives in that site's database under
   `sites/<slug>/`.

## Requirements

Node 24, pnpm, and a DataForSEO account. Copy `.env.example` to `.env` and fill in the login
and password. Every call costs money; `--dry-run` prints what a phase would spend.

## Running a screen

Every command takes `--slug <slug>` for a site under `sites/`, or `--site <dir>` for a folder
anywhere else. Add `--json` for machine-readable output.

```
pnpm seo ref sync --countries GB      first; writes reference/*.json for the countries you research
pnpm seo screen --slug example        phase 1: volume, result pages, referring domains per service and place
pnpm seo competitors --slug example   phase 2: the ranking businesses, their keywords, earning pages and menus
pnpm seo keywords --slug example      phase 3: expansion in every language, priced at the first place
pnpm seo cluster --slug example       phase 4: one result page per shortlisted keyword, grouped by overlap
pnpm seo plan --slug example          phase 5: the pages to write, exported as out/plan.json with its schema
pnpm seo offpage --slug example       phase 6: citations from the strongest profile, listings around each town
pnpm seo rank --slug example          phase 7: where the site sits for every tracked keyword, once it is live
pnpm seo query <name> --slug example --json
pnpm seo decide <subject> <id> --slug example -d kind=value --reason "..." --by claude|human
pnpm seo report --slug example
pnpm seo cost --slug example
```

The reference sync is free and required: until it has run, every phase stops and says so. Pass
every country a site researches, as ISO codes separated by commas. The example site uses
placeholder location codes; replace them with the codes the sync wrote before running a phase.

Every phase accepts `--dry-run`, which prints the calls and their estimated cost, and `--refresh`,
which ignores the cache. A phase run twice costs nothing the second time. A place with
`volume_scope: country` in the config joins one country-level volume call instead of its own,
which is the right economy for towns whose terms sit below the reporting floor anyway.

Each phase has a judgment skill in `.claude/skills/`: `market-screen`, `competitor-teardown`,
`keyword-map`, `cluster-review`, `content-plan`, `off-page-plan` and `rank-check`. Run the skill in
Claude Code after the phase has gathered. It reads through `seo query`, decides, writes through
`seo decide`, and reports. Review is by exception: read `out/report.md` and override what you
disagree with. A skill asks only when a phase refuses to run above the site's spending threshold
(`spend_ask_above_usd`, three dollars by default; pass `--yes`) or when the judgment is yours
alone, such as which services the business offers. Invoke a skill with the word `confirm` to be
asked before it writes.

Town pages carry evidence derived from the data: distance and travel time from the base place
(coordinates and a `service_area` policy in the config), which services show demand there, who
already holds a page for the town, the pack's entry price, and when demand peaks. Facts you add as
page decisions make a page `verified`; the tool never invents one.

## The site folder

A site folder holds `site.config.yaml`, `research.sqlite` (every raw response, every fact, every
decision; not committed), and `out/` (committed): `report.md`, `decisions.jsonl`, `plan.json` and
`plan.schema.json`. `sites/example/site.config.yaml` states every block below and ships without
outputs.

- `slug`, `languages`: the site's name and its languages, the first being the default locale.
- `places`: each town or district with its `location_code`, `kind` (`city` or `district`) and
  `parent`, its name forms per language, optional URL `slugs`, `coordinates` and `volume_scope`.
  The first place is the hub.
- `services`: each service with its `key`, its forms per language (`term` is the one every
  language needs) and optional URL `slugs`.
- `head_forms`: per language, which service form and which place form compose a keyword. The
  first composes the head keyword of the screen; the rest are variants read beside it.
- `market`: `country` (defaults to the country of the first place's location), `currency` (an ISO
  code; without it no page is read for prices and no charge is quoted), `currency_marks` (other
  spellings of the currency in prices, such as a symbol), `phone_pattern` (how phone numbers are
  written on competitor pages; the default reads any run of seven to fifteen digits with the
  usual separators), `home_tlds` (the domain endings of the home market; defaults to the country
  code) and `ignore_countries` (referring domains that link only from these countries are
  ignored).
- `paths`: per language, the URL word of service pages and of guide pages
  (`{ services: services, guides: guides }` when a language is absent). Every language after the
  first sits under its own prefix, as in `/es/servicios/...`.
- `service_area`: the `base` place, `free_km` and `per_km` (the travel charge beyond it, in the
  market currency, so it needs `market.currency`), `road_factor` and `average_kmh` for travel
  time, a `response_promise` per language, and for the listings phase `listing_categories`,
  `listing_radius_km` and `listing_match`, the pattern that says which listings count as the trade.
- `vocabulary`: the trade's words, written folded as the rules read them (ASCII letters, Cyrillic
  transliterated). `topic_stems` mark a keyword as on topic, `non_distinctive` stems are too
  common to attribute a service by, `brands` exclude a keyword that names one, `exclusions` are
  patterns with the reason each records, `out_of_area` names places the business does not serve,
  and `near` adds words such as "near me" to the place names when reading the `place` modifier.
  `modifiers` are named patterns a keyword can carry, such as `price`, `urgency`, `question`,
  `comparison` or a trade's own `material`; `24` always reads as urgency and `vs` as comparison.
  `directory_paths` and `guide_paths` extend the English defaults that read a result's URL path
  as a listing page or a guide.
- `spend_ask_above_usd`, `domain`, `business_name`: the spending threshold above which a phase
  asks first, and the site's own domain and business name, which the rank check and the listings
  look for.

Everything in `vocabulary` and `market` is per site, so a second trade or country never inherits
the first one's words; without a vocabulary the keyword rules exclude nothing.

`plan.json` is the contract for whatever builds the site: one entry per page with its type,
parent, a path, primary keyword, supporting keywords, intent, questions and demand flag per
locale, the two pages that link to it in body copy, its build tier, and its status. An area page
stays `blocked` until a person has recorded its justification, three local facts and a source.
Its derived evidence carries the road distance and travel time from the base, whether travel is
free, and `surchargePerKm` with its `currency`, both null when the config sets no `per_km`.

## Reference data

`seo ref sync --countries <ISO,...>` writes `reference/locations.json`,
`reference/language-support.json` and `reference/prices.json`. They are account and API data and
not committed. Each run replaces them, so name every country you research in the same run.

Known domains are yours to write, one file per country, named by its lowercase ISO code, such as
`reference/domains.gb.json`; a site reads only the file of its own country. A listed domain takes
its kind from the list before any rule reads its URL, and a subdomain inherits its parent's kind.
The competitor phase never selects a listed domain, and in the off-page phase directories,
classifieds, government and social sites are citations any business can claim.

```json
{
    "directory": ["directory-one.example"],
    "classifieds": ["classifieds-hub.example"],
    "jobs": ["jobs-board.example"],
    "social": ["social-network.example"],
    "marketplace": ["marketplace.example"],
    "government": ["northbridge-council.example"]
}
```

## Layout

```
packages/dfs-client   DataForSEO REST client: transport, canonical hashing, cache, limiter, gate, endpoints
packages/core         database schema, site config, reference data, phases, queries, decisions, report
apps/cli              the seo command
reference/            synced location codes, language support and prices; known domains per country
sites/<slug>/         one site's config, database and outputs
.claude/skills/       the judgment skills, one per phase
```

`pnpm check` runs formatting, lint, types, spelling and the tests. Tests never call the network:
synthetic answers in the DataForSEO shape live under `packages/dfs-client/test/fixtures`.
