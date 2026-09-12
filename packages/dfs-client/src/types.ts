export interface DfsTask<Result = unknown> {
    id: string;
    status_code: number;
    status_message: string;
    time: string;
    cost: number;
    result_count: number;
    path: string[];
    data: Record<string, unknown>;
    result: Result[] | null;
}

export interface DfsEnvelope<Result = unknown> {
    version: string;
    status_code: number;
    status_message: string;
    time: string;
    cost: number;
    tasks_count: number;
    tasks_error: number;
    tasks: DfsTask<Result>[];
}

export const OK_STATUS = 20000;
