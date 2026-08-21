import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from "./markdown-text";

function renderInline(nodes: readonly MarkdownInline[], keyPrefix: string): ReactNode {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") return <Fragment key={key}>{node.value}</Fragment>;
    if (node.type === "br") return <br key={key} />;
    if (node.type === "code") return <code key={key}>{node.value}</code>;
    if (node.type === "strong") return <strong key={key}>{renderInline(node.children, key)}</strong>;
    return <em key={key}>{renderInline(node.children, key)}</em>;
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `md-${index}`;
  if (block.type === "p") return <p key={key}>{renderInline(block.children, key)}</p>;
  if (block.type === "h") {
    const Tag = `h${block.level}` as const;
    return <Tag key={key}>{renderInline(block.children, key)}</Tag>;
  }
  if (block.type === "pre") return <pre key={key}><code>{block.value}</code></pre>;
  const Tag = block.type === "ul" ? "ul" : "ol";
  return (
    <Tag key={key}>
      {block.items.map((item, itemIndex) => (
        <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
      ))}
    </Tag>
  );
}

export function MarkdownText({ value }: { readonly value: string }) {
  const blocks = parseMarkdown(value);
  if (!blocks.length) return <p>{value}</p>;
  return <>{blocks.map(renderBlock)}</>;
}
