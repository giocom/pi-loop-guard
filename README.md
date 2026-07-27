# pi-loop-guard

Pi extension that detects and warns about repeated file operations and tool calls that may indicate an agent is stuck in a loop.

## What It Detects

### 1. Repeated write/edit on the same file

When the agent writes or edits the same file 5+ times in a row, a warning is injected into the tool result and a system message is queued for the next turn.

For `edit` tools, only truly identical edits (same `filePath` + `oldString` + `newString`) are counted as repeats — different edits on the same file are tracked independently.

### 2. Repeated tool calls

When the same tool (bash, eval, etc.) is called with the same command 5+ times, a warning is raised.

### 3. Repeated responses

When the assistant outputs the same text multiple times in a row without any tool calls, the extension detects it as a stall.

## Warnings

- **Immediate**: After 5+ repeats, a `[loop-guard]` reminder is appended to the tool result text
- **Escalation**: Every 5 additional repeats (10, 15, 20...) trigger another reminder
- **Context injection**: On the next agent turn, a system message is injected via the `context` event telling the agent to pause and try a different approach

## Configuration

The repeat threshold is defined at compile time in `src/index.ts`:

```typescript
const REPEAT_THRESHOLD = 5;
```

## Install

```bash
pi install git:github.com/giocom/pi-loop-guard
```

Or run directly for testing:

```bash
pi -e ./dist/index.js
```

## Testing

```bash
npm test
```

## License

MIT
