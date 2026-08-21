export type MarkdownInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "br" }
  | { readonly type: "strong"; readonly children: readonly MarkdownInline[] }
  | { readonly type: "em"; readonly children: readonly MarkdownInline[] }
  | { readonly type: "code"; readonly value: string };

export type MarkdownBlock =
  | { readonly type: "p"; readonly children: readonly MarkdownInline[] }
  | { readonly type: "h"; readonly level: 1 | 2 | 3; readonly children: readonly MarkdownInline[] }
  | { readonly type: "ul"; readonly items: readonly (readonly MarkdownInline[])[] }
  | { readonly type: "ol"; readonly items: readonly (readonly MarkdownInline[])[] }
  | { readonly type: "pre"; readonly value: string };

function nextInlineMarker(source: string, from: number): number {
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === "`" || char === "*") return index;
  }
  return source.length;
}

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === "`") {
      const end = source.indexOf("`", index + 1);
      if (end > index) {
        nodes.push({ type: "code", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (source.startsWith("**", index)) {
      const end = source.indexOf("**", index + 2);
      if (end > index + 2) {
        nodes.push({ type: "strong", children: parseMarkdownInline(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }
    if (source[index] === "*" && source[index + 1] !== "*") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "`") {
          const codeEnd = source.indexOf("`", end + 1);
          end = codeEnd === -1 ? source.length : codeEnd + 1;
          continue;
        }
        if (source[end] === "*" && source[end + 1] !== "*") break;
        if (source.startsWith("**", end)) {
          const strongEnd = source.indexOf("**", end + 2);
          end = strongEnd === -1 ? source.length : strongEnd + 2;
          continue;
        }
        end += 1;
      }
      if (end < source.length && end > index + 1) {
        nodes.push({ type: "em", children: parseMarkdownInline(source.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }
    const next = nextInlineMarker(source, index + 1);
    const value = source.slice(index, next);
    if (value) nodes.push({ type: "text", value });
    index = next;
  }
  return nodes;
}

function headingLevel(line: string): 1 | 2 | 3 | undefined {
  if (line.startsWith("### ")) return 3;
  if (line.startsWith("## ")) return 2;
  if (line.startsWith("# ")) return 1;
  return undefined;
}

function unorderedItem(line: string): string | undefined {
  const match = /^(?:[-*+])\s+(.*)$/u.exec(line);
  return match?.[1];
}

function orderedItem(line: string): string | undefined {
  const match = /^\d+[.)]\s+(.*)$/u.exec(line);
  return match?.[1];
}

function paragraphChildren(lines: readonly string[]): MarkdownInline[] {
  const children: MarkdownInline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) children.push({ type: "br" });
    children.push(...parseMarkdownInline(line));
  });
  return children;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "pre", value: body.join("\n") });
      continue;
    }
    const heading = headingLevel(line);
    if (heading) {
      blocks.push({ type: "h", level: heading, children: parseMarkdownInline(line.slice(heading + 1)) });
      index += 1;
      continue;
    }
    const bullet = unorderedItem(line);
    if (bullet !== undefined) {
      const items: MarkdownInline[][] = [parseMarkdownInline(bullet)];
      index += 1;
      while (index < lines.length) {
        const next = unorderedItem(lines[index] ?? "");
        if (next === undefined) break;
        items.push(parseMarkdownInline(next));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const numbered = orderedItem(line);
    if (numbered !== undefined) {
      const items: MarkdownInline[][] = [parseMarkdownInline(numbered)];
      index += 1;
      while (index < lines.length) {
        const next = orderedItem(lines[index] ?? "");
        if (next === undefined) break;
        items.push(parseMarkdownInline(next));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!next.trim() || next.startsWith("```") || headingLevel(next) || unorderedItem(next) !== undefined || orderedItem(next) !== undefined) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "p", children: paragraphChildren(paragraph) });
  }
  return blocks;
}
