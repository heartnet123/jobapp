const JOB_POSITIVE_SIGNALS = [
  'สมัครงาน',
  'ยื่นสมัครงาน',
  'ใบสมัคร',
  'ตำแหน่ง',
  'ขอบคุณที่สมัคร',
  'application',
  'applied',
  'applying',
  'candidate',
  'job',
  'position',
  'role',
  'recruit',
  'talent',
  'career',
  'interview',
  'assessment',
  'take-home',
  'take home',
  'offer',
];

const JOB_STATUS_SIGNALS = [
  'ปฏิเสธ',
  'ไม่ผ่าน',
  'หมดอายุ',
  'ปิดรับสมัคร',
  'closed',
  'expired',
  'unfortunately',
  'not selected',
  'moving forward',
  'proceed',
  'next step',
];

const STRONG_SENDER_HINTS = ['greenhouse', 'lever', 'workday', 'ashby', 'smartrecruiters', 'jobs', 'careers', 'recruit'];

export function isLikelyJobEmail(input: {
  subject: string;
  sender: string;
  snippet: string;
  bodyText?: string;
}): boolean {
  const combined = `${input.subject} ${input.sender} ${input.snippet} ${input.bodyText || ''}`.toLowerCase();
  const hasPositiveSignal = JOB_POSITIVE_SIGNALS.some((signal) => combined.includes(signal.toLowerCase()));
  const hasStatusSignal = JOB_STATUS_SIGNALS.some((signal) => combined.includes(signal.toLowerCase()));
  const hasSenderHint = STRONG_SENDER_HINTS.some((signal) => input.sender.toLowerCase().includes(signal));
  return hasPositiveSignal || hasStatusSignal || hasSenderHint;
}
