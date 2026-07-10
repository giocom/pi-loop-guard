/**
 * Tracks file operations to detect repeated writes/edits to the same file.
 */
export interface FileOperation {
    toolName: string;
    path: string;
    timestamp: number;
}
export interface RepeatEntry {
    count: number;
    operations: FileOperation[];
}
export interface RepeatCheck {
    count: number;
    isRepeating: boolean;
}
export declare class FileOperationTracker {
    private readonly operations;
    private readonly threshold;
    constructor(threshold?: number);
    private makeKey;
    /**
     * Record a file operation and check if it has exceeded the repeat threshold.
     */
    record(path: string, toolName: string): RepeatCheck;
    /**
     * Get all file paths that have reached or exceeded the threshold.
     */
    getRepeats(minThreshold?: number): Array<{
        path: string;
        toolName: string;
        count: number;
    }>;
    /**
     * Reset all tracked state. Call on session shutdown or /new.
     */
    reset(): void;
}
//# sourceMappingURL=tracker.d.ts.map