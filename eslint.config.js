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

const HTML_MESSAGE =
  "The UI builds elements through public/dom.js and textContent, never HTML strings. An HTML string here is a stored cross-site scripting hole.";

const CODE_MESSAGE =
  "The UI never evaluates source at runtime. Render what the API sent as text.";

const ATTRIBUTE_MESSAGE =
  "The UI sets attributes by name from a fixed list in public/dom.js. A computed name, or a name starting with 'on', is a hole the attribute allow-list cannot close.";

/** The names that parse a string as HTML, however they are reached. */
const HTML_LITERAL_NAMES = [
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "setHTMLUnsafe",
  "createContextualFragment",
];

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
        location: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "document",
          property: "innerHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "document",
          property: "outerHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "document",
          property: "insertAdjacentHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "document",
          property: "write",
          message: HTML_MESSAGE,
        },
        {
          object: "document",
          property: "writeln",
          message: HTML_MESSAGE,
        },
        {
          object: "globalThis",
          property: "innerHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "globalThis",
          property: "outerHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "globalThis",
          property: "insertAdjacentHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "window",
          property: "innerHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "window",
          property: "outerHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "window",
          property: "insertAdjacentHTML",
          message: HTML_MESSAGE,
        },
        {
          object: "window",
          property: "eval",
          message: CODE_MESSAGE,
        },
        {
          object: "globalThis",
          property: "eval",
          message: CODE_MESSAGE,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: HTML_MESSAGE,
        },
        {
          selector: "MemberExpression[property.name='outerHTML']",
          message: HTML_MESSAGE,
        },
        {
          selector: "MemberExpression[property.name='insertAdjacentHTML']",
          message: HTML_MESSAGE,
        },
        {
          selector: "MemberExpression[property.name='setHTMLUnsafe']",
          message: HTML_MESSAGE,
        },
        {
          selector:
            "MemberExpression[property.name='createContextualFragment']",
          message: HTML_MESSAGE,
        },
        ...HTML_LITERAL_NAMES.map((name) => ({
          selector: `Literal[value='${name}']`,
          message: HTML_MESSAGE,
        })),
        ...HTML_LITERAL_NAMES.map((name) => ({
          selector: `Property[key.name='${name}']`,
          message: HTML_MESSAGE,
        })),
        {
          selector:
            "CallExpression[callee.property.name='setAttribute']:not(:has(> Literal:first-child))",
          message: ATTRIBUTE_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.property.name='setAttribute'] > Literal:first-child[value=/^on/]",
          message: ATTRIBUTE_MESSAGE,
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: CODE_MESSAGE,
        },
        {
          selector: "CallExpression[callee.name='Function']",
          message: CODE_MESSAGE,
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: CODE_MESSAGE,
        },
      ],
    },
  },
);
