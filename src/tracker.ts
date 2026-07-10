/**
 * Tracks file operations to detect repeated writes/edits to the same file.
 */

export interface FileOperation {
  toolName: string;
  path: string;
  timestamp: number;
}

export interface RepeatEntry {
  count: number;
  operations: FileOperation[];
}

export interface RepeatCheck {
  count: number;
  isRepeating: boolean;
}

export class FileOperationTracker {
  private readonly operations = new Map<string, RepeatEntry>();
  private readonly threshold: number;

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  private makeKey(path: string, toolName: string): string {
    return `${toolName}:${path}`;
  }

  /**
   * Record a file operation and check if it has exceeded the repeat threshold.
   */
  record(path: string, toolName: string): RepeatCheck {
    const key = this.makeKey(path, toolName);
    const existing = this.operations.get(key);
    const now = Date.now();
    const operation: FileOperation = { toolName, path, timestamp: now };

    if (!existing) {
      this.operations.set(key, { count: 1, operations: [operation] });
      return { count: 1, isRepeating: false };
    }

    const nextCount = existing.count + 1;
    const next: RepeatEntry = {
      count: nextCount,
      operations: [...existing.operations, operation],
    };
    this.operations.set(key, next);

    return { count: nextCount, isRepeating: nextCount >= this.threshold };
  }

  /**
   * Get all file paths that have reached or exceeded the threshold.
   */
  getRepeats(minThreshold?: number): Array<{ path: string; toolName: string; count: number }> {
    const min = minThreshold ?? this.threshold;
    const result: Array<{ path: string; toolName: string; count: number }> = [];
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
  reset(): void {
    this.operations.clear();
  }
}
