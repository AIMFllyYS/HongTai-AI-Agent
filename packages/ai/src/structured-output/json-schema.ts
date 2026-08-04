import { z, type ZodType } from "zod";

export function toProviderJsonSchema(schema: ZodType): Readonly<Record<string, unknown>> {
  const result = { ...z.toJSONSchema(schema) } as Record<string, unknown>;
  delete result.$schema;
  return result;
}
