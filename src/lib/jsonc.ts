/**
 * Minimal JSONC (JSON-with-comments) utilities for surgically editing the
 * workspace config (`opencode.jsonc`) without rewriting the user's file.
 *
 * The marketplace adds/removes `plugins` array entries and
 * `mcp.servers.<name>` objects. These helpers locate value spans and rewrite
 * only what they touch — comments and formatting everywhere else stay
 * byte-identical. (Entries *inside* an edited value are re-serialized.)
 */

/** Read a JSON string literal for preview purposes; keeps escapes intact. */
function readString(text: string, i: number): { value: string; end: number } {
  let j = i + 1;
  let value = "";
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      value += c + (text[j + 1] ?? "");
      j += 2;
      continue;
    }
    if (c === '"') return { value, end: j + 1 };
    value += c;
    j++;
  }
  return { value, end: j };
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));
}

function skipWsAndComments(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    return i;
  }
}

/** Strip comments (string-aware). For parsing/preview only — never write this back. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const s = readString(text, i);
      out += text.slice(i, s.end);
      i = s.end;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Tolerant parse for reading config values (comments and trailing commas ok). */
export function parseLoose(text: string): any {
  const cleaned = stripComments(text).replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned);
}

/** Scan from `from` to the end of the value that starts there. */
function scanValueEnd(text: string, from: number): number {
  let i = from;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i = readString(text, i).end;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      if (depth === 0) break;
      depth--;
      i++;
      if (depth === 0) break; // value (object/array) fully closed
      continue;
    }
    if (c === "," && depth === 0) break;
    i++;
  }
  return i;
}

export interface KeySpan {
  /** First char of the value. */
  start: number;
  /** One past the last char of the value. */
  end: number;
  /** First char of the key's opening quote. */
  keyStart: number;
}

/** Char span of the value assigned to a top-level `"key"`, if present. */
export function findKeyValueSpan(text: string, key: string): KeySpan | null {
  let i = 0;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"') {
      const q = i;
      const s = readString(text, i);
      const j = skipWsAndComments(text, s.end);
      if (depth === 1 && text[j] === ":") {
        if (unescape(s.value) === key) {
          const start = skipWsAndComments(text, j + 1);
          return { start, end: scanValueEnd(text, start), keyStart: q };
        }
        i = j + 1;
        continue;
      }
      i = s.end;
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/** Read a top-level array's string entries (object entries expose `package`). */
export function readArrayEntries(text: string, key: string): string[] {
  const span = findKeyValueSpan(text, key);
  if (!span) return [];
  let arr: any;
  try {
    arr = parseLoose(text.slice(span.start, span.end));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((e) => (typeof e === "string" ? e : e && typeof e.package === "string" ? e.package : null))
    .filter((x): x is string => !!x);
}

function serializeEntries(entries: any[]): string {
  if (!entries.length) return "[]";
  return `[\n    ${entries.map((e) => JSON.stringify(e)).join(",\n    ")}\n  ]`;
}

/** Whitespace run between the previous newline and `pos` (the indent to mimic). */
function indentAt(text: string, pos: number): string {
  const nl = text.lastIndexOf("\n", pos - 1);
  const seg = text.slice(nl + 1, pos);
  return /^[ \t]*$/.test(seg) ? seg : "";
}

function reindent(raw: string, indent: string): string {
  if (!raw.includes("\n") || !indent) return raw;
  return raw
    .split("\n")
    .map((l, i) => (i === 0 || !l ? l : indent + l))
    .join("\n");
}

/** Insert a top-level key with an already-serialized value. */
function insertTopLevel(text: string, key: string, raw: string): string {
  if (!text.trim()) return `{\n  "${key}": ${reindent(raw, "  ")}\n}\n`;
  const at = skipWsAndComments(text, 0);
  if (text[at] !== "{") throw new Error("config root is not an object");
  const after = skipWsAndComments(text, at + 1);
  const indent = indentAt(text, after) || "  ";
  const entry = `"${key}": ${reindent(raw, indent)}`;
  if (text[after] === "}") {
    return text.slice(0, after) + "\n" + indent + entry + "\n" + text.slice(after);
  }
  return text.slice(0, after) + entry + ",\n" + indent + text.slice(after);
}

/** Insert or replace a top-level key's value. */
export function upsertValue(text: string, key: string, value: unknown): string {
  const raw = JSON.stringify(value, null, 2);
  const s = findKeyValueSpan(text, key);
  if (!s) return insertTopLevel(text, key, raw);
  return text.slice(0, s.start) + reindent(raw, indentAt(text, s.keyStart)) + text.slice(s.end);
}

/** Remove a top-level key (comma-aware, formatting-friendly). */
export function removeValue(text: string, key: string): string {
  const s = findKeyValueSpan(text, key);
  if (!s) return text;
  let k = s.keyStart - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  if (text[k] === ",") return text.slice(0, k) + text.slice(s.end);
  let end = s.end;
  let j = end;
  while (j < text.length && /\s/.test(text[j])) j++;
  if (text[j] === ",") {
    j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    end = j;
  }
  return text.slice(0, s.keyStart) + text.slice(end);
}

/** Add `value` to the string array at top-level `key` (idempotent). */
export function upsertArrayEntry(text: string, key: string, value: string): string {
  const span = findKeyValueSpan(text, key);
  if (!span) return upsertValue(text, key, [value]);
  let arr: any;
  try {
    arr = parseLoose(text.slice(span.start, span.end));
  } catch {
    throw new Error(`"${key}" is not valid JSON`);
  }
  if (!Array.isArray(arr)) throw new Error(`"${key}" must be an array`);
  if (readArrayEntries(text, key).includes(value)) return text;
  arr.push(value);
  return text.slice(0, span.start) + serializeEntries(arr) + text.slice(span.end);
}

/** Remove `value` from the string array at top-level `key` (no-op when absent). */
export function removeArrayEntry(text: string, key: string, value: string): string {
  const span = findKeyValueSpan(text, key);
  if (!span) return text;
  let arr: any;
  try {
    arr = parseLoose(text.slice(span.start, span.end));
  } catch {
    return text;
  }
  if (!Array.isArray(arr)) return text;
  const next = arr.filter((e) => {
    if (typeof e === "string") return e !== value;
    if (e && typeof e.package === "string") return e.package !== value;
    return true;
  });
  if (next.length === arr.length) return text;
  return text.slice(0, span.start) + serializeEntries(next) + text.slice(span.end);
}

/**
 * Insert or replace `key` inside the nested object at `path`
 * (creates missing intermediate objects). Used for `mcp.servers.<name>`.
 */
export function upsertDeep(text: string, path: string[], key: string, value: unknown): string {
  if (!path.length) return upsertValue(text, key, value);
  const [head, ...rest] = path;
  const s = findKeyValueSpan(text, head);
  if (!s) {
    let node: any = { [key]: value };
    for (let i = rest.length - 1; i >= 0; i--) node = { [rest[i]]: node };
    return upsertValue(text, head, node);
  }
  const inner = text.slice(s.start, s.end);
  if (!inner.trimStart().startsWith("{")) throw new Error(`"${head}" is not an object`);
  const next = upsertDeep(inner, rest, key, value);
  return text.slice(0, s.start) + next + text.slice(s.end);
}

/** Remove `key` from the nested object at `path` (no-op when absent). */
export function removeDeep(text: string, path: string[], key: string): string {
  if (!path.length) return removeValue(text, key);
  const [head, ...rest] = path;
  const s = findKeyValueSpan(text, head);
  if (!s) return text;
  const inner = text.slice(s.start, s.end);
  if (!inner.trimStart().startsWith("{")) return text;
  const next = removeDeep(inner, rest, key);
  if (next === inner) return text;
  return text.slice(0, s.start) + next + text.slice(s.end);
}
