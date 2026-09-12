import { Command } from 'commander';

import { clusterCommand } from './commands/cluster.js';
import { competitorsCommand } from './commands/competitors.js';
import { costCommand } from './commands/cost.js';
import { keywordsCommand } from './commands/keywords.js';
import { offpageCommand } from './commands/offpage.js';
import { planCommand } from './commands/plan.js';
import { decideCommand } from './commands/decide.js';
import { probeCommand } from './commands/probe.js';
import { rankCommand } from './commands/rank.js';
import { queryCommand } from './commands/query.js';
import { refCommand } from './commands/ref.js';
import { reportCommand } from './commands/report.js';
import { screenCommand } from './commands/screen.js';
import { loadEnv } from './context.js';

loadEnv();

const program = new Command()
    .name('seo')
    .description('market research for local-service sites, phase by phase')
    .option('--json', 'machine-readable output')
    .addCommand(refCommand())
    .addCommand(screenCommand())
    .addCommand(competitorsCommand())
    .addCommand(keywordsCommand())
    .addCommand(clusterCommand())
    .addCommand(planCommand())
    .addCommand(offpageCommand())
    .addCommand(rankCommand())
    .addCommand(queryCommand())
    .addCommand(decideCommand())
    .addCommand(reportCommand())
    .addCommand(costCommand())
    .addCommand(probeCommand());

program.parseAsync().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
});
