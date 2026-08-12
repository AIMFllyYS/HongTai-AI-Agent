interface StructuredStreamHighlight {
  readonly label: string;
  readonly value: string;
}

interface StructuredStreamProgress {
  readonly flow: "content-analysis" | "diagnosis-report";
  readonly phase: "receiving" | "validating" | "repairing";
  readonly receivedCharacters: number;
  readonly sections: readonly string[];
  readonly highlights: readonly StructuredStreamHighlight[];
}

type PreviewKind = "content-analysis" | "diagnosis-report";

const SECTION_LABELS: Readonly<Record<PreviewKind, readonly (readonly [key: string, label: string])[]>> = {
  "content-analysis": [
    ["source", "来源核对"],
    ["overview", "内容概览"],
    ["hook", "开场机制"],
    ["painPoints", "痛点"],
    ["emotionalDrivers", "情绪驱动"],
    ["structure", "内容结构"],
    ["coreClaims", "核心主张"],
    ["style", "表达风格"],
    ["reusableTemplate", "复用模板"],
    ["risks", "风险提示"],
  ],
  "diagnosis-report": [
    ["imageQuality", "图片质量"],
    ["summary", "观察摘要"],
    ["observations", "可见观察"],
    ["wellnessReferences", "日常参考"],
    ["recommendations", "日常建议"],
    ["safetyGuidance", "安全提醒"],
    ["followUpQuestions", "后续问题"],
    ["limitations", "局限说明"],
    ["disclaimer", "免责声明"],
  ],
};

const MAX_BUFFER_CHARACTERS = 48_000;

/**
 * Converts provider content deltas into a deliberately small UI DTO. The
 * buffer stays in-memory for the active request only; it is never written to
 * a task/session file and never includes provider reasoning.
 */
export class StructuredStreamPreview {
  readonly #kind: PreviewKind;
  #buffer = "";
  #receivedCharacters = 0;
  #phase: StructuredStreamProgress["phase"] = "receiving";
  #providerCompleted = false;

  constructor(kind: PreviewKind) {
    this.#kind = kind;
  }

  append(delta: string): StructuredStreamProgress {
    if (this.#providerCompleted) {
      this.#phase = "repairing";
      this.#buffer = "";
      this.#providerCompleted = false;
    }
    this.#receivedCharacters += delta.length;
    this.#buffer = `${this.#buffer}${delta}`.slice(-MAX_BUFFER_CHARACTERS);
    return this.snapshot();
  }

  completeProviderResponse(): StructuredStreamProgress {
    this.#providerCompleted = true;
    this.#phase = "validating";
    return this.snapshot();
  }

  snapshot(): StructuredStreamProgress {
    const sections = SECTION_LABELS[this.#kind]
      .filter(([key]) => new RegExp(`\\"${key}\\"\\s*:`).test(this.#buffer))
      .map(([, label]) => label);
    return {
      flow: this.#kind,
      phase: this.#phase,
      receivedCharacters: this.#receivedCharacters,
      sections,
      highlights: this.#kind === "content-analysis" ? contentHighlights(this.#buffer) : [],
    };
  }
}

function contentHighlights(buffer: string): readonly StructuredStreamHighlight[] {
  const candidates: readonly (readonly [anchor: string, key: string, label: string])[] = [
    ["overview", "summary", "内容概览"],
    ["hook", "description", "开场拆解"],
    ["reusableTemplate", "formula", "复用公式"],
  ];
  return candidates.flatMap(([anchor, key, label]) => {
    const value = completeJsonStringAfter(buffer, anchor, key);
    return value ? [{ label, value }] : [];
  });
}

function completeJsonStringAfter(buffer: string, anchor: string, key: string): string | undefined {
  const start = buffer.indexOf(`"${anchor}"`);
  if (start < 0) return undefined;
  const source = buffer.slice(start);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "u").exec(source);
  if (!match?.[1]) return undefined;
  try {
    const value = JSON.parse(`"${match[1]}"`);
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 180) : undefined;
  } catch {
    return undefined;
  }
}
