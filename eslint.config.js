import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "workspace/**", "android/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/**/*.ts", "packages/platforms/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "fs/*", "child_process", "path", "os"],
              message: "共享核心和平台适配器不能依赖 Node.js；请通过 contracts 中的端口注入能力。"
            }
          ]
        }
      ]
    }
  }
);

