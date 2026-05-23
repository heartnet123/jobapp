export type Stage = 'Applied' | 'Take-home' | 'Interview' | 'Offer' | 'Rejected';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedIn: string;
  notes: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string; // ISO String format
  type: 'creation' | 'stage_change' | 'field_edit' | 'checklist_toggle' | 'note_update' | 'contact_update';
  message: string;
}

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  date: string; // formatted date, e.g. "Nov 12"
  salary: string;
  location: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  url: string;
  notes: string;
  checklist: ChecklistItem[];
  reminderDate?: string; // YYYY-MM-DD
  contacts?: Contact[];
  history?: ActivityLogEntry[];
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  title: string;
  bio: string;
  resumeText?: string;
  resumeFileName?: string;
  resumeFile?: string; // base64 string
  updatedAt: string;
}
