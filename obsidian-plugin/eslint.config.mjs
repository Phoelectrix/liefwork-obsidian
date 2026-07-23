import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended.map((c) => ({ ...c, rules: {} })), // parser wiring only
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    ignores: ["main.js", "node_modules/**", "test/**"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
