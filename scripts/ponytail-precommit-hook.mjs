#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Read stdin helper
async function readStdin() {
  if (process.stdin.isTTY) {
    return null;
  }
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data || null), 1000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data || null);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function isCommitOrPushCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  // Match git commit, git push, rtk git commit, rtk git push
  return /\b(?:rtk\s+)?git\s+(?:commit|push)\b/i.test(cmd);
}

function hasBypass(cmd) {
  if (!cmd) return false;
  if (cmd.includes('--no-verify')) return true;
  if (cmd.includes('PONYTAIL_REVIEWED=1') || cmd.includes('PONYTAIL_BYPASS=1')) return true;
  if (process.env.PONYTAIL_REVIEWED === '1' || process.env.PONYTAIL_BYPASS === '1') return true;
  return false;
}

function hasRecentMarker(workspaceRoot) {
  const markerPath = path.join(workspaceRoot, '.git', '.ponytail-reviewed');
  if (fs.existsSync(markerPath)) {
    try {
      const stat = fs.statSync(markerPath);
      // Valid if created within the last 15 minutes
      if (Date.now() - stat.mtimeMs < 15 * 60 * 1000) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function checkTranscriptForReview(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
  try {
    const stat = fs.statSync(transcriptPath);
    // Read up to last 64KB
    const readSize = Math.min(stat.size, 65536);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const tail = buffer.toString('utf8');

    // Review evidence patterns
    const patterns = [
      /ponytail-review/i,
      /Lean already\. Ship\./i,
      /\bL\d+:\s*(?:delete|stdlib|native|yagni|shrink)\b/i,
      /ACTIVE MODES:.*PONYTAIL/i
    ];

    return patterns.some((p) => p.test(tail));
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  // CLI Utility commands
  if (args.includes('--mark-reviewed')) {
    const marker = path.join(process.cwd(), '.git', '.ponytail-reviewed');
    fs.writeFileSync(marker, Date.now().toString(), 'utf8');
    process.stdout.write('[ponytail] Marked current changes as reviewed.\n');
    return;
  }

  if (args.includes('--git-hook')) {
    if (hasRecentMarker(process.cwd()) || process.env.PONYTAIL_REVIEWED === '1') {
      process.exit(0);
    }
    process.stderr.write('\n[ponytail-review] Note: ensure /ponytail-review was run on changes.\n');
    process.exit(0);
  }

  // PreToolUse Hook Handling
  const rawInput = await readStdin();
  let payload = null;
  if (rawInput && rawInput.trim()) {
    try {
      payload = JSON.parse(rawInput.trim());
    } catch {
      payload = null;
    }
  }

  const toolCall = payload?.toolCall;
  const cmd = toolCall?.args?.CommandLine || toolCall?.args?.commandLine || '';

  if (!isCommitOrPushCommand(cmd)) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  if (hasBypass(cmd)) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const workspaceRoot = payload?.workspacePaths?.[0] || process.cwd();
  if (hasRecentMarker(workspaceRoot)) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const transcriptPath = payload?.transcriptPath;
  if (transcriptPath && checkTranscriptForReview(transcriptPath)) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  // Block execution and require ponytail review
  const reason = '[Ponytail Review Gate] BLOCKED: You MUST run `/ponytail-review` on git diff before committing or pushing changes.\n' +
    'Inspect diff for over-engineering (dead code, reinvented stdlib, unrequested abstractions).\n' +
    'If changes are already minimal, conclude with "Lean already. Ship." before proceeding to commit/push.';

  process.stdout.write(JSON.stringify({
    decision: 'deny',
    reason
  }));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
});
