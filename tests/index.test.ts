import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extensionFactory from "../src/index.js";

function createMockPi(): ExtensionAPI {
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    // Expose handlers so tests can fire events
    _handlers: handlers,
    _emit: async (event: string, ...args: unknown[]) => {
      const list = handlers.get(event) ?? [];
      for (const h of list) {
        const result = await h(...args);
        if (result !== undefined) return result;
      }
      return undefined;
    },
  } as unknown as ExtensionAPI;
}

describe("pi-loop-guard extension", () => {
  it("registers tool_result, context and session_shutdown handlers", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);
    expect(pi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("context", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it("appends reminder on 5th repeated write", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);

    const mockCtx = {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

    // 1st–4th write — no reminder
    for (let i = 0; i < 4; i++) {
      const r = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
        toolName: "write",
        input: { path: "/foo.ts" },
        content: [{ type: "text", text: "ok" }],
      }, mockCtx);
      expect(r).toBeUndefined();
    }

    // 5th write — reminder injected
    const r5 = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
      toolName: "write",
      input: { path: "/foo.ts" },
      content: [{ type: "text", text: "ok" }],
    }, mockCtx);
    expect(r5).toBeDefined();
    expect(r5.content[0].text).toContain("loop-guard");
    expect(r5.content[0].text).toContain("5 times in a row");
  });

  it("counts edit tools with identical content separately from different content", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);

    const mockCtx = {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

    // 5 identical edits → reminder at 5th
    for (let i = 0; i < 4; i++) {
      const r = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
        toolName: "edit",
        input: { filePath: "/foo.ts", oldString: "a", newString: "b" },
        content: [{ type: "text", text: "ok" }],
      }, mockCtx);
      expect(r).toBeUndefined();
    }
    const r5 = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
      toolName: "edit",
      input: { filePath: "/foo.ts", oldString: "a", newString: "b" },
      content: [{ type: "text", text: "ok" }],
    }, mockCtx);
    expect(r5).toBeDefined();
    expect(r5.content[0].text).toContain("loop-guard");
    expect(r5.content[0].text).toContain("5 times in a row");

    // Different content on same file → should NOT share the same counter
    // (5 edits with different old/new → no reminder)
    for (let i = 0; i < 4; i++) {
      const r = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
        toolName: "edit",
        input: { filePath: "/foo.ts", oldString: `v${i}`, newString: `v${i + 1}` },
        content: [{ type: "text", text: "ok" }],
      }, mockCtx);
      expect(r).toBeUndefined();
    }
    const r5diff = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
      toolName: "edit",
      input: { filePath: "/foo.ts", oldString: "v4", newString: "v5" },
      content: [{ type: "text", text: "ok" }],
    }, mockCtx);
    // Each different edit content is counted independently (1 each), so no threshold reached
    expect(r5diff).toBeUndefined();
  });

  it("does not inject reminder for read tool", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);
    const mockCtx = {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

    for (let i = 0; i < 3; i++) {
      const result = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
        toolName: "read",
        input: { path: "/foo.ts" },
        content: [{ type: "text", text: "content" }],
      }, mockCtx);
      expect(result).toBeUndefined();
    }
  });

  it("injects system message via context when repeats are pending", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);
    const mockCtx = {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

    // Trigger a repeat (threshold is 5)
    for (let i = 0; i < 5; i++) {
      await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
        toolName: "edit",
        input: { filePath: "/bar.ts", oldString: "a", newString: "b" },
        content: [{ type: "text", text: "ok" }],
      }, mockCtx);
    }

    const ctxResult = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("context", {
      messages: [{ role: "user", content: "hello" }],
    }, mockCtx);

    expect(ctxResult).toBeDefined();
    expect(ctxResult.messages).toHaveLength(2);
    expect(ctxResult.messages[1].role).toBe("user");
    expect(ctxResult.messages[1].content).toContain("loop-guard");
    expect(ctxResult.messages[1].content).toContain("/bar.ts");
  });

  it("does not inject system message when no pending repeats", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);
    const mockCtx = {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

    const ctxResult = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("context", {
      messages: [{ role: "user", content: "hello" }],
    }, mockCtx);

    expect(ctxResult).toBeUndefined();
  });

  it("clears state on session_shutdown", async () => {
    const pi = createMockPi();
    await extensionFactory(pi);
    const mockCtx = {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

    // Trigger repeat (threshold is 5)
    for (let i = 0; i < 5; i++) {
      await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("tool_result", {
        toolName: "write",
        input: { path: "/foo.ts" },
        content: [{ type: "text", text: "ok" }],
      }, mockCtx);
    }

    // Shutdown
    await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("session_shutdown", {}, mockCtx);

    // After shutdown, repeat should not be detected anymore
    const ctxResult = await (pi as unknown as { _emit: typeof createMockPi.prototype._emit })._emit("context", {
      messages: [{ role: "user", content: "hello" }],
    }, mockCtx);
    expect(ctxResult).toBeUndefined();
  });
});
