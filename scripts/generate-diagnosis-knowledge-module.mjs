import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "packages/ai/src/knowledge/five-organs-observation.md");
const outputPath = resolve(repositoryRoot, "packages/ai/src/knowledge/five-organs-observation.generated.ts");
const markdown = readFileSync(sourcePath, "utf8");
const output = `// Generated from five-organs-observation.md. Do not edit by hand.\nexport const FIVE_ORGANS_OBSERVATION_KNOWLEDGE = ${JSON.stringify(markdown)};\n`;

writeFileSync(outputPath, output, "utf8");
