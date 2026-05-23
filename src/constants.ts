import type { Stage } from './types';

export const STAGES: Stage[] = ['Applied', 'Take-home', 'Interview', 'Offer', 'Rejected'];

export const STAGE_ICONS: Record<Stage, string> = {
  Applied: 'solar:paperclip-linear',
  'Take-home': 'solar:code-file-linear',
  Interview: 'solar:calendar-linear',
  Offer: 'solar:check-circle-linear',
  Rejected: 'solar:close-circle-linear',
};

export const WORK_MODES = ['Remote', 'Hybrid', 'On-site'] as const;
