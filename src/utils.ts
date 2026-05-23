import type { Stage, JobApplication, ActivityLogEntry } from './types';

/**
 * Returns today's date string in YYYY-MM-DD format using the local timezone.
 */
export function getTodayString(): string {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzoffset).toISOString().split('T')[0];
}

/**
 * Determines if a reminder date is due (today or in the past).
 */
export function isReminderDue(appOrReminderDate?: string | { reminderDate?: string }): boolean {
  if (!appOrReminderDate) return false;
  const dateStr = typeof appOrReminderDate === 'string' ? appOrReminderDate : appOrReminderDate.reminderDate;
  if (!dateStr) return false;
  return dateStr <= getTodayString();
}

/**
 * Normalizes a Stage name to a lowercase class name suffix (e.g. "Take-home" -> "takehome").
 */
export function stageClass(stage: Stage): string {
  return stage.toLowerCase().replace(/\s+/g, '-').replace('-home', 'home');
}

/**
 * Returns a human-readable relative time string (e.g. "just now", "5m ago", "2h ago", "yesterday", "3d ago", "Nov 12").
 */
export function formatRelativeTime(dateInput: string | Date | number): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  if (isNaN(date.getTime())) return '';
  
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 10) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Compares two versions of an application and generates activity log entries for all detected changes.
 */
export function detectChangesAndGenerateLogs(oldApp: JobApplication, newApp: JobApplication): ActivityLogEntry[] {
  const logs: ActivityLogEntry[] = [];
  const timestamp = new Date().toISOString();
  const randSuffix = () => Math.floor(Math.random() * 10000);

  // 1. Stage change
  if (oldApp.stage !== newApp.stage) {
    logs.push({
      id: `log-${Date.now()}-stage-${randSuffix()}`,
      timestamp,
      type: 'stage_change',
      message: `Stage moved from ${oldApp.stage} → ${newApp.stage}`
    });
  }

  // 2. Notes update
  if ((oldApp.notes || '') !== (newApp.notes || '')) {
    const oldNotesExist = !!oldApp.notes?.trim();
    const newNotesExist = !!newApp.notes?.trim();
    let message = 'Notes updated';
    if (!oldNotesExist && newNotesExist) {
      message = 'Note added';
    } else if (oldNotesExist && !newNotesExist) {
      message = 'Note removed';
    }
    logs.push({
      id: `log-${Date.now()}-notes-${randSuffix()}`,
      timestamp,
      type: 'note_update',
      message
    });
  }

  // 3. Field edits
  const fieldsToCompare: Array<{ key: keyof JobApplication; label: string; isUrl?: boolean; isDate?: boolean }> = [
    { key: 'company', label: 'Company name' },
    { key: 'role', label: 'Job title' },
    { key: 'location', label: 'Location' },
    { key: 'salary', label: 'Estimated salary' },
    { key: 'workMode', label: 'Work mode' },
    { key: 'url', label: 'Job posting URL', isUrl: true },
    { key: 'date', label: 'Applied date', isDate: true },
    { key: 'reminderDate', label: 'Follow-up reminder' }
  ];

  fieldsToCompare.forEach(({ key, label, isUrl, isDate }) => {
    const oldVal = oldApp[key];
    const newVal = newApp[key];

    if (oldVal !== newVal) {
      let message = '';
      if (!oldVal && newVal) {
        if (isUrl) {
          message = `${label} added`;
        } else {
          message = `${label} set to "${newVal}"`;
        }
      } else if (oldVal && !newVal) {
        message = `${label} cleared`;
      } else {
        if (isUrl) {
          message = `${label} updated`;
        } else {
          message = `${label} updated to "${newVal}"`;
        }
      }

      logs.push({
        id: `log-${Date.now()}-${key}-${randSuffix()}`,
        timestamp,
        type: 'field_edit',
        message
      });
    }
  });

  // 4. Checklist updates
  const oldChecklist = oldApp.checklist || [];
  const newChecklist = newApp.checklist || [];

  // Completed or toggled items
  oldChecklist.forEach(oldItem => {
    const newItem = newChecklist.find(i => i.id === oldItem.id);
    if (newItem && oldItem.done !== newItem.done) {
      logs.push({
        id: `log-${Date.now()}-checklist-toggle-${oldItem.id}-${randSuffix()}`,
        timestamp,
        type: 'checklist_toggle',
        message: newItem.done 
          ? `Task completed: "${newItem.text}"` 
          : `Task marked incomplete: "${newItem.text}"`
      });
    }
  });

  // Added checklist items
  newChecklist.forEach(newItem => {
    const exists = oldChecklist.some(i => i.id === newItem.id);
    if (!exists) {
      logs.push({
        id: `log-${Date.now()}-checklist-add-${newItem.id}-${randSuffix()}`,
        timestamp,
        type: 'checklist_toggle',
        message: `Task added: "${newItem.text}"`
      });
    }
  });

  // Removed checklist items
  oldChecklist.forEach(oldItem => {
    const exists = newChecklist.some(i => i.id === oldItem.id);
    if (!exists) {
      logs.push({
        id: `log-${Date.now()}-checklist-remove-${oldItem.id}-${randSuffix()}`,
        timestamp,
        type: 'checklist_toggle',
        message: `Task removed: "${oldItem.text}"`
      });
    }
  });

  // 5. Contacts updates
  const oldContacts = oldApp.contacts || [];
  const newContacts = newApp.contacts || [];

  // Added contacts
  newContacts.forEach(newC => {
    const exists = oldContacts.some(c => c.id === newC.id);
    if (!exists) {
      const contactInfo = newC.role ? `${newC.name} (${newC.role})` : newC.name;
      logs.push({
        id: `log-${Date.now()}-contact-add-${newC.id}-${randSuffix()}`,
        timestamp,
        type: 'contact_update',
        message: `Contact added: ${contactInfo}`
      });
    }
  });

  // Removed contacts
  oldContacts.forEach(oldC => {
    const exists = newContacts.some(c => c.id === oldC.id);
    if (!exists) {
      logs.push({
        id: `log-${Date.now()}-contact-remove-${oldC.id}-${randSuffix()}`,
        timestamp,
        type: 'contact_update',
        message: `Contact removed: ${oldC.name || oldC.role || 'Unnamed Contact'}`
      });
    }
  });

  // Updated contacts
  newContacts.forEach(newC => {
    const oldC = oldContacts.find(c => c.id === newC.id);
    if (oldC) {
      if (
        oldC.name !== newC.name ||
        oldC.role !== newC.role ||
        oldC.email !== newC.email ||
        oldC.phone !== newC.phone ||
        oldC.linkedIn !== newC.linkedIn ||
        oldC.notes !== newC.notes
      ) {
        logs.push({
          id: `log-${Date.now()}-contact-edit-${newC.id}-${randSuffix()}`,
          timestamp,
          type: 'contact_update',
          message: `Contact updated: ${newC.name || newC.role || 'Unnamed Contact'}`
        });
      }
    }
  });

  return logs;
}

