import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FileOperationTracker } from "./tracker.js";

const REPEAT_THRESHOLD = 3;

/**
 * Pi extension that detects repeated file operations and same-model-response
 * loops, then nudges the model to self-correct.
 */
export default async function (pi: ExtensionAPI): Promise<void> {
  const tracker = new FileOperationTracker(REPEAT_THRESHOLD);
  const pendingKeys = new Set<string>();
  const notifiedKeys = new Set<string>();

  const responseHistory: string[] = [];
  const RESPONSE_KEY = "__response_repeat__";

  pi.on("tool_result", async (event) => {
    const toolName = event.toolName;
    if (toolName !== "write" && toolName !== "edit") return;

    const input = event.input as Record<string, unknown>;
    const path = typeof input?.path === "string" ? input.path : undefined;
    if (!path) return;

    const result = tracker.record(path, toolName);
    const key = `${toolName}:${path}`;

    // Notify on threshold-crossings: 3, 6, 9, 15, 21… (multiples of threshold)
    const isEscalation =
      result.count >= REPEAT_THRESHOLD &&
      (result.count % REPEAT_THRESHOLD === 0 || result.count === REPEAT_THRESHOLD);
    const escalationKey = `${key}@${result.count}`;

    if (isEscalation && !notifiedKeys.has(escalationKey)) {
      pendingKeys.add(key);
      notifiedKeys.add(escalationKey);

      const reminder =
        result.count === REPEAT_THRESHOLD
          ? `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times in a row. Please verify the content is correct and consider whether this repetition is truly necessary before proceeding.`
          : `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times now. The earlier warning may have been missed. Please verify you are not stuck and consider a different approach.`;

      const content = [...event.content];
      const last = content.at(-1);
      if (
        last &&
        typeof last === "object" &&
        last !== null &&
        "type" in last &&
        (last as { type: unknown }).type === "text" &&
        "text" in last
      ) {
        (last as { text: string }).text += reminder;
      } else {
        content.push({ type: "text", text: reminder });
      }
      return { content };
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

    const toolResults = event.toolResults as Array<unknown> | undefined;
    if (toolResults && toolResults.length > 0) {
      responseHistory.length = 0;
      return;
    }

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
      parts.push("You have given the same response multiple times in a row. Please change your approach or ask for clarification instead of repeating yourself.");
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
    if (parts.length === 0) return;

    const messages = [...event.messages];
    messages.push({
      role: "user",
      content: `[loop-guard] ${parts.join(" ")} Please pause, review the current state, and take a different direction.`,
      timestamp: Date.now(),
    });
    return { messages };
  });

  pi.on("session_shutdown", () => {
    tracker.reset();
    pendingKeys.clear();
    notifiedKeys.clear();
    responseHistory.length = 0;
  });
}
