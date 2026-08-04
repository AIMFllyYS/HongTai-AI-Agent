import assert from "node:assert/strict";
import test from "node:test";
import { TerminalAiStreamPrinter } from "../apps/cli/src/terminal-ai-stream-printer";

test("AI流式正文连续输出时只打印一次标签且不破坏JSON", () => {
  let output = "";
  const printer = new TerminalAiStreamPrinter((value) => { output += value; });
  printer.handle({ type: "content_delta", delta: "{\n  \"schema" });
  printer.handle({ type: "content_delta", delta: "Version\": \"v1\"\n}" });
  printer.handle({ type: "usage", promptTokens: 10, completionTokens: 5 });
  printer.handle({ type: "completed" });
  assert.equal(output, "[输出] {\n  \"schemaVersion\": \"v1\"\n}\n[用量] 输入=10，输出=5\n");
});

test("reasoning与正式正文切换时分行且保持独立", () => {
  let output = "";
  const printer = new TerminalAiStreamPrinter((value) => { output += value; });
  printer.handle({ type: "reasoning_delta", delta: "先检查" });
  printer.handle({ type: "reasoning_delta", delta: "图片" });
  printer.handle({ type: "content_delta", delta: "{\"ok\":true}" });
  printer.handle({ type: "completed" });
  assert.equal(output, "[思考] 先检查图片\n[输出] {\"ok\":true}\n");
});
