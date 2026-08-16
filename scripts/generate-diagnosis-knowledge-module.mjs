import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "packages/ai/src/knowledge/five-organs-observation.md");
const outputPath = resolve(repositoryRoot, "packages/ai/src/knowledge/five-organs-observation.generated.ts");
// 归一化为 LF，避免 Windows 检出（core.autocrlf）让注入 Prompt 的知识库随开发机变化。
const markdown = readFileSync(sourcePath, "utf8").replace(/\r\n/gu, "\n");
const output = `// Generated from five-organs-observation.md. Do not edit by hand.\nexport const FIVE_ORGANS_OBSERVATION_KNOWLEDGE = ${JSON.stringify(markdown)};\n`;

writeFileSync(outputPath, output, "utf8");
