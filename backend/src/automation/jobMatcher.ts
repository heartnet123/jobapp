import type { JobApplication } from '@jobapp/shared';

export interface JobMatch {
  application: JobApplication;
  score: number;
  reasons: string[];
}

function normalizeText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesEither(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export function findBestJobMatches(
  applications: JobApplication[],
  input: { company?: string; role?: string; senderDomain?: string; subject?: string }
): JobMatch[] {
  const company = normalizeText(input.company);
  const role = normalizeText(input.role);
  const senderDomain = normalizeText(input.senderDomain);
  const subject = normalizeText(input.subject);

  return applications
    .map((application) => {
      const appCompany = normalizeText(application.company);
      const appRole = normalizeText(application.role);
      const appUrl = normalizeText(application.url);
      const reasons: string[] = [];
      let score = 0;

      if (company && appCompany === company) {
        score += 45;
        reasons.push('company exact');
      } else if (includesEither(appCompany, company)) {
        score += 30;
        reasons.push('company partial');
      }

      if (role && appRole === role) {
        score += 45;
        reasons.push('role exact');
      } else if (includesEither(appRole, role)) {
        score += 30;
        reasons.push('role partial');
      } else if (subject && includesEither(subject, appRole)) {
        score += 20;
        reasons.push('role in subject');
      }

      if (senderDomain && appUrl && appUrl.includes(senderDomain.split(' ')[0])) {
        score += 10;
        reasons.push('sender domain matches url');
      }

      return { application, score, reasons };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function getConfidentSingleMatch(matches: JobMatch[], minimumScore = 70): JobMatch | null {
  if (matches.length === 0) return null;
  const [top, second] = matches;
  if (top.score < minimumScore) return null;
  if (second && top.score - second.score < 15) return null;
  return top;
}
