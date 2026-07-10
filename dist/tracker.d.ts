export interface RepeatCheck {
    count: number;
    isRepeating: boolean;
}
export declare class FileOperationTracker {
    private readonly counts;
    private readonly threshold;
    constructor(threshold?: number);
    private makeKey;
    record(path: string, toolName: string): RepeatCheck;
    getRepeats(minThreshold?: number): Array<{
        path: string;
        toolName: string;
        count: number;
    }>;
    reset(): void;
}
//# sourceMappingURL=tracker.d.ts.map