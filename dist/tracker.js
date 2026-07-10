/**
 * Tracks file operations to detect repeated writes/edits to the same file.
 */
export class FileOperationTracker {
    operations = new Map();
    threshold;
    constructor(threshold = 3) {
        this.threshold = threshold;
    }
    makeKey(path, toolName) {
        return `${toolName}:${path}`;
    }
    /**
     * Record a file operation and check if it has exceeded the repeat threshold.
     */
    record(path, toolName) {
        const key = this.makeKey(path, toolName);
        const existing = this.operations.get(key);
        const now = Date.now();
        const operation = { toolName, path, timestamp: now };
        if (!existing) {
            this.operations.set(key, { count: 1, operations: [operation] });
            return { count: 1, isRepeating: false };
        }
        const nextCount = existing.count + 1;
        const next = {
            count: nextCount,
            operations: [...existing.operations, operation],
        };
        this.operations.set(key, next);
        return { count: nextCount, isRepeating: nextCount >= this.threshold };
    }
    /**
     * Get all file paths that have reached or exceeded the threshold.
     */
    getRepeats(minThreshold) {
        const min = minThreshold ?? this.threshold;
        const result = [];
        for (const [key, entry] of this.operations) {
            if (entry.count >= min) {
                const separatorIndex = key.indexOf(":");
                const toolName = key.slice(0, separatorIndex);
                const path = key.slice(separatorIndex + 1);
                result.push({ path, toolName, count: entry.count });
            }
        }
        return result;
    }
    /**
     * Reset all tracked state. Call on session shutdown or /new.
     */
    reset() {
        this.operations.clear();
    }
}
//# sourceMappingURL=tracker.js.map