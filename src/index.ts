import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const REPEAT_THRESHOLD = 3;

/**
 * Tracks file operations per path+toolName key.
 */
class FileOperationTracker {
  private readonly operations = new Map<string, { count: number }>();
  private readonly threshold: number;

  constructor(threshold: number) {
    this.threshold = threshold;
  }

  record(path: string, toolName: string): { count: number; isRepeating: boolean } {
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

  getRepeats(minThreshold?: number): Array<{ path: string; toolName: string; count: number }> {
    const min = minThreshold ?? this.threshold;
    const result: Array<{ path: string; toolName: string; count: number }> = [];
    for (const [key, entry] of this.operations) {
      if (entry.count >= min) {
        const sep = key.indexOf(":");
        result.push({ path: key.slice(sep + 1), toolName: key.slice(0, sep), count: entry.count });
      }
    }
    return result;
  }

  reset(): void {
    this.operations.clear();
  }
}

/**
 * Pi extension that detects repeated file write/edit operations and gently
 * nudges the model to self-correct instead of hard-blocking.
 */
export default async function (pi: ExtensionAPI): Promise<void> {
  const tracker = new FileOperationTracker(REPEAT_THRESHOLD);
  const pendingKeys = new Set<string>();
  const notifiedKeys = new Set<string>();

  const responseHistory: string[] = [];
  const RESPONSE_KEY = "__response_repeat__";

  pi.on("tool_result", async (event) => {
    const toolName = event.toolName;
    if (toolName !== "write" && toolName !== "edit") {
      return;
    }

    const input = event.input as Record<string, unknown>;
    const path = typeof input?.path === "string" ? input.path : undefined;
    if (!path) {
      return;
    }

    const result = tracker.record(path, toolName);
    const key = `${toolName}:${path}`;

    if (result.count === REPEAT_THRESHOLD && !notifiedKeys.has(key)) {
      pendingKeys.add(key);
      notifiedKeys.add(key);

      const reminder =
        `\n\n[loop-guard] This file has been ${toolName}d ${result.count} times in a row. ` +
        `Please verify the content is correct and consider whether this repetition is truly necessary before proceeding.`;

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
    if (pendingKeys.size === 0) {
      return;
    }

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
      content:
        `[loop-guard] ${parts.join(" ")} ` +
        `Please pause, review the current state, and take a different direction.`,
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
