import { describe, expect, it } from "vitest";
import { FileOperationTracker } from "../src/tracker.js";

describe("FileOperationTracker", () => {
  it("starts counting from 1 on first operation", () => {
    const tracker = new FileOperationTracker(3);
    const result = tracker.record("/foo.ts", "write");
    expect(result.count).toBe(1);
    expect(result.isRepeating).toBe(false);
  });

  it("does not flag repeat below threshold", () => {
    const tracker = new FileOperationTracker(3);
    tracker.record("/foo.ts", "write");
    tracker.record("/foo.ts", "write");
    const result = tracker.record("/foo.ts", "write");
    expect(result.count).toBe(3);
    expect(result.isRepeating).toBe(true);
  });

  it("tracks different files independently", () => {
    const tracker = new FileOperationTracker(3);
    tracker.record("/a.ts", "write");
    tracker.record("/b.ts", "write");
    tracker.record("/a.ts", "write");
    tracker.record("/b.ts", "write");
    const a = tracker.record("/a.ts", "write");
    const b = tracker.record("/b.ts", "write");
    expect(a.count).toBe(3);
    expect(a.isRepeating).toBe(true);
    expect(b.count).toBe(3);
    expect(b.isRepeating).toBe(true);
  });

  it("tracks different tools on the same file independently", () => {
    const tracker = new FileOperationTracker(3);
    tracker.record("/foo.ts", "write");
    tracker.record("/foo.ts", "write");
    tracker.record("/foo.ts", "edit");
    tracker.record("/foo.ts", "edit");
    const writeResult = tracker.record("/foo.ts", "write");
    const editResult = tracker.record("/foo.ts", "edit");
    expect(writeResult.count).toBe(3);
    expect(editResult.count).toBe(3);
  });

  it("getRepeats returns entries at or above threshold", () => {
    const tracker = new FileOperationTracker(3);
    tracker.record("/x.ts", "write");
    tracker.record("/x.ts", "write");
    tracker.record("/x.ts", "write");
    tracker.record("/y.ts", "write");
    expect(tracker.getRepeats()).toHaveLength(1);
    expect(tracker.getRepeats()[0]).toEqual({ path: "/x.ts", toolName: "write", count: 3 });
  });

  it("reset clears all state", () => {
    const tracker = new FileOperationTracker(3);
    tracker.record("/foo.ts", "write");
    tracker.record("/foo.ts", "write");
    tracker.record("/foo.ts", "write");
    tracker.reset();
    expect(tracker.getRepeats()).toHaveLength(0);
    const result = tracker.record("/foo.ts", "write");
    expect(result.count).toBe(1);
  });
});
