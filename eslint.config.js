import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Mechanical guarantee behind NF-13: Node built-ins are only allowed in apps/api/**.
const nodeBuiltinNames = [
  'fs',
  'path',
  'crypto',
  'process',
  'buffer',
  'os',
  'child_process',
  'net',
  'http',
  'https',
  'stream',
  'util',
];

const noNodeBuiltins = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: nodeBuiltinNames.map((name) => ({
          name,
          message: 'Node built-ins are only allowed in apps/api/** (NF-13).',
        })),
        patterns: [
          {
            group: ['node:*'],
            message: 'Node built-ins are only allowed in apps/api/** (NF-13).',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.wrangler/**', '**/*.d.ts', 'packages/db/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts', 'apps/worker/**/*.ts', 'apps/web/**/*.{ts,tsx}'],
    ...noNodeBuiltins,
  },
  {
    // The integration test harness shells out to the Prisma CLI to provision a scratch
    // database — Node-only dev/CI tooling, never shipped to a Worker, same rationale as
    // scripts/**.mjs below (NF-13 governs application code, not test/dev tooling).
    files: ['packages/db/test/**/*.ts', 'packages/api-core/test/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // Date-only values are UTC-midnight instants; formatting one in the browser's local zone
    // shows the previous day west of UTC. lib/dates.ts's formatDateOnly is the one sanctioned
    // way to display them.
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/dates.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString'][arguments.length<2]",
          message:
            'Use formatDateOnly() from lib/dates for date-only values (or pass an explicit timeZone option).',
        },
      ],
    },
  },
  {
    // Plain browser scripts served as-is from apps/web/public (e.g. the pre-paint theme script,
    // kept out of index.html so the CSP needs no 'unsafe-inline').
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly' },
    },
  },
  {
    // Root-level tooling scripts run under Node directly; they are exempt from NF-13
    // (which governs application code) and need Node globals recognised.
    files: ['scripts/**/*.mjs', '*.config.{js,ts,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
);
