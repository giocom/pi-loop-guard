export interface RepeatCheck {
  count: number;
  isRepeating: boolean;
}

export class FileOperationTracker {
  private readonly counts = new Map<string, number>();
  private readonly threshold: number;

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  private makeKey(path: string, toolName: string): string {
    return `${toolName}:${path}`;
  }

  record(path: string, toolName: string): RepeatCheck {
    const key = this.makeKey(path, toolName);
    const existing = this.counts.get(key) ?? 0;
    const nextCount = existing + 1;
    this.counts.set(key, nextCount);
    return { count: nextCount, isRepeating: nextCount >= this.threshold };
  }

  getRepeats(minThreshold?: number): Array<{ path: string; toolName: string; count: number }> {
    const min = minThreshold ?? this.threshold;
    const result: Array<{ path: string; toolName: string; count: number }> = [];
    for (const [key, count] of this.counts) {
      if (count >= min) {
        const sep = key.indexOf(":");
        result.push({ path: key.slice(sep + 1), toolName: key.slice(0, sep), count });
      }
    }
    return result;
  }

  reset(): void {
    this.counts.clear();
  }
}
