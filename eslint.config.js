// ESLint for the frontend (src/): TypeScript, React's hooks rules (and the React Compiler's), Prettier owning the layout,
// and the layer boundaries of docs/frontend-architecture.md: imports only point down ui → application → domain,
// application → infrastructure, everything → shared.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

const layer = name => [`**/${name}`, `**/${name}/**`];
const REACT = ["react", "react/*", "react-dom", "react-dom/*"];
const STATE = ["zustand", "zustand/*", "immer"];
const TAURI = ["@tauri-apps/*"];
// a dynamic import() would pass every boundary above: the app has no use for one
const NO_DYNAMIC_IMPORT = {
  selector: "ImportExpression",
  message: "No dynamic import(): import statically, so the layer rules see it.",
};
/** The imports a layer may not make; `types` are allowed as `import type` only (domain types for the infrastructure). */
const boundary = (files, message, forbidden, types = []) => ({
  files,
  ignores: ["src/**/*.test.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: forbidden, message },
          ...(types.length ? [{ group: types, message, allowTypeImports: true }] : []),
        ],
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "packages", "node_modules", "design", "scripts", "spike"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  prettier,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": ["error", NO_DYNAMIC_IMPORT],
    },
  },
  boundary(
    ["src/shared/**"],
    "shared imports nothing above it: no domain, application, infrastructure, ui, React, stores or Tauri.",
    [
      ...layer("domain"),
      ...layer("application"),
      ...layer("infrastructure"),
      ...layer("ui"),
      ...REACT,
      ...STATE,
      ...TAURI,
    ],
  ),
  boundary(
    ["src/domain/**"],
    "domain is pure: only domain and shared, no React, stores, Tauri or i18n calls (take a translation as an argument).",
    [...layer("application"), ...layer("infrastructure"), ...layer("ui"), ...REACT, ...STATE, ...TAURI],
    ["**/shared/i18n", "**/shared/i18n.ts"],
  ),
  boundary(
    ["src/infrastructure/**"],
    "infrastructure imports only domain types and shared.",
    [...layer("application"), ...layer("ui"), ...REACT, ...STATE],
    layer("domain"),
  ),
  boundary(
    ["src/application/**"],
    "application holds the stores and use cases: no ui, no React, no Tauri (that is infrastructure's).",
    [...layer("ui"), ...REACT, ...TAURI],
  ),
  boundary(
    ["src/ui/**"],
    "ui never talks to the outside itself: call a use case in application/ (no infrastructure, no Tauri).",
    [...layer("infrastructure"), ...TAURI],
  ),
  {
    files: ["src/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        NO_DYNAMIC_IMPORT,
        {
          selector: "MemberExpression[property.name='setState']",
          message: "Components never write a store: call a use case in application/.",
        },
      ],
    },
  },
);
