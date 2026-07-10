import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Pi extension that detects:
 * 1. Repeated write/edit on the same file
 * 2. Repeated model responses (exact text match)
 * 3. Repeated tool calls with identical arguments (e.g. same bash/eval command)
 */
export default function (pi: ExtensionAPI): Promise<void>;
//# sourceMappingURL=index.d.ts.map