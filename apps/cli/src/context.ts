import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot(): string {
    return fileURLToPath(new URL('../../../', import.meta.url));
}

export function loadEnv(): void {
    const file = resolve(repoRoot(), '.env');
    if (existsSync(file)) process.loadEnvFile(file);
}

export function resolveSiteDir(
    options: { site?: string; slug?: string },
    fallbackSlug?: string,
): string {
    if (options.site) return resolve(options.site);
    const slug = options.slug ?? fallbackSlug;
    if (!slug) throw new Error('pass --site <dir> or --slug <slug>');
    const dir = resolve(repoRoot(), 'sites', slug);
    mkdirSync(dir, { recursive: true });
    return dir;
}
