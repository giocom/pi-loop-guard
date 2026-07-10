const REPEAT_THRESHOLD = 3;
/**
 * Tracks file operations per path+toolName key.
 */
class FileOperationTracker {
    operations = new Map();
    threshold;
    constructor(threshold) {
        this.threshold = threshold;
    }
    record(path, toolName) {
        const key = `${toolName}:${path}`;
        const existing = this.operations.get(key);
        if (!existing) {
            this.operations.set(key, { count: 1 });
            return { count: 1, isRepeating: false };
        }
        const nextCount = existing.count + 1;
        existing.count = nextCount;
        return { count: nextCount, isRepeating: nextCount >= this.threshold };
    }
    getRepeats(minThreshold) {
        const min = minThreshold ?? this.threshold;
        const result = [];
        for (const [key, entry] of this.operations) {
            if (entry.count >= min) {
                const sep = key.indexOf(":");
                result.push({ path: key.slice(sep + 1), toolName: key.slice(0, sep), count: entry.count });
            }
        }
        return result;
    }
    reset() {
        this.operations.clear();
    }
}
/**
 * Pi extension that detects repeated file write/edit operations and gently
 * nudges the model to self-correct instead of hard-blocking.
 */
export default async function (pi) {
    const tracker = new FileOperationTracker(REPEAT_THRESHOLD);
    const pendingKeys = new Set();
    const notifiedKeys = new Set();
    pi.on("tool_result", async (event, ctx) => {
        const toolName = event.toolName;
        // Only intercept write and edit
        if (toolName !== "write" && toolName !== "edit") {
            return;
        }
        // Read path from tool call arguments
        const input = event.input;
        const path = typeof input?.path === "string" ? input.path : undefined;
        if (!path) {
            return;
        }
        const result = tracker.record(path, toolName);
        const key = `${toolName}:${path}`;
        // Inject reminder exactly once when crossing threshold
        if (result.count === REPEAT_THRESHOLD && !notifiedKeys.has(key)) {
            pendingKeys.add(key);
            notifiedKeys.add(key);
            const reminder = `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times in a row. ` +
                `Please verify the content is correct and consider whether this repetition is truly necessary before proceeding.`;
            const content = [...event.content];
            const last = content.at(-1);
            if (last &&
                typeof last === "object" &&
                last !== null &&
                "type" in last &&
                last.type === "text" &&
                "text" in last) {
                last.text += reminder;
            }
            else {
                content.push({ type: "text", text: reminder });
            }
            return { content };
        }
    });
    pi.on("context", async (event) => {
        if (pendingKeys.size === 0) {
            return;
        }
        const repeats = tracker.getRepeats();
        const details = repeats
            .filter((r) => pendingKeys.has(`${r.toolName}:${r.path}`))
            .map((r) => `${r.path} (${r.toolName} \u00d7${r.count})`)
            .join(", ");
        pendingKeys.clear();
        if (!details) {
            return;
        }
        const messages = [...event.messages];
        messages.push({
            role: "user",
            content: `[loop-guard] The following files have been modified repeatedly: ${details}. ` +
                `Please pause, review the current state, and confirm whether further changes are truly needed before proceeding.`,
            timestamp: Date.now(),
        });
        return { messages };
    });
    pi.on("session_shutdown", () => {
        tracker.reset();
        pendingKeys.clear();
        notifiedKeys.clear();
    });
}
//# sourceMappingURL=index.js.map