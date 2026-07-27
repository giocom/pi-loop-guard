export class FileOperationTracker {
    counts = new Map();
    threshold;
    constructor(threshold = 3) {
        this.threshold = threshold;
    }
    makeKey(path, toolName) {
        return `${toolName}:${path}`;
    }
    record(path, toolName, fingerprint) {
        const key = fingerprint ? `${toolName}:${path}::${fingerprint}` : this.makeKey(path, toolName);
        const existing = this.counts.get(key) ?? 0;
        const nextCount = existing + 1;
        this.counts.set(key, nextCount);
        return { count: nextCount, isRepeating: nextCount >= this.threshold };
    }
    getRepeats(minThreshold) {
        const min = minThreshold ?? this.threshold;
        const result = [];
        for (const [key, count] of this.counts) {
            if (count >= min) {
                const sep = key.indexOf(":");
                const rest = key.slice(sep + 1);
                // If fingerprint is present (path::fingerprint), extract just the display path
                const doubleSep = rest.indexOf("::");
                const path = doubleSep >= 0 ? rest.slice(0, doubleSep) : rest;
                result.push({ path, toolName: key.slice(0, sep), count });
            }
        }
        return result;
    }
    reset() {
        this.counts.clear();
    }
}
//# sourceMappingURL=tracker.js.map