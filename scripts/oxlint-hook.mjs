#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const JS_TS_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.vue'
]);

function isJsTsFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  return JS_TS_EXTENSIONS.has(ext);
}

function runOxlint(args = []) {
  try {
    const isWin = process.platform === 'win32';
    const oxlintBin = path.resolve(
      process.cwd(),
      'node_modules',
      '.bin',
      isWin ? 'oxlint.cmd' : 'oxlint'
    );
    const useLocal = fs.existsSync(oxlintBin);
    const cmd = useLocal ? oxlintBin : (isWin ? 'npx.cmd' : 'npx');
    const finalArgs = useLocal ? args : ['-y', 'oxlint@latest', ...args];

    return {
      success: true,
      output: execFileSync(cmd, finalArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
        shell: isWin
      })
    };
  } catch (error) {
    return {
      success: false,
      output: (error.stdout || '') + (error.stderr || '') + (error.message || '')
    };
  }
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return null;
  }
  return new Promise((resolve) => {
    let data = '';
    const timeout = setTimeout(() => {
      resolve(data || null);
    }, 1000);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(data || null);
    });
    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function main() {
  const stdinRaw = await readStdin();
  let payload = null;

  if (stdinRaw && stdinRaw.trim()) {
    try {
      payload = JSON.parse(stdinRaw.trim());
    } catch {
      payload = null;
    }
  }

  // Handle Stop hook
  if (payload && payload.terminationReason) {
    const checkResult = runOxlint(['backend', 'frontend', 'shared']);
    if (checkResult.output && checkResult.output.includes('No files found to lint')) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return;
    }
    if (!checkResult.success && checkResult.output && checkResult.output.includes('error')) {
      const response = {
        decision: 'continue',
        reason: `[oxlint] Lint errors detected. Please fix before completing:\n${checkResult.output.slice(0, 500)}`
      };
      process.stdout.write(JSON.stringify(response));
      return;
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  // Handle PostToolUse or direct file targeting
  let targetFile = null;
  if (payload && payload.toolCall && payload.toolCall.args) {
    const args = payload.toolCall.args;
    targetFile = args.TargetFile || args.targetFile || args.filePath || args.path;
  }

  if (!targetFile && process.argv[2]) {
    targetFile = process.argv[2];
  }

  if (targetFile) {
    if (isJsTsFile(targetFile)) {
      const normalizedPath = path.normalize(targetFile);
      if (fs.existsSync(normalizedPath)) {
        runOxlint(['--fix', normalizedPath]);
        const checkResult = runOxlint([normalizedPath]);
        if (!checkResult.success || checkResult.output.trim().length > 0) {
          process.stderr.write(`\n[oxlint] Issues found in ${normalizedPath}:\n${checkResult.output}\n`);
        }
      }
    }
  } else {
    // Whole workspace check & fix
    runOxlint(['--fix']);
    const checkResult = runOxlint();
    if (!checkResult.success || checkResult.output.trim().length > 0) {
      process.stderr.write(`\n[oxlint] Workspace lint issues:\n${checkResult.output}\n`);
    }
  }

  // Standard PostToolUse output
  process.stdout.write('{}');
}

main().catch((err) => {
  process.stderr.write(`[oxlint-hook] Error: ${err.message}\n`);
  process.stdout.write('{}');
});
