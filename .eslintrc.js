// إعدادات ESLint الأساسية.
// القواعد الأكثر ضجيجًا تبدأ كـ warn حتى لا تغرق المشاكل الحقيقية،
// وتُرفع إلى error في مرحلة لاحقة بعد تصفية المتراكم.

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    node: true,
    jest: true,
    es2022: true,
  },
  ignorePatterns: [
    "dist/",
    "node_modules/",
    "coverage/",
    "prisma/migrations/",
    "**/*.mjs",
    "**/*.js",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-empty-interface": "off",
    "@typescript-eslint/no-inferrable-types": "off",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-constant-condition": ["error", { checkLoops: false }],
  },
};
