import js from "@eslint/js";
import tseslint from "typescript-eslint";

const LAYER_FILES = [
  "packages/*/src/domain/**/*.ts",
  "packages/*/src/application/**/*.ts",
];

const ADAPTER_MESSAGE =
  "This dependency belongs in an infrastructure adapter under src/infrastructure/.";

const KERNEL = "@hexagen-monaco/waves-contract";

const OTHER_PACKAGE_PATTERN = `^(?!${KERNEL}(/|$))[^./]`;

const PORT_MESSAGE =
  "Domain and application code takes dependencies through ports, never dynamic imports or require.";

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
            {
              regex: OTHER_PACKAGE_PATTERN,
              message: `${ADAPTER_MESSAGE} The one exception is the project's own kernel, ${KERNEL}.`,
            },
            { group: ["**/infrastructure/**"], message: ADAPTER_MESSAGE },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: PORT_MESSAGE },
        {
          selector: "CallExpression[callee.name='require']",
          message: PORT_MESSAGE,
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
  {
    files: ["packages/*/public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
      },
    },
  },
);
