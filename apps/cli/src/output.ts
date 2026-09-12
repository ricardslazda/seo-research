export type Cell = string | number | boolean | null | undefined;

export function formatTable(rows: Record<string, Cell>[]): string {
    if (rows.length === 0) return '(no rows)';
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const text = (cell: Cell): string => (cell === null || cell === undefined ? '' : String(cell));
    const widths = columns.map((column) =>
        Math.max(column.length, ...rows.map((row) => text(row[column]).length)),
    );
    const line = (cells: string[]) =>
        cells
            .map((cell, i) => cell.padEnd(widths[i] ?? 0))
            .join('  ')
            .trimEnd();
    return [
        line(columns),
        line(widths.map((width) => '-'.repeat(width))),
        ...rows.map((row) => line(columns.map((column) => text(row[column])))),
    ].join('\n');
}

export function emit(json: boolean, data: unknown, table?: Record<string, Cell>[]): void {
    if (json) {
        process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        return;
    }
    if (table) process.stdout.write(formatTable(table) + '\n');
    else if (typeof data === 'string') process.stdout.write(data + '\n');
}

export function money(value: number | null | undefined): string {
    return value === null || value === undefined ? '' : `${value.toFixed(4)} USD`;
}

export function guardSpend(estimate: number, limit: number, yes: boolean): void {
    if (yes || estimate <= limit) return;
    throw new Error(
        `this run is estimated at ${estimate.toFixed(2)} USD, above the site's ask-above limit of ${limit.toFixed(2)} USD; re-run with --yes to proceed, or --dry-run to see the calls`,
    );
}
