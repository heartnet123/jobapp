# Workspace Rules

## Oxlint Code Quality Rule

Whenever you create or modify any JavaScript, TypeScript, or Vue files (`.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.mjs`, `.cjs`), you **MUST** run `oxlint` to maintain high code quality:

```bash
npx -y oxlint@latest
```

### Core Instructions:
1. **Always Verify After Edits**: Immediately after finishing any edit or creation of JS/TS/Vue code, run `npx -y oxlint@latest` (or `npx -y oxlint@latest --fix <filePath>` for auto-fixable issues).
2. **Fix All Reported Issues**: If oxlint reports any errors or warnings, inspect the diagnostic output, fix the code immediately, and re-run `npx -y oxlint@latest` to confirm clean results.
3. **Zero Outstanding Errors**: Never conclude a task or turn with unaddressed oxlint errors or regressions.

## Ponytail Review Gate Rule

Always run `/ponytail-review` on staged/unstaged changes before executing any `git commit` or `git push`.

### Core Instructions:
1. **Inspect Diff**: Review git diff strictly for over-engineering, dead code, reinvented standard library, and unnecessary abstractions.
2. **Review Output**: Format findings as `L<line>: <tag> <what to cut>. <replacement>`.
3. **Trim & Ship**: Cut or simplify before committing. Only proceed when verified: `Lean already. Ship.`
