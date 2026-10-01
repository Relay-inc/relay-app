// ESLint for the frontend (src/): TypeScript, Lit's template rules, and Prettier owning the layout.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import lit from "eslint-plugin-lit";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "packages", "node_modules", "design", "scripts", "spike"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  lit.configs["flat/recommended"],
  prettier,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Tailwind's arbitrary variants ([&_code]:…) put a literal & in class attributes
      "lit/attribute-value-entities": "off",
    },
  },
);
