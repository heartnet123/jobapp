<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import type { JobApplication, Stage, ChecklistItem, Contact } from '../types';
import { STAGES as stages, WORK_MODES as workModes } from '../constants';
import { getTodayString, formatRelativeTime } from '../utils';

const props = defineProps<{
  isOpen: boolean;
  application: JobApplication | null; // Null means "Create" mode, non-null means "Edit" mode
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', app: JobApplication): void;
  (e: 'delete', id: string): void;
}>();

const todayMinDate = computed(getTodayString);

const drawerPanel = ref<HTMLElement | null>(null);
const isConfirmOpen = ref(false);
const validationErrors = ref<{ company?: string; role?: string; url?: string }>({});

const form = ref<Omit<JobApplication, 'id'> & { reminderDate: string; contacts: Contact[] }>({
  company: '',
  role: '',
  stage: 'Applied',
  date: '',
  salary: '',
  location: '',
  workMode: 'Remote',
  url: '',
  notes: '',
  checklist: [],
  reminderDate: '',
  contacts: [],
});

const newTodoText = ref('');

// Global keydown event for Escape dismissal and Tab focus trapping
function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (isConfirmOpen.value) {
      isConfirmOpen.value = false;
    } else {
      emit('close');
    }
    return;
  }

  if (e.key === 'Tab') {
    if (!drawerPanel.value) return;
    
    // Find all focusable elements inside the drawer (excluding the hidden inputs and inactive overlay elements)
    const focusables = drawerPanel.value.querySelectorAll(
      'input:not([disabled]):not([type="checkbox"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [role="radio"]'
    );
    
    // Include visible custom checkbox label focus targets if needed or keep it basic
    const items = Array.from(focusables) as HTMLElement[];
    if (items.length === 0) return;
    
    const first = items[0];
    const last = items[items.length - 1];
    
    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }
}

// Synchronize form with application prop and manage focus listeners
watch(
  () => props.isOpen,
  (open) => {
    validationErrors.value = {};
    if (open) {
      document.addEventListener('keydown', handleGlobalKeydown);

      // Reset form depending on mode
      if (props.application) {
        form.value = {
          company: props.application.company,
          role: props.application.role,
          stage: props.application.stage,
          date: props.application.date,
          salary: props.application.salary,
          location: props.application.location,
          workMode: props.application.workMode,
          url: props.application.url,
          notes: props.application.notes,
          checklist: [...props.application.checklist.map(item => ({ ...item }))],
          reminderDate: props.application.reminderDate || '',
          contacts: props.application.contacts ? [...props.application.contacts.map(c => ({ ...c }))] : [],
        };
      } else {
        form.value = {
          company: '',
          role: '',
          stage: 'Applied',
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
          salary: '',
          location: '',
          workMode: 'Remote',
          url: '',
          notes: '',
          checklist: [],
          reminderDate: '',
          contacts: [],
        };
      }

      // Reset sub-form expanded states and contact forms
      isContactsExpanded.value = false;
      isHistoryExpanded.value = false;
      isAddingContact.value = false;
      isEditingContact.value = false;
      editingContactId.value = null;
      contactValidationError.value = '';
      contactForm.value = {
        name: '',
        role: '',
        email: '',
        phone: '',
        linkedIn: '',
        notes: '',
      };
      newTodoText.value = '';

      setTimeout(() => {
        const input = drawerPanel.value?.querySelector('#company') as HTMLElement | null;
        input?.focus();
      }, 100);
    } else {
      document.removeEventListener('keydown', handleGlobalKeydown);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
});

const isContactsExpanded = ref(false);
const isHistoryExpanded = ref(false);
const isAddingContact = ref(false);
const isEditingContact = ref(false);

const contactForm = ref<Omit<Contact, 'id'>>({
  name: '',
  role: '',
  email: '',
  phone: '',
  linkedIn: '',
  notes: '',
});

const editingContactId = ref<string | null>(null);
const contactValidationError = ref('');

function startAddContact() {
  isAddingContact.value = true;
  isEditingContact.value = false;
  contactValidationError.value = '';
  contactForm.value = {
    name: '',
    role: '',
    email: '',
    phone: '',
    linkedIn: '',
    notes: '',
  };
}

function startEditContact(contact: Contact) {
  isEditingContact.value = true;
  isAddingContact.value = false;
  editingContactId.value = contact.id;
  contactValidationError.value = '';
  contactForm.value = {
    name: contact.name,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
    linkedIn: contact.linkedIn,
    notes: contact.notes,
  };
}

function cancelContactForm() {
  isAddingContact.value = false;
  isEditingContact.value = false;
  editingContactId.value = null;
  contactValidationError.value = '';
}

function saveContact() {
  contactValidationError.value = '';
  const name = contactForm.value.name.trim();
  const role = contactForm.value.role.trim();
  const email = contactForm.value.email.trim();
  const phone = contactForm.value.phone.trim();
  const linkedIn = contactForm.value.linkedIn.trim();
  const notes = contactForm.value.notes.trim();

  // Basic validation: must have name or role
  if (!name && !role) {
    contactValidationError.value = 'Please provide a Name or Role/Title for this contact.';
    return;
  }

  // URL format validation if LinkedIn is provided
  if (linkedIn) {
    try {
      new URL(linkedIn.startsWith('http') ? linkedIn : `https://${linkedIn}`);
    } catch {
      contactValidationError.value = 'Please enter a valid URL for LinkedIn (e.g. linkedin.com/in/username)';
      return;
    }
  }

  if (isAddingContact.value) {
    form.value.contacts.push({
      id: `contact-${Date.now()}`,
      name,
      role,
      email,
      phone,
      linkedIn,
      notes,
    });
  } else if (isEditingContact.value && editingContactId.value) {
    const index = form.value.contacts.findIndex(c => c.id === editingContactId.value);
    if (index !== -1) {
      form.value.contacts[index] = {
        id: editingContactId.value,
        name,
        role,
        email,
        phone,
        linkedIn,
        notes,
      };
    }
  }

  cancelContactForm();
}

function deleteContact(id: string) {
  form.value.contacts = form.value.contacts.filter(c => c.id !== id);
}

function formatLinkedInUrl(url: string): string {
  if (!url) return '#';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

function addChecklistItem() {
  if (!newTodoText.value.trim()) return;
  form.value.checklist.push({
    id: `todo-${Date.now()}`,
    text: newTodoText.value.trim(),
    done: false,
  });
  newTodoText.value = '';
}

function removeChecklistItem(id: string) {
  form.value.checklist = form.value.checklist.filter((item) => item.id !== id);
}

function selectStage(stage: Stage) {
  form.value.stage = stage;
}

function handleSubmit() {
  validationErrors.value = {};
  let hasErrors = false;

  if (!form.value.company.trim()) {
    validationErrors.value.company = 'Company name is required';
    hasErrors = true;
  }
  if (!form.value.role.trim()) {
    validationErrors.value.role = 'Job title/role is required';
    hasErrors = true;
  }

  if (form.value.url.trim()) {
    try {
      new URL(form.value.url.trim());
    } catch {
      validationErrors.value.url = 'Please enter a valid URL (e.g., https://example.com)';
      hasErrors = true;
    }
  }

  if (hasErrors) {
    setTimeout(() => {
      const firstInvalid = drawerPanel.value?.querySelector('.form-input-error input') as HTMLElement | null;
      firstInvalid?.focus();
    }, 50);
    return;
  }

  const result: JobApplication = {
    id: props.application?.id || `APP-${Math.floor(100 + Math.random() * 900)}`,
    ...form.value,
  };
  if (!result.reminderDate) {
    delete result.reminderDate;
  }
  emit('save', result);
}

function handleDelete() {
  if (props.application) {
    isConfirmOpen.value = true;
  }
}

function confirmDelete() {
  if (props.application) {
    emit('delete', props.application.id);
    isConfirmOpen.value = false;
  }
}

function cancelDelete() {
  isConfirmOpen.value = false;
}

function getHistoryIcon(type: string): string {
  switch (type) {
    case 'creation':
      return 'solar:add-circle-bold-duotone';
    case 'stage_change':
      return 'solar:route-double-bold-duotone';
    case 'field_edit':
      return 'solar:pen-new-square-bold-duotone';
    case 'checklist_toggle':
      return 'solar:checklist-minimalistic-bold-duotone';
    case 'note_update':
      return 'solar:document-text-bold-duotone';
    case 'contact_update':
      return 'solar:users-group-two-rounded-bold-duotone';
    default:
      return 'solar:info-circle-bold-duotone';
  }
}

function getHistoryLabel(type: string): string {
  switch (type) {
    case 'creation': return 'Created';
    case 'stage_change': return 'Stage Change';
    case 'field_edit': return 'Field Edit';
    case 'checklist_toggle': return 'Task Update';
    case 'note_update': return 'Notes';
    case 'contact_update': return 'Contact';
    default: return 'Activity';
  }
}
</script>

<template>
  <div class="drawer-overlay" :class="{ open: isOpen }" @click="emit('close')">
    <div 
      ref="drawerPanel"
      class="drawer-panel" 
      :class="{ open: isOpen }" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="drawer-title"
      @click.stop
    >
      <header class="drawer-header">
        <div>
          <h2 id="drawer-title">{{ application ? 'Edit Application' : 'New Job Entry' }}</h2>
          <p class="drawer-subtitle">
            {{ application ? `ID: ${application.id}` : 'Track another opportunity' }}
          </p>
        </div>
        <button type="button" class="close-btn" @click="emit('close')" aria-label="Close drawer">
          <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
        </button>
      </header>

      <form class="drawer-body" @submit.prevent="handleSubmit" novalidate>
        <!-- Main Form Section -->
        <div class="form-grid">
          <div class="form-field full-width" :class="{ 'form-input-error': validationErrors.company }">
            <label for="company">Company Name <span class="required">*</span></label>
            <input
              id="company"
              v-model="form.company"
              type="text"
              placeholder="e.g. Google, Stripe, Tesla"
              maxlength="100"
              :aria-invalid="!!validationErrors.company"
              :aria-describedby="validationErrors.company ? 'company-error' : undefined"
            />
            <span v-if="validationErrors.company" id="company-error" class="error-message" role="alert">
              {{ validationErrors.company }}
            </span>
          </div>

          <div class="form-field full-width" :class="{ 'form-input-error': validationErrors.role }">
            <label for="role">Job Title / Role <span class="required">*</span></label>
            <input
              id="role"
              v-model="form.role"
              type="text"
              placeholder="e.g. Frontend Engineer, Product Designer"
              maxlength="100"
              :aria-invalid="!!validationErrors.role"
              :aria-describedby="validationErrors.role ? 'role-error' : undefined"
            />
            <span v-if="validationErrors.role" id="role-error" class="error-message" role="alert">
              {{ validationErrors.role }}
            </span>
          </div>

          <div class="form-field full-width">
            <label id="stage-label">Current Stage</label>
            <div class="stage-selectors" role="radiogroup" aria-labelledby="stage-label">
              <button
                v-for="s in stages"
                :key="s"
                type="button"
                class="stage-selector"
                role="radio"
                :aria-checked="form.stage === s"
                :class="[
                  `stage-${s.toLowerCase().replace(/\s+/g, '-').replace('-home', 'home')}`,
                  { active: form.stage === s }
                ]"
                @click="selectStage(s)"
              >
                <span>{{ s }}</span>
              </button>
            </div>
          </div>

          <div class="form-field">
            <label for="salary">Estimated Salary</label>
            <input
              id="salary"
              v-model="form.salary"
              type="text"
              placeholder="e.g. $145k or TBD"
              maxlength="50"
            />
          </div>

          <div class="form-field">
            <label for="location">Location</label>
            <input
              id="location"
              v-model="form.location"
              type="text"
              placeholder="e.g. New York, Remote, London"
              maxlength="100"
            />
          </div>

          <div class="form-field">
            <label for="workMode">Work Mode</label>
            <select id="workMode" v-model="form.workMode" class="form-select">
              <option v-for="mode in workModes" :key="mode" :value="mode">
                {{ mode }}
              </option>
            </select>
          </div>

          <div class="form-field">
            <label for="date">Applied Date</label>
            <input
              id="date"
              v-model="form.date"
              type="text"
              placeholder="e.g. Nov 12"
            />
          </div>

          <div class="form-field">
            <label for="reminderDate">Follow-up Reminder</label>
            <input
              id="reminderDate"
              v-model="form.reminderDate"
              type="date"
              class="form-input"
              :min="todayMinDate"
            />
          </div>

          <div class="form-field full-width" :class="{ 'form-input-error': validationErrors.url }">
            <label for="url">Job Posting URL</label>
            <div class="url-input-wrapper">
              <iconify-icon icon="solar:link-linear" class="url-input-icon"></iconify-icon>
              <input
                id="url"
                v-model="form.url"
                type="url"
                placeholder="https://jobs.company.com/..."
                maxlength="200"
                :aria-invalid="!!validationErrors.url"
                :aria-describedby="validationErrors.url ? 'url-error' : undefined"
              />
            </div>
            <span v-if="validationErrors.url" id="url-error" class="error-message" role="alert">
              {{ validationErrors.url }}
            </span>
          </div>

          <div class="form-field full-width">
            <label for="notes">Description &amp; Notes</label>
            <textarea
              id="notes"
              v-model="form.notes"
              rows="4"
              placeholder="Requirements, interviewer details, follow-ups, or notes..."
              maxlength="1000"
            ></textarea>
          </div>
        </div>

        <!-- Checklist Section -->
        <div class="checklist-section">
          <h3>Preparation Checklist</h3>
          <p class="section-desc">Manage custom checklist items for this application.</p>

          <div class="checklist-items">
            <div
              v-for="item in form.checklist"
              :key="item.id"
              class="checklist-item"
              :class="{ done: item.done }"
            >
              <label class="checkbox-label">
                <input type="checkbox" v-model="item.done" class="visually-hidden" />
                <span class="checkbox-custom">
                  <iconify-icon
                    v-if="item.done"
                    icon="solar:check-square-bold"
                    class="checkbox-check"
                  ></iconify-icon>
                  <span v-else class="checkbox-empty"></span>
                </span>
                <span class="checklist-text">{{ item.text }}</span>
              </label>
              <button
                type="button"
                class="remove-todo-btn"
                @click="removeChecklistItem(item.id)"
                aria-label="Remove item"
              >
                <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
              </button>
            </div>

            <div v-if="form.checklist.length === 0" class="checklist-empty-state">
              <span>No checklist tasks created yet. Add one below.</span>
            </div>
          </div>

          <div class="add-todo-group">
            <input
              v-model="newTodoText"
              type="text"
              placeholder="Add next action item..."
              @keydown.enter.prevent="addChecklistItem"
            />
            <button type="button" class="add-todo-btn" @click="addChecklistItem">
              <iconify-icon icon="solar:add-circle-linear"></iconify-icon>
              <span>Add</span>
            </button>
          </div>
        </div>

        <!-- Contacts Section -->
        <div class="contacts-section">
          <button 
            type="button" 
            class="accordion-header" 
            @click="isContactsExpanded = !isContactsExpanded" 
            :aria-expanded="isContactsExpanded"
          >
            <div class="accordion-title-group">
              <iconify-icon icon="solar:users-group-two-rounded-linear" class="accordion-icon"></iconify-icon>
              <h3>Contacts &amp; Recruiters</h3>
              <span class="contacts-badge" v-if="form.contacts.length > 0">
                {{ form.contacts.length }}
              </span>
            </div>
            <iconify-icon 
              :icon="isContactsExpanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'" 
              class="chevron-icon"
            ></iconify-icon>
          </button>

          <div v-show="isContactsExpanded" class="accordion-content">
            <!-- Add Contact Action (if not currently adding/editing) -->
            <button 
              type="button" 
              class="add-contact-trigger" 
              v-if="!isAddingContact && !isEditingContact" 
              @click="startAddContact"
            >
              <iconify-icon icon="solar:user-plus-linear"></iconify-icon>
              <span>Add Recruiter or Contact</span>
            </button>

            <!-- Inline Contact Form (Add or Edit Mode) -->
            <div class="contact-form-container" v-if="isAddingContact || isEditingContact">
              <h4 class="sub-form-title">
                {{ isEditingContact ? 'Edit Contact Details' : 'New Contact Details' }}
              </h4>
              <div class="contact-form-grid">
                <div class="form-field">
                  <label for="contact-name">Name <span class="required" v-if="!contactForm.role">*</span></label>
                  <input 
                    id="contact-name" 
                    v-model="contactForm.name" 
                    type="text" 
                    placeholder="e.g. Jane Doe"
                    maxlength="100" 
                  />
                </div>
                
                <div class="form-field">
                  <label for="contact-role">Role / Title <span class="required" v-if="!contactForm.name">*</span></label>
                  <input 
                    id="contact-role" 
                    v-model="contactForm.role" 
                    type="text" 
                    placeholder="e.g. Talent Acquisition"
                    maxlength="100" 
                  />
                </div>
                
                <div class="form-field">
                  <label for="contact-email">Email Address</label>
                  <input 
                    id="contact-email" 
                    v-model="contactForm.email" 
                    type="email" 
                    placeholder="e.g. jane@company.com"
                    maxlength="100" 
                  />
                </div>
                
                <div class="form-field">
                  <label for="contact-phone">Phone Number</label>
                  <input 
                    id="contact-phone" 
                    v-model="contactForm.phone" 
                    type="text" 
                    placeholder="e.g. +1 (555) 012-3456"
                    maxlength="50" 
                  />
                </div>
                
                <div class="form-field full-width">
                  <label for="contact-linkedin">LinkedIn URL</label>
                  <input 
                    id="contact-linkedin" 
                    v-model="contactForm.linkedIn" 
                    type="url" 
                    placeholder="e.g. linkedin.com/in/janedoe"
                    maxlength="200" 
                  />
                </div>
                
                <div class="form-field full-width">
                  <label for="contact-notes">Interaction Notes</label>
                  <textarea 
                    id="contact-notes" 
                    v-model="contactForm.notes" 
                    rows="2" 
                    placeholder="Notes on call, follow-up, referral connection..."
                    maxlength="500"
                  ></textarea>
                </div>
              </div>

              <div v-if="contactValidationError" class="contact-error-msg" role="alert">
                {{ contactValidationError }}
              </div>

              <div class="contact-form-actions">
                <button type="button" class="sub-action-btn cancel" @click="cancelContactForm">
                  Cancel
                </button>
                <button type="button" class="sub-action-btn save" @click="saveContact">
                  {{ isEditingContact ? 'Update Contact' : 'Add to Application' }}
                </button>
              </div>
            </div>

            <!-- Contacts Cards List -->
            <div class="contacts-list" v-if="form.contacts.length > 0 && !isAddingContact && !isEditingContact">
              <div v-for="contact in form.contacts" :key="contact.id" class="contact-card">
                <div class="contact-card-header">
                  <div class="contact-avatar">
                    {{ contact.name ? contact.name.charAt(0).toUpperCase() : (contact.role ? contact.role.charAt(0).toUpperCase() : 'C') }}
                  </div>
                  <div class="contact-meta">
                    <h4 class="contact-name">{{ contact.name || 'Unnamed Recruiter' }}</h4>
                    <span class="contact-role" v-if="contact.role">{{ contact.role }}</span>
                  </div>
                  <div class="contact-card-actions">
                    <button 
                      type="button" 
                      class="contact-icon-btn edit" 
                      @click="startEditContact(contact)" 
                      title="Edit contact"
                      aria-label="Edit contact"
                    >
                      <iconify-icon icon="solar:pen-linear"></iconify-icon>
                    </button>
                    <button 
                      type="button" 
                      class="contact-icon-btn delete" 
                      @click="deleteContact(contact.id)" 
                      title="Delete contact"
                      aria-label="Delete contact"
                    >
                      <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="contact-details" v-if="contact.email || contact.phone || contact.linkedIn || contact.notes">
                  <div class="contact-info-row" v-if="contact.email">
                    <iconify-icon icon="solar:letter-linear" class="contact-info-icon"></iconify-icon>
                    <a :href="`mailto:${contact.email}`" class="contact-info-link">{{ contact.email }}</a>
                  </div>
                  <div class="contact-info-row" v-if="contact.phone">
                    <iconify-icon icon="solar:phone-linear" class="contact-info-icon"></iconify-icon>
                    <span class="contact-info-text">{{ contact.phone }}</span>
                  </div>
                  <div class="contact-info-row" v-if="contact.linkedIn">
                    <iconify-icon icon="solar:link-linear" class="contact-info-icon"></iconify-icon>
                    <a 
                      :href="formatLinkedInUrl(contact.linkedIn)" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      class="contact-info-link linked-in"
                    >
                      LinkedIn Profile
                    </a>
                  </div>
                  <div class="contact-card-notes" v-if="contact.notes">
                    <p>{{ contact.notes }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Contacts Empty State -->
            <div v-if="form.contacts.length === 0 && !isAddingContact && !isEditingContact" class="contacts-empty-state">
              <iconify-icon icon="solar:users-group-two-rounded-linear" class="empty-icon"></iconify-icon>
              <span>No contacts logged yet. Keep track of recruiters, referrers, and hiring managers here.</span>
            </div>
          </div>
        </div>

        <!-- Activity Timeline Section -->
        <div class="history-section" v-if="application">
          <button 
            type="button" 
            class="accordion-header" 
            @click="isHistoryExpanded = !isHistoryExpanded" 
            :aria-expanded="isHistoryExpanded"
          >
            <div class="accordion-title-group">
              <iconify-icon icon="solar:history-linear" class="accordion-icon"></iconify-icon>
              <h3>Activity History</h3>
              <span class="contacts-badge" v-if="application.history && application.history.length > 0">
                {{ application.history.length }}
              </span>
            </div>
            <iconify-icon 
              :icon="isHistoryExpanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'" 
              class="chevron-icon"
            ></iconify-icon>
          </button>

          <div v-show="isHistoryExpanded" class="accordion-content">
            <div class="timeline-container" v-if="application.history && application.history.length > 0">
              <div class="timeline-line"></div>
              
              <div 
                v-for="entry in application.history" 
                :key="entry.id" 
                class="timeline-item"
                :class="`type-${entry.type}`"
              >
                <!-- Timeline bubble marker -->
                <div class="timeline-marker">
                  <div class="timeline-icon-wrapper">
                    <iconify-icon :icon="getHistoryIcon(entry.type)" class="timeline-icon"></iconify-icon>
                  </div>
                </div>

                <!-- Timeline body content -->
                <div class="timeline-content">
                  <div class="timeline-header">
                    <span class="timeline-type-label">{{ getHistoryLabel(entry.type) }}</span>
                    <span 
                      class="timeline-time" 
                      :title="new Date(entry.timestamp).toLocaleString()"
                    >
                      {{ formatRelativeTime(entry.timestamp) }}
                    </span>
                  </div>
                  <p class="timeline-message">{{ entry.message }}</p>
                </div>
              </div>
            </div>

            <!-- Empty State for timeline -->
            <div v-else class="timeline-empty-state">
              <iconify-icon icon="solar:info-circle-linear" class="empty-icon"></iconify-icon>
              <span>No activity history has been logged for this application yet.</span>
            </div>
          </div>
        </div>

        <!-- Actions Panel -->
        <div class="drawer-actions">
          <button
            v-if="application"
            type="button"
            class="action-btn delete-btn"
            @click="handleDelete"
          >
            <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
            <span>Delete</span>
          </button>

          <div class="right-actions">
            <button type="button" class="action-btn cancel-btn" @click="emit('close')">
              Cancel
            </button>
            <button type="submit" class="action-btn submit-btn">
              <iconify-icon icon="solar:diskette-linear"></iconify-icon>
              <span>{{ application ? 'Save Changes' : 'Create Entry' }}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <!-- Custom Delete Confirmation Dialog Modal -->
  <div class="confirm-overlay" :class="{ open: isConfirmOpen }" @click="cancelDelete" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
    <div class="confirm-modal" @click.stop>
      <div class="confirm-icon">
        <iconify-icon icon="solar:danger-triangle-linear"></iconify-icon>
      </div>
      <h3 id="confirm-title">Delete Application?</h3>
      <p id="confirm-desc">
        Are you sure you want to permanently delete this application for <strong>{{ application?.company }}</strong>? This action cannot be undone.
      </p>
      <div class="confirm-actions">
        <button type="button" class="confirm-btn cancel" @click="cancelDelete">
          Cancel
        </button>
        <button type="button" class="confirm-btn delete" @click="confirmDelete">
          Delete Opportunity
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--transition-speed-slow) var(--transition-ease), visibility var(--transition-speed-slow) var(--transition-ease);
}

.drawer-overlay.open {
  opacity: 1;
  visibility: visible;
}

.drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-width: 32rem;
  background: var(--neutral-950);
  border-left: 1px solid var(--neutral-800);
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 30px -10px rgba(0, 0, 0, 0.7);
  transform: translateX(100%);
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-panel.open {
  transform: translateX(0);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid var(--neutral-800);
  background: var(--neutral-950);
}

.drawer-header h2 {
  margin: 0;
  color: var(--neutral-50);
  font-size: 1.25rem;
  font-weight: 600;
}

.drawer-subtitle {
  margin: 0.15rem 0 0;
  color: var(--neutral-500);
  font-size: 0.75rem;
  font-family: var(--font-mono);
}

.close-btn {
  display: grid;
  place-items: center;
  color: var(--neutral-500);
  background: transparent;
  border: 0;
  font-size: 1.5rem;
  padding: 0.25rem;
  border-radius: var(--radius-md, 0.375rem);
  transition: color var(--transition-speed-fast), background-color var(--transition-speed-fast);
}

.close-btn:hover {
  color: var(--neutral-100);
  background: var(--neutral-900);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem 1rem;
}

.full-width {
  grid-column: span 2;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-field label {
  color: var(--neutral-400);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.required {
  color: var(--color-danger);
}

.form-field input[type="text"],
.form-field input[type="url"],
.form-field input[type="date"],
.form-field textarea,
.form-select {
  padding: 0.6rem 0.75rem;
  background: var(--neutral-900);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md, 0.375rem);
  color: var(--neutral-100);
  font-size: 0.875rem;
  outline: none;
  transition: border-color var(--transition-speed-fast), background-color var(--transition-speed-fast);
}

.form-field input:focus,
.form-field textarea:focus,
.form-select:focus {
  background: #1f1f1f;
  border-color: var(--neutral-600);
}

.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23737373' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  padding-right: 2.25rem;
}

.url-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.url-input-icon {
  position: absolute;
  left: 0.75rem;
  color: var(--neutral-500);
  font-size: 1rem;
}

.url-input-wrapper input {
  width: 100%;
  padding-left: 2.25rem !important;
}

.stage-selectors {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.15rem;
}

.stage-selector {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-full, 9999px);
  border: 1px solid;
  background: transparent;
  opacity: 0.4;
  transition: opacity var(--transition-speed-fast), background-color var(--transition-speed-fast), transform var(--transition-speed-fast);
}

.stage-selector:hover {
  opacity: 0.75;
  transform: translateY(-1px);
}

.stage-selector.active {
  opacity: 1;
}

/* Colors for active selectors */
.stage-selector.stage-applied {
  color: var(--stage-applied-color);
  border-color: var(--neutral-700);
}
.stage-selector.stage-applied.active {
  background: rgba(163, 163, 163, 0.15);
}

.stage-selector.stage-takehome {
  color: var(--stage-takehome-color);
  border-color: rgba(59, 130, 246, 0.3);
}
.stage-selector.stage-takehome.active {
  background: rgba(59, 130, 246, 0.15);
}

.stage-selector.stage-interview {
  color: var(--stage-interview-color);
  border-color: rgba(245, 158, 11, 0.3);
}
.stage-selector.stage-interview.active {
  background: rgba(245, 158, 11, 0.15);
}

.stage-selector.stage-offer {
  color: var(--stage-offer-color);
  border-color: rgba(16, 185, 129, 0.3);
}
.stage-selector.stage-offer.active {
  background: rgba(16, 185, 129, 0.15);
}

.stage-selector.stage-rejected {
  color: var(--stage-rejected-color);
  border-color: rgba(244, 63, 94, 0.3);
}
.stage-selector.stage-rejected.active {
  background: rgba(244, 63, 94, 0.15);
}

/* Checklist Styling */
.checklist-section {
  border-top: 1px solid var(--neutral-800);
  padding-top: 1.5rem;
}

.checklist-section h3 {
  margin: 0;
  color: var(--neutral-100);
  font-size: 0.95rem;
  font-weight: 600;
}

.section-desc {
  margin: 0.25rem 0 1rem;
  color: var(--neutral-500);
  font-size: 0.75rem;
}

.checklist-items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.checklist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--neutral-900);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md, 0.375rem);
  transition: opacity var(--transition-speed-fast);
}

.checklist-item.done {
  opacity: 0.6;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  flex: 1;
  user-select: none;
}

.checkbox-label input:focus-visible + .checkbox-custom {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.checkbox-custom {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
}

.checkbox-check {
  font-size: 1.15rem;
  color: var(--neutral-50);
}

.checkbox-empty {
  width: 0.9rem;
  height: 0.9rem;
  border: 1.5px solid var(--neutral-600);
  border-radius: 0.125rem;
}

.checklist-text {
  font-size: 0.85rem;
  color: var(--neutral-100);
}

.checklist-item.done .checklist-text {
  text-decoration: line-through;
  color: var(--neutral-500);
}

.remove-todo-btn {
  background: transparent;
  border: 0;
  color: var(--neutral-600);
  font-size: 1rem;
  display: grid;
  place-items: center;
  padding: 0.25rem;
  border-radius: var(--radius-sm, 0.25rem);
  transition: color var(--transition-speed-fast), background-color var(--transition-speed-fast);
}

.remove-todo-btn:hover {
  color: var(--color-danger);
  background: rgba(244, 63, 94, 0.1);
}

.checklist-empty-state {
  text-align: center;
  padding: 1rem;
  color: var(--neutral-600);
  font-size: 0.8rem;
  border: 1px dashed var(--neutral-800);
  border-radius: var(--radius-md, 0.375rem);
}

.add-todo-group {
  display: flex;
  gap: 0.5rem;
}

.add-todo-group input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: var(--neutral-900);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md, 0.375rem);
  color: var(--neutral-100);
  font-size: 0.85rem;
  outline: none;
}

.add-todo-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  background: var(--neutral-800);
  border: 1px solid var(--neutral-700);
  border-radius: var(--radius-md, 0.375rem);
  color: var(--neutral-100);
  font-size: 0.8rem;
  font-weight: 600;
  transition: background-color var(--transition-speed-fast);
}

.add-todo-btn:hover {
  background: var(--neutral-700);
}

/* Footer actions */
.drawer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--neutral-800);
  padding-top: 1.5rem;
  margin-top: auto;
  background: var(--neutral-950);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: var(--radius-md, 0.375rem);
  border: 1px solid transparent;
  transition: background-color var(--transition-speed-fast), border-color var(--transition-speed-fast), transform var(--transition-speed-fast);
}

.action-btn:hover {
  transform: translateY(-1px);
}

.cancel-btn {
  background: transparent;
  color: var(--neutral-500);
}

.cancel-btn:hover {
  color: var(--neutral-200);
}

.submit-btn {
  background: var(--neutral-50);
  color: var(--neutral-950);
}

.submit-btn:hover {
  background: var(--neutral-200);
}

.delete-btn {
  background: transparent;
  border-color: rgba(244, 63, 94, 0.2);
  color: var(--color-danger);
}

.delete-btn:hover {
  background: rgba(244, 63, 94, 0.1);
  border-color: rgba(244, 63, 94, 0.4);
}

.right-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

/* Accessible validation styling */
.error-message {
  color: var(--color-danger);
  font-size: 0.75rem;
  margin-top: 0.25rem;
  font-weight: 500;
}

.form-input-error input {
  border-color: var(--color-danger) !important;
  background: rgba(244, 63, 94, 0.03) !important;
}

.form-input-error input:focus {
  border-color: var(--color-danger) !important;
  outline: 2px solid var(--color-danger) !important;
}

/* Custom Confirmation Modal Overlay styling */
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--transition-speed-slow) var(--transition-ease), visibility var(--transition-speed-slow) var(--transition-ease);
}

.confirm-overlay.open {
  opacity: 1;
  visibility: visible;
}

.confirm-modal {
  width: 90%;
  max-width: 26rem;
  background: #0f0f0f;
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-lg, 0.75rem);
  padding: 1.75rem;
  box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transform: scale(0.95);
  transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.confirm-overlay.open .confirm-modal {
  transform: scale(1);
}

.confirm-icon {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: var(--radius-full, 999px);
  background: rgba(244, 63, 94, 0.1);
  color: var(--color-danger);
  font-size: 1.75rem;
  margin-bottom: 1.25rem;
}

.confirm-modal h3 {
  margin: 0 0 0.5rem;
  color: var(--neutral-50);
  font-size: 1.15rem;
  font-weight: 600;
}

.confirm-modal p {
  margin: 0 0 1.75rem;
  color: var(--neutral-400);
  font-size: 0.875rem;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  width: 100%;
}

.confirm-btn {
  flex: 1;
  padding: 0.65rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: var(--radius-md, 0.375rem);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color var(--transition-speed-fast), border-color var(--transition-speed-fast), transform var(--transition-speed-fast);
}

.confirm-btn:hover {
  transform: translateY(-1px);
}

.confirm-btn.cancel {
  background: transparent;
  border-color: var(--neutral-800);
  color: var(--neutral-400);
}

.confirm-btn.cancel:hover {
  color: var(--neutral-100);
  background: var(--neutral-900);
  border-color: var(--neutral-700);
}

.confirm-btn.delete {
  background: var(--color-danger);
  color: #ffffff;
}

.confirm-btn.delete:hover {
  background: #e11d48;
}

/* Contacts Section Custom Styles */
.contacts-section {
  border-top: 1px solid var(--neutral-800);
  padding-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border: 0;
  padding: 0.5rem 0;
  color: var(--neutral-100);
  cursor: pointer;
  outline: none;
  transition: color var(--transition-speed-fast) var(--transition-ease);
}

.accordion-header:hover {
  color: #ffffff;
}

.accordion-title-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.accordion-title-group h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.accordion-icon {
  font-size: 1.15rem;
  color: var(--neutral-400);
}

.contacts-badge {
  background: rgba(245, 245, 245, 0.1);
  color: var(--neutral-200);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius-full, 999px);
  font-family: var(--font-mono);
}

.chevron-icon {
  font-size: 0.875rem;
  color: var(--neutral-500);
  transition: transform 200ms ease;
}

.accordion-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 0.5rem;
}

/* Add Contact Trigger */
.add-contact-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem;
  background: rgba(38, 38, 38, 0.3);
  border: 1px dashed var(--neutral-700);
  border-radius: var(--radius-md, 0.375rem);
  color: var(--neutral-400);
  font-size: 0.8rem;
  font-weight: 600;
  transition: background-color var(--transition-speed-fast) var(--transition-ease), color var(--transition-speed-fast) var(--transition-ease), border-color var(--transition-speed-fast) var(--transition-ease);
}

.add-contact-trigger:hover {
  background: rgba(38, 38, 38, 0.6);
  border-color: var(--neutral-500);
  color: var(--neutral-100);
}

/* Contact Form Container styling */
.contact-form-container {
  background: var(--neutral-900);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md, 0.5rem);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  animation: slide-up-subtle 200ms ease-out;
}

@keyframes slide-up-subtle {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.sub-form-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--neutral-200);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.contact-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem 0.75rem;
}

.contact-error-msg {
  color: var(--color-danger);
  font-size: 0.75rem;
  font-weight: 500;
  background: rgba(244, 63, 94, 0.05);
  border: 1px solid rgba(244, 63, 94, 0.15);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md, 0.375rem);
}

.contact-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.sub-action-btn {
  padding: 0.45rem 0.85rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-sm, 0.25rem);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-speed-fast) var(--transition-ease);
}

.sub-action-btn.cancel {
  background: transparent;
  color: var(--neutral-500);
}

.sub-action-btn.cancel:hover {
  color: var(--neutral-200);
  background: rgba(255, 255, 255, 0.03);
}

.sub-action-btn.save {
  background: var(--neutral-50);
  color: var(--neutral-950);
}

.sub-action-btn.save:hover {
  background: var(--neutral-200);
}

/* Contacts List & Card styling */
.contacts-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.contact-card {
  background: rgba(23, 23, 23, 0.4);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md, 0.5rem);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: border-color var(--transition-speed-fast) var(--transition-ease), background-color var(--transition-speed-fast) var(--transition-ease);
}

.contact-card:hover {
  border-color: var(--neutral-700);
  background: rgba(23, 23, 23, 0.6);
}

.contact-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  position: relative;
}

.contact-avatar {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full, 999px);
  background: var(--neutral-800);
  border: 1px solid var(--neutral-700);
  color: var(--neutral-100);
  font-size: 0.85rem;
  font-weight: 600;
}

.contact-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.contact-name {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neutral-50);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-role {
  font-size: 0.75rem;
  color: var(--neutral-500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-card-actions {
  display: flex;
  gap: 0.25rem;
}

.contact-icon-btn {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  background: transparent;
  border: 0;
  color: var(--neutral-600);
  font-size: 0.85rem;
  border-radius: var(--radius-sm, 0.25rem);
  transition: all var(--transition-speed-fast) var(--transition-ease);
}

.contact-icon-btn:hover {
  background: var(--neutral-800);
  color: var(--neutral-100);
}

.contact-icon-btn.delete:hover {
  background: rgba(244, 63, 94, 0.1);
  color: var(--color-danger);
}

/* Contact Card Details */
.contact-details {
  border-top: 1px solid rgb(38 38 38 / 0.4);
  padding-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.contact-info-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--neutral-400);
}

.contact-info-icon {
  font-size: 0.95rem;
  color: var(--neutral-500);
}

.contact-info-link {
  color: var(--color-primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition-speed-fast) var(--transition-ease);
}

.contact-info-link:hover {
  color: #60a5fa;
  text-decoration: underline;
}

.contact-info-link.linked-in {
  color: var(--color-success);
}

.contact-info-link.linked-in:hover {
  color: #34d399;
}

.contact-info-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-card-notes {
  background: var(--neutral-900);
  border-radius: var(--radius-sm, 0.25rem);
  padding: 0.5rem 0.75rem;
  font-size: 0.775rem;
  color: #8a8a8a;
  border-left: 2px solid var(--neutral-600);
  margin-top: 0.25rem;
}

.contact-card-notes p {
  margin: 0;
  line-height: 1.4;
  white-space: pre-wrap;
}

/* Contacts Empty State */
.contacts-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem 1.5rem;
  text-align: center;
  background: rgba(23, 23, 23, 0.2);
  border: 1px dashed var(--neutral-800);
  border-radius: var(--radius-md, 0.5rem);
  color: var(--neutral-600);
  font-size: 0.8rem;
}

.contacts-empty-state .empty-icon {
  font-size: 1.5rem;
  color: var(--neutral-700);
}

/* History Timeline Section styling */
.history-section {
  border-top: 1px solid var(--neutral-800);
  padding-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.timeline-container {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 0.5rem 0.25rem 0.5rem 1rem;
  margin-left: 0.5rem;
}

.timeline-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1.85rem; /* center line behind the marker */
  width: 2px;
  background: var(--neutral-800);
  border-radius: 1px;
}

.timeline-item {
  position: relative;
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  animation: slide-up-subtle 250ms ease-out;
}

/* Timeline marker bubble */
.timeline-marker {
  position: relative;
  z-index: 2;
  flex: 0 0 1.75rem;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 0.15rem;
}

.timeline-icon-wrapper {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--neutral-900);
  border: 1.5px solid var(--neutral-700);
  color: var(--neutral-400);
  font-size: 0.9rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: transform var(--transition-speed-fast) var(--transition-ease), border-color var(--transition-speed-fast) var(--transition-ease);
}

.timeline-item:hover .timeline-icon-wrapper {
  transform: scale(1.1);
}

.timeline-icon {
  display: block;
}

/* Timeline Content */
.timeline-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  background: rgba(23, 23, 23, 0.35);
  border: 1px solid var(--neutral-900);
  border-radius: var(--radius-md, 0.375rem);
  padding: 0.65rem 0.85rem;
  transition: background-color var(--transition-speed-fast) var(--transition-ease), border-color var(--transition-speed-fast) var(--transition-ease);
}

.timeline-item:hover .timeline-content {
  background: rgba(23, 23, 23, 0.55);
  border-color: var(--neutral-800);
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.timeline-type-label {
  font-size: 0.725rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-400);
}

.timeline-time {
  font-size: 0.725rem;
  color: var(--neutral-500);
  font-family: var(--font-mono);
}

.timeline-message {
  margin: 0;
  font-size: 0.825rem;
  line-height: 1.4;
  color: var(--neutral-200);
}

/* Timeline Empty State */
.timeline-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem 1.5rem;
  text-align: center;
  background: rgba(23, 23, 23, 0.2);
  border: 1px dashed var(--neutral-800);
  border-radius: var(--radius-md, 0.5rem);
  color: var(--neutral-600);
  font-size: 0.8rem;
}

.timeline-empty-state .empty-icon {
  font-size: 1.5rem;
  color: var(--neutral-700);
}

/* -------------------------------------------------------------
 * PREMIUM COLOR CODING BY EVENT TYPE
 * ------------------------------------------------------------- */

/* 1. Creation */
.type-creation .timeline-icon-wrapper {
  color: #3b82f6; /* solar blue */
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.15);
}
.type-creation:hover .timeline-icon-wrapper {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.25);
}
.type-creation .timeline-type-label {
  color: #3b82f6;
}

/* 2. Stage Change */
.type-stage_change .timeline-icon-wrapper {
  color: #f59e0b; /* warning/amber */
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.08);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.15);
}
.type-stage_change:hover .timeline-icon-wrapper {
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.25);
}
.type-stage_change .timeline-type-label {
  color: #f59e0b;
}

/* 3. Field Edit */
.type-field_edit .timeline-icon-wrapper {
  color: #8b5cf6; /* violet */
  border-color: rgba(139, 92, 246, 0.4);
  background: rgba(139, 92, 246, 0.08);
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.15);
}
.type-field_edit:hover .timeline-icon-wrapper {
  border-color: rgba(139, 92, 246, 0.6);
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.25);
}
.type-field_edit .timeline-type-label {
  color: #a78bfa;
}

/* 4. Checklist Toggle */
.type-checklist_toggle .timeline-icon-wrapper {
  color: #10b981; /* emerald/success */
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.08);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
}
.type-checklist_toggle:hover .timeline-icon-wrapper {
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 15px rgba(16, 185, 129, 0.25);
}
.type-checklist_toggle .timeline-type-label {
  color: #10b981;
}

/* 5. Note Update */
.type-note_update .timeline-icon-wrapper {
  color: #06b6d4; /* cyan */
  border-color: rgba(6, 182, 212, 0.4);
  background: rgba(6, 182, 212, 0.08);
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
}
.type-note_update:hover .timeline-icon-wrapper {
  border-color: rgba(6, 182, 212, 0.6);
  box-shadow: 0 0 15px rgba(6, 182, 212, 0.25);
}
.type-note_update .timeline-type-label {
  color: #22d3ee;
}

/* 6. Contact Update */
.type-contact_update .timeline-icon-wrapper {
  color: #ec4899; /* pink */
  border-color: rgba(236, 72, 153, 0.4);
  background: rgba(236, 72, 153, 0.08);
  box-shadow: 0 0 10px rgba(236, 72, 153, 0.15);
}
.type-contact_update:hover .timeline-icon-wrapper {
  border-color: rgba(236, 72, 153, 0.6);
  box-shadow: 0 0 15px rgba(236, 72, 153, 0.25);
}
.type-contact_update .timeline-type-label {
  color: #f472b6;
}
</style>

