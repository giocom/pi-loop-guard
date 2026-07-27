import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FileOperationTracker } from "./tracker.js";

const REPEAT_THRESHOLD = 5;
const RESPONSE_KEY = "__response_repeat__";
const TOOL_REPEAT_PREFIX = "__tool_repeat__";

/**
 * Pi extension that detects:
 * 1. Repeated write/edit on the same file
 * 2. Repeated model responses (exact text match)
 * 3. Repeated tool calls with identical arguments (e.g. same bash/eval command)
 */
export default async function (pi: ExtensionAPI): Promise<void> {
  const tracker = new FileOperationTracker(REPEAT_THRESHOLD);
  const pendingKeys = new Set<string>();
  const notifiedKeys = new Set<string>();
  const responseHistory: string[] = [];

  // General tool call repetition tracker: toolName + serialized input → count
  const toolCallCounts = new Map<string, number>();

  pi.on("tool_result", async (event) => {
    const toolName = event.toolName;
    const input = event.input as Record<string, unknown>;

    // --- write/edit file tracking (existing) ---
    if (toolName === "write" || toolName === "edit") {
      const path = typeof input?.path === "string" ? input.path
                 : typeof input?.filePath === "string" ? input.filePath
                 : undefined;
      if (path) {
        // For edit tools, also track content fingerprint so only truly identical
        // edits (same path + oldString + newString) are counted as repeats.
        const editFingerprint = toolName === "edit"
          ? `${input?.oldString ?? ""}::${input?.newString ?? ""}`
          : undefined;
        const result = tracker.record(path, toolName, editFingerprint);
        const trackingKey = editFingerprint
          ? `${toolName}:${path}::${editFingerprint}`
          : `${toolName}:${path}`;
        const isEscalation =
          result.count >= REPEAT_THRESHOLD &&
          (result.count % REPEAT_THRESHOLD === 0 || result.count === REPEAT_THRESHOLD);
        const escalationKey = `${trackingKey}@${result.count}`;
        if (isEscalation && !notifiedKeys.has(escalationKey)) {
          pendingKeys.add(trackingKey);
          notifiedKeys.add(escalationKey);
          const reminder =
            result.count === REPEAT_THRESHOLD
              ? `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times in a row. If you are stuck, try searching the web or using context7 to look up documentation before making further changes.`
              : `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times now. The earlier warning may have been ignored. Consider looking up relevant documentation via context7 or web search instead of repeating the same change.`;
          const content = [...event.content];
          const last = content.at(-1);
          if (
            last && typeof last === "object" && last !== null &&
            "type" in last && (last as { type: unknown }).type === "text" && "text" in last
          ) {
            (last as { text: string }).text += reminder;
          } else {
            content.push({ type: "text", text: reminder });
          }
          return { content };
        }
      }
      return;
    }

    // --- General tool call repetition tracking ---
    // Build a fingerprint from the tool name (+ command/code for parameterised tools).
    // This catches repeated litellm_skill_list, repeated agent-browser eval, etc.
    // When no known field matches, fall back to the full input serialization so
    // any tool with identical arguments (regardless of field naming) is detected.
    const cmd =
      typeof input?.command === "string" ? input.command :
      typeof input?.code === "string" ? input.code :
      typeof input?.url === "string" ? input.url :
      typeof input?.script === "string" ? input.script :
      typeof input?.expression === "string" ? input.expression :
      typeof input?.eval === "string" ? input.eval :
      typeof input?.text === "string" ? input.text :
      null;

    const fingerprint = cmd ? `${toolName}:${cmd}` : `${toolName}:${JSON.stringify(input)}`;
    const prev = toolCallCounts.get(fingerprint) ?? 0;
    const next = prev + 1;
    toolCallCounts.set(fingerprint, next);

    // Periodic escalation: warn every REPEAT_THRESHOLD (5, 10, 15…)
    // matching the file-tracking pattern so sustained loops don't go silent.
    if (next >= REPEAT_THRESHOLD && next % REPEAT_THRESHOLD === 0) {
      const escalationKey = `${fingerprint}@${next}`;
      if (!notifiedKeys.has(escalationKey)) {
        pendingKeys.add(TOOL_REPEAT_PREFIX);
        notifiedKeys.add(escalationKey);
        const reminder =
          next === REPEAT_THRESHOLD
            ? `\n\n[loop-guard] You have called \`${toolName}\` with the same arguments ${next} times in a row. Your approach is not producing different results — try searching the web or using context7 to look up documentation before making further changes.`
            : `\n\n[loop-guard] You have called \`${toolName}\` with the same arguments ${next} times now. The earlier warning may have been ignored. Consider looking up relevant documentation via context7 or web search instead of repeating the same command.`;
        const content = [...event.content];
        const last = content.at(-1);
        if (
          last && typeof last === "object" && last !== null &&
          "type" in last && (last as { type: unknown }).type === "text" && "text" in last
        ) {
          (last as { text: string }).text += reminder;
        } else {
          content.push({ type: "text", text: reminder });
        }
        return { content };
      }
    }
  });

  pi.on("turn_end", async (event) => {
    const msg = event.message;
    if (!msg || msg.role !== "assistant") return;

    const contents = msg.content as unknown as Array<Record<string, unknown>>;
    const text = contents
      .filter((c): c is Record<string, string> => c.type === "text")
      .map((c) => c.text)
      .join("");
    if (!text) return;

    responseHistory.push(text);
    if (responseHistory.length > REPEAT_THRESHOLD) {
      responseHistory.shift();
    }

    if (
      responseHistory.length === REPEAT_THRESHOLD &&
      responseHistory.every((t) => t === responseHistory[0]) &&
      !notifiedKeys.has(RESPONSE_KEY)
    ) {
      pendingKeys.add(RESPONSE_KEY);
      notifiedKeys.add(RESPONSE_KEY);
    }
  });

  pi.on("context", async (event) => {
    if (pendingKeys.size === 0) return;

    const parts: string[] = [];

    if (pendingKeys.has(RESPONSE_KEY)) {
      parts.push("You have given the same response multiple times in a row. Try searching the web or using context7 to find the correct solution instead.");
    }

    if (pendingKeys.has(TOOL_REPEAT_PREFIX)) {
      parts.push("You have executed the same command repeatedly. Your approach is not producing different results — try searching the web or using context7 to look up a correct solution.");
    }

    const fileRepeats = tracker.getRepeats();
    const fileDetails = fileRepeats
      .filter((r) => [...pendingKeys].some((k) => k.startsWith(`${r.toolName}:${r.path}`)))
      .map((r) => `${r.path} (${r.toolName} \u00d7${r.count})`)
      .join(", ");
    if (fileDetails) {
      parts.push(`The following files have been modified repeatedly: ${fileDetails}.`);
    }

    pendingKeys.clear();
    if (parts.length === 0) return;

    const messages = [...event.messages];
    messages.push({
      role: "user",
      content: `[loop-guard] ${parts.join(" ")} Use web search or context7 MCP to look up documentation and find the correct approach before continuing. If you've been reading the same file repeatedly, try searching GitHub for implementation examples instead.`,
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
