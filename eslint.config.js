import js from "@eslint/js";
import tseslint from "typescript-eslint";

const LAYER_FILES = [
  "packages/*/src/domain/**/*.ts",
  "packages/*/src/application/**/*.ts",
];

const ADAPTER_MESSAGE =
  "This dependency belongs in an infrastructure adapter under src/infrastructure/.";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", ".yarn/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    rules: {
      "no-console": "error",
    },
  },
  {
    files: LAYER_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^node:", message: ADAPTER_MESSAGE },
            { regex: "^[^./]", message: ADAPTER_MESSAGE },
            { group: ["**/infrastructure/**"], message: ADAPTER_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/*/src/cli.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
