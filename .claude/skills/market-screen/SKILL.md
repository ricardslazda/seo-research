---
name: market-screen
description: Judge a market screen that `seo screen` has already gathered. Reads the batch through the CLI, proposes cut lines from the batch's own distribution, asks the user the one question no endpoint answers, and records verdicts as decisions after confirmation. Use after `pnpm seo screen`, or when asked which candidate market to build in.
allowed-tools: Bash(pnpm seo:*)
---

# Market screen

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

1. `pnpm seo query screen-batch --slug <slug> --json`. If it fails because nothing was gathered,
   stop and ask the user to run `pnpm seo screen --slug <slug>` first.
2. Read `meta.distribution` per language before any row: how many rows are measured, below floor,
   missing, or have a suspect form. In a small language most of the long tail sits below the
   reporting floor. A blank row is the absence of evidence and rejects nothing on its own.
3. Read every row's `flags`. A `form_suspect` probe means the composed keyword may be wrong
   grammar, not weak demand. A `better_form` flag means a variant out-volumed the head; say so.

## Propose

When the services are a business's own list rather than candidates to choose between, the screen
is a coverage screen: `go` means a page in the first build, `caution` a page later once the
first pages rank, `reject` no page, and `chosen` marks the first build. The readings and the cut
lines are the same either way.

4. Per language, propose cut lines from the quartiles in `meta.distribution`, and say in one
   sentence what the batch looked like. `reject_below_volume` applies to measured rows only.
   `reject_above_rd` is the referring-domain median above which the field is out of reach.
   `pack_ceiling` is the pack median review count above which entering it is unrealistic.
   `bid_floor` is the top-of-page bid under which a lead is not worth chasing.
5. Per candidate, draft `go`, `caution` or `reject` with a one-sentence reason that names the
   reading it rests on: first organic rank and what sits above it, directories in the top ten,
   purpose-built pages, the pack, and `demandEvidence`. A candidate whose volume is below floor
   but has any other witness is judged on its result page, and a rejection of it must cite that
   page, never the blank row. Prefer a market with several services and places that survive.
6. Ask the user, per surviving candidate, whether three checkable local facts could be written
   about doing this service in this place. That answer is theirs, recorded `--by human`.

## Write

8. Thresholds: `pnpm seo decide threshold screen:<lang> --slug <slug> -d reject_below_volume=<n> -d reject_above_rd=<n> -d pack_ceiling=<n> -d bid_floor=<n> --reason "<what the batch looked like>"`.
9. Candidates: one batch on stdin, `pnpm seo decide --batch - --slug <slug>`, a JSON array of
   `{ "subjectType": "candidate", "subjectId": "<id>", "decisions": [{ "kind": "verdict", "value": "go" }], "reason": "...", "madeBy": "claude" }`.
   Local facts go in the same batch with `"madeBy": "human"`. Mark the winner with
   `{ "kind": "chosen", "value": "true" }`.
10. `pnpm seo report --slug <slug>`, then tell the user: the chosen market, why it won, the
    runners-up, and the observation that would prove the pick wrong.
