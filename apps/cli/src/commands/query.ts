import { Command } from 'commander';

import { findQuery, listQueries } from '@seo/core';

import { emit, type Cell } from '../output.js';
import { openSite } from '../site.js';

function flatten(row: Record<string, unknown>, prefix = ''): Record<string, Cell> {
    const out: Record<string, Cell> = {};
    for (const [key, value] of Object.entries(row)) {
        const name = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(out, flatten(value as Record<string, unknown>, name));
        } else if (Array.isArray(value)) {
            const text = JSON.stringify(value);
            out[name] = text.length > 40 ? `${text.slice(0, 37)}...` : text;
        } else {
            out[name] = value as Cell;
        }
    }
    return out;
}

function parseParams(pairs: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index <= 0) throw new Error(`--param expects key=value, got "${pair}"`);
        out[pair.slice(0, index)] = pair.slice(index + 1);
    }
    return out;
}

export function queryCommand(): Command {
    return new Command('query')
        .description('read a named view of the site database; this is what the skills consume')
        .argument('[name]', 'query name; omit or pass --list to see them')
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option(
            '-p, --param <key=value>',
            'query parameter, repeatable',
            (value: string, all: string[]) => [...all, value],
            [] as string[],
        )
        .option('--list', 'list the queries', false)
        .action(
            (
                name: string | undefined,
                options: { site?: string; slug?: string; param: string[]; list: boolean },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                if (!name || options.list) {
                    const rows = listQueries().map((query) => ({
                        name: query.name,
                        description: query.description,
                    }));
                    emit(json ?? false, rows, rows);
                    return;
                }
                const query = findQuery(name);
                if (!query) throw new Error(`unknown query "${name}"; run "seo query --list"`);
                const params = query.params.parse(parseParams(options.param));
                const site = openSite(options);
                try {
                    const result = query.run(
                        {
                            db: site.db,
                            config: site.config,
                            reference: site.reference,
                            site: site.slug,
                        },
                        params,
                    );
                    emit(
                        json ?? false,
                        result,
                        result.rows.map((row) => flatten(row)),
                    );
                } finally {
                    site.close();
                }
            },
        );
}
