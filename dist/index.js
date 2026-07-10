import { FileOperationTracker } from "./tracker.js";
const REPEAT_THRESHOLD = 3;
const RESPONSE_KEY = "__response_repeat__";
const TOOL_REPEAT_PREFIX = "__tool_repeat__";
/**
 * Pi extension that detects:
 * 1. Repeated write/edit on the same file
 * 2. Repeated model responses (exact text match)
 * 3. Repeated tool calls with identical arguments (e.g. same bash/eval command)
 */
export default async function (pi) {
    const tracker = new FileOperationTracker(REPEAT_THRESHOLD);
    const pendingKeys = new Set();
    const notifiedKeys = new Set();
    const responseHistory = [];
    // General tool call repetition tracker: toolName + serialized input → count
    const toolCallCounts = new Map();
    pi.on("tool_result", async (event) => {
        const toolName = event.toolName;
        const input = event.input;
        // --- write/edit file tracking (existing) ---
        if (toolName === "write" || toolName === "edit") {
            const path = typeof input?.path === "string" ? input.path : undefined;
            if (path) {
                const result = tracker.record(path, toolName);
                const key = `${toolName}:${path}`;
                const isEscalation = result.count >= REPEAT_THRESHOLD &&
                    (result.count % REPEAT_THRESHOLD === 0 || result.count === REPEAT_THRESHOLD);
                const escalationKey = `${key}@${result.count}`;
                if (isEscalation && !notifiedKeys.has(escalationKey)) {
                    pendingKeys.add(key);
                    notifiedKeys.add(escalationKey);
                    const reminder = result.count === REPEAT_THRESHOLD
                        ? `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times in a row. Please verify the content is correct and consider whether this repetition is truly necessary before proceeding.`
                        : `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times now. The earlier warning may have been ignored. Please verify you are not stuck and consider a different approach.`;
                    const content = [...event.content];
                    const last = content.at(-1);
                    if (last && typeof last === "object" && last !== null &&
                        "type" in last && last.type === "text" && "text" in last) {
                        last.text += reminder;
                    }
                    else {
                        content.push({ type: "text", text: reminder });
                    }
                    return { content };
                }
            }
            return;
        }
        // --- General tool call repetition tracking (bash, agent-browser, eval, etc.) ---
        // Build a stable fingerprint: toolName + key input fields
        // For tools with a "command" or "code" field, use that. Otherwise use full input.
        const cmd = typeof input?.command === "string" ? input.command :
            typeof input?.code === "string" ? input.code :
                typeof input?.url === "string" ? input.url :
                    null;
        const fingerprint = cmd ? `${toolName}:${cmd}` : null;
        if (!fingerprint)
            return;
        const prev = toolCallCounts.get(fingerprint) ?? 0;
        const next = prev + 1;
        toolCallCounts.set(fingerprint, next);
        if (next === REPEAT_THRESHOLD && !notifiedKeys.has(fingerprint)) {
            pendingKeys.add(TOOL_REPEAT_PREFIX);
            notifiedKeys.add(fingerprint);
        }
    });
    pi.on("turn_end", async (event) => {
        const msg = event.message;
        if (!msg || msg.role !== "assistant")
            return;
        const contents = msg.content;
        const text = contents
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
        if (!text)
            return;
        const toolResults = event.toolResults;
        if (toolResults && toolResults.length > 0) {
            responseHistory.length = 0;
            return;
        }
        responseHistory.push(text);
        if (responseHistory.length > REPEAT_THRESHOLD) {
            responseHistory.shift();
        }
        if (responseHistory.length === REPEAT_THRESHOLD &&
            responseHistory.every((t) => t === responseHistory[0]) &&
            !notifiedKeys.has(RESPONSE_KEY)) {
            pendingKeys.add(RESPONSE_KEY);
            notifiedKeys.add(RESPONSE_KEY);
        }
    });
    pi.on("context", async (event) => {
        if (pendingKeys.size === 0)
            return;
        const parts = [];
        if (pendingKeys.has(RESPONSE_KEY)) {
            parts.push("You have given the same response multiple times in a row.");
        }
        if (pendingKeys.has(TOOL_REPEAT_PREFIX)) {
            parts.push("You have executed the same command repeatedly. Your approach is not producing different results — try a different direction.");
        }
        const fileRepeats = tracker.getRepeats();
        const fileDetails = fileRepeats
            .filter((r) => pendingKeys.has(`${r.toolName}:${r.path}`))
            .map((r) => `${r.path} (${r.toolName} \u00d7${r.count})`)
            .join(", ");
        if (fileDetails) {
            parts.push(`The following files have been modified repeatedly: ${fileDetails}.`);
        }
        pendingKeys.clear();
        if (parts.length === 0)
            return;
        const messages = [...event.messages];
        messages.push({
            role: "user",
            content: `[loop-guard] ${parts.join(" ")} Please pause, review your approach, and try something different.`,
            timestamp: Date.now(),
        });
        return { messages };
    });
    pi.on("session_shutdown", () => {
        tracker.reset();
        pendingKeys.clear();
        notifiedKeys.clear();
        responseHistory.length = 0;
        toolCallCounts.clear();
    });
}
//# sourceMappingURL=index.js.map