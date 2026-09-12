import { Command } from 'commander';

import { createClient, defaultReferenceDir, syncReference } from '@seo/core';

import { emit } from '../output.js';

export function refCommand(): Command {
    const ref = new Command('ref').description(
        'reference data: locations, language support, prices',
    );
    ref.command('sync')
        .description('fetch the free reference endpoints and write reference/*.json')
        .requiredOption(
            '-c, --countries <isos>',
            'comma-separated country codes of the markets to research, e.g. GB,IE',
        )
        .action(async (options: { countries: string }, command: Command) => {
            const { json } = command.optsWithGlobals<{ json?: boolean }>();
            const client = createClient({ reference: null });
            const summary = await syncReference(client, {
                countries: options.countries.split(',').map((iso) => iso.trim()),
            });
            const rows = Object.entries(summary.countries).map(([country, info]) => ({
                country,
                locations: info.locations,
                labs_languages: info.labs.join(','),
            }));
            emit(json ?? false, summary, rows);
            if (!json) {
                process.stdout.write(
                    `serp languages: ${summary.global.serp}, ads languages: ${summary.global.ads}, balance: ${summary.balance ?? '?'} USD\nwritten to ${defaultReferenceDir()}\n`,
                );
            }
        });
    return ref;
}
