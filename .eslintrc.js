// إعدادات ESLint.
//
// المرحلة الأولى كانت تثبيت الأداة وتشغيلها لأول مرة مع قواعد متسامحة.
// المرحلة الثانية (هذا الملف): رفع القواعد التي نظّفنا متراكمها إلى error
// حتى لا تعود المشكلة من جديد، مع إبقاء no-explicit-any تحذيرًا لأنّ تصفيته
// تحتاج عملًا طويلًا على أنواع Prisma والمحولات.

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
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
    // يبقى تحذيرًا: التخلص من any مشروع قائم بذاته.
    "@typescript-eslint/no-explicit-any": "warn",

    // متراكمها صُفّي بالكامل — يصير خطأ لمنع الارتداد.
    "@typescript-eslint/no-unused-vars": [
      "error",
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

    // قواعد صحّة لا تقبل التفاوض في خادم يتعامل مع المال.
    eqeqeq: ["error", "smart"],
    "prefer-const": ["error", { destructuring: "all" }],
    "no-var": "error",
    "no-throw-literal": "error",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-constant-condition": ["error", { checkLoops: false }],
  },
  overrides: [
    {
      // مجرّبات الاختبار تعتمد عمدًا على any لأنّها تلامس Prisma Client المُولّد.
      files: ["**/*.spec.ts", "**/*.e2e-spec.ts", "test/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
