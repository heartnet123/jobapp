<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { UserProfile } from '../types';

const emit = defineEmits<{
  (e: 'update-active-profile', profileName: string, profileTitle: string): void;
}>();

const profiles = ref<UserProfile[]>([]);
const activeProfileId = ref<string>('');
const selectedProfile = ref<UserProfile>({
  id: '',
  fullName: '',
  email: '',
  phone: '',
  title: '',
  bio: '',
  resumeText: '',
  resumeFileName: '',
  resumeFile: '',
  updatedAt: ''
});

const isNewMode = ref(false);
const showSuccessMsg = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const dragActive = ref(false);

// Load profiles
async function fetchProfiles() {
  try {
    const res = await fetch('/api/profiles');
    if (res.ok) {
      profiles.value = await res.json();
      
      // Select active profile from localStorage or select the first one
      const storedActiveId = localStorage.getItem('active_profile_id');
      if (profiles.value.length > 0) {
        const found = profiles.value.find(p => p.id === storedActiveId);
        if (found) {
          activeProfileId.value = found.id;
          selectedProfile.value = { ...found };
        } else {
          activeProfileId.value = profiles.value[0].id;
          selectedProfile.value = { ...profiles.value[0] };
        }
        isNewMode.value = false;
      } else {
        // No profiles, trigger new profile mode automatically
        triggerNewProfile();
      }
    }
  } catch (err) {
    console.error('Error fetching profiles:', err);
  }
}

// Watch active profile selection
watch(activeProfileId, (newId) => {
  if (newId && !isNewMode.value) {
    const found = profiles.value.find(p => p.id === newId);
    if (found) {
      selectedProfile.value = { ...found };
      localStorage.setItem('active_profile_id', found.id);
      emit('update-active-profile', found.fullName, found.title);
    }
  }
});

// Trigger creating a new profile
function triggerNewProfile() {
  isNewMode.value = true;
  activeProfileId.value = '';
  selectedProfile.value = {
    id: `prof-${Date.now()}`,
    fullName: '',
    email: '',
    phone: '',
    title: '',
    bio: '',
    resumeText: '',
    resumeFileName: '',
    resumeFile: '',
    updatedAt: new Date().toISOString()
  };
}

// Cancel new profile mode
function cancelNewProfile() {
  if (profiles.value.length > 0) {
    isNewMode.value = false;
    activeProfileId.value = profiles.value[0].id;
    selectedProfile.value = { ...profiles.value[0] };
  } else {
    // If no profiles, can't cancel. Force clean sheet.
    selectedProfile.value = {
      id: `prof-${Date.now()}`,
      fullName: '',
      email: '',
      phone: '',
      title: '',
      bio: '',
      resumeText: '',
      resumeFileName: '',
      resumeFile: '',
      updatedAt: new Date().toISOString()
    };
  }
}

// Save active profile
async function handleSave() {
  if (!selectedProfile.value.fullName) {
    alert('Please enter Full Name');
    return;
  }

  try {
    selectedProfile.value.updatedAt = new Date().toISOString();
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedProfile.value)
    });

    if (res.ok) {
      const saved: UserProfile = await res.json();
      showSuccessMsg.value = `Successfully saved profile for ${saved.fullName}!`;
      setTimeout(() => { showSuccessMsg.value = ''; }, 3000);

      // Refresh list
      await fetchProfiles();
      activeProfileId.value = saved.id;
      isNewMode.value = false;
      emit('update-active-profile', saved.fullName, saved.title);
    } else {
      const err = await res.json();
      alert(`Save failed: ${err.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Error saving profile:', err);
    alert('Save failed due to connection error.');
  }
}

// Delete current profile
async function handleDelete() {
  if (!selectedProfile.value.id || isNewMode.value) return;
  if (!confirm(`Are you sure you want to delete profile for ${selectedProfile.value.fullName}?`)) return;

  try {
    const res = await fetch(`/api/profiles/${selectedProfile.value.id}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      showSuccessMsg.value = 'Profile deleted successfully.';
      setTimeout(() => { showSuccessMsg.value = ''; }, 3000);
      
      localStorage.removeItem('active_profile_id');
      await fetchProfiles();
      
      if (profiles.value.length === 0) {
        emit('update-active-profile', 'John Doe', 'Professional Pro');
      }
    } else {
      alert('Delete failed.');
    }
  } catch (err) {
    console.error('Error deleting profile:', err);
  }
}

// File uploader handling
function triggerFileSelect() {
  fileInput.value?.click();
}

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    processFile(target.files[0]);
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  dragActive.value = true;
}

function handleDragLeave() {
  dragActive.value = false;
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  dragActive.value = false;
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    processFile(e.dataTransfer.files[0]);
  }
}

function processFile(file: File) {
  const reader = new FileReader();
  reader.onload = (event) => {
    if (event.target?.result) {
      selectedProfile.value.resumeFile = event.target.result as string;
      selectedProfile.value.resumeFileName = file.name;
      
      // If it's a txt file, let's also read and auto-fill the resumeText paste area
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const textReader = new FileReader();
        textReader.onload = (txtEvent) => {
          if (txtEvent.target?.result) {
            selectedProfile.value.resumeText = txtEvent.target.result as string;
          }
        };
        textReader.readAsText(file);
      }
    }
  };
  reader.readAsDataURL(file);
}

// Download resume file
function handleDownloadResume() {
  if (!selectedProfile.value.resumeFile || !selectedProfile.value.resumeFileName) return;
  
  const link = document.createElement('a');
  link.href = selectedProfile.value.resumeFile;
  link.download = selectedProfile.value.resumeFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Clear current resume file
function handleClearResume() {
  selectedProfile.value.resumeFile = '';
  selectedProfile.value.resumeFileName = '';
}

onMounted(() => {
  fetchProfiles();
});
</script>

<template>
  <div class="profile-view-wrapper">
    <!-- Header Actions & Selection -->
    <div class="profile-header-card">
      <div class="selector-group">
        <label for="profile-select" class="selector-label">
          <iconify-icon icon="solar:user-rounded-linear" class="label-icon"></iconify-icon>
          Active User Profile
        </label>
        <div class="dropdown-actions">
          <select 
            id="profile-select"
            v-model="activeProfileId" 
            :disabled="isNewMode"
            class="profile-select-dropdown"
          >
            <option v-if="profiles.length === 0" value="">(No Profiles Found)</option>
            <option 
              v-for="prof in profiles" 
              :key="prof.id" 
              :value="prof.id"
            >
              {{ prof.fullName }} ({{ prof.title || 'No Title' }})
            </option>
          </select>

          <button 
            type="button" 
            class="new-profile-btn" 
            @click="triggerNewProfile"
            v-if="!isNewMode"
            title="Create a new profile"
          >
            <iconify-icon icon="solar:add-circle-linear"></iconify-icon>
            Add Profile
          </button>
        </div>
      </div>

      <div class="header-badge" v-if="isNewMode">
        <span class="badge-dot pulse"></span>
        Creating New Profile
      </div>
    </div>

    <!-- Main Editor Columns -->
    <div class="profile-grid">
      <!-- Left Column: Personal Data -->
      <section class="editor-column personal-info-card">
        <div class="card-header">
          <h2>Personal Information</h2>
          <p class="section-desc">Manage primary contact details and professional summary.</p>
        </div>

        <div class="form-inputs">
          <div class="input-row">
            <label class="form-field">
              <span class="field-label">Full Name *</span>
              <input 
                v-model="selectedProfile.fullName" 
                type="text" 
                placeholder="e.g. Jane Doe"
                required
              />
            </label>

            <label class="form-field">
              <span class="field-label">Professional Title</span>
              <input 
                v-model="selectedProfile.title" 
                type="text" 
                placeholder="e.g. Senior Frontend Developer"
              />
            </label>
          </div>

          <div class="input-row">
            <label class="form-field">
              <span class="field-label">Email Address</span>
              <input 
                v-model="selectedProfile.email" 
                type="email" 
                placeholder="e.g. jane.doe@example.com"
              />
            </label>

            <label class="form-field">
              <span class="field-label">Phone Number</span>
              <input 
                v-model="selectedProfile.phone" 
                type="tel" 
                placeholder="e.g. +66 81 234 5678"
              />
            </label>
          </div>

          <label class="form-field bio-field">
            <span class="field-label">Professional Summary &amp; Bio</span>
            <textarea 
              v-model="selectedProfile.bio" 
              placeholder="Write a brief professional summary about your skills, background, and career goals..."
              rows="6"
            ></textarea>
          </label>
        </div>

        <div class="form-actions-bar">
          <button 
            type="button" 
            class="save-btn" 
            @click="handleSave"
            title="Save changes to SQLite database"
          >
            <iconify-icon icon="solar:diskette-linear"></iconify-icon>
            Save Profile
          </button>
          
          <button 
            type="button" 
            class="cancel-btn" 
            @click="cancelNewProfile"
            v-if="isNewMode"
          >
            Cancel
          </button>

          <button 
            type="button" 
            class="delete-btn" 
            @click="handleDelete"
            v-if="!isNewMode && profiles.length > 0"
            title="Delete this profile"
          >
            <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
            Delete Profile
          </button>
        </div>

        <Transition name="fade">
          <div v-if="showSuccessMsg" class="success-alert">
            <iconify-icon icon="solar:check-circle-bold-duotone" class="alert-icon"></iconify-icon>
            <span>{{ showSuccessMsg }}</span>
          </div>
        </Transition>
      </section>

      <!-- Right Column: CV & Resume Upload / Paste -->
      <section class="editor-column resume-card">
        <div class="card-header">
          <h2>Resume / CV Attachment</h2>
          <p class="section-desc">Upload document file or paste raw text copy.</p>
        </div>

        <div class="resume-sections">
          <!-- File Uploader -->
          <div class="uploader-container">
            <span class="field-label">Resume Document (PDF, DOCX, TXT)</span>
            
            <div 
              class="drag-drop-area"
              :class="{ 'drag-active': dragActive }"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleDrop"
              @click="triggerFileSelect"
            >
              <input 
                ref="fileInput"
                type="file" 
                class="hidden-file-input"
                accept=".pdf,.docx,.doc,.txt,.rtf"
                @change="handleFileChange"
              />

              <div class="uploader-prompt" v-if="!selectedProfile.resumeFileName">
                <iconify-icon icon="solar:upload-square-linear" class="upload-icon"></iconify-icon>
                <span class="upload-title">Drag &amp; Drop resume here</span>
                <span class="upload-subtitle">or click to browse local files</span>
              </div>

              <div class="uploader-success" v-else @click.stop>
                <iconify-icon icon="solar:document-text-bold-duotone" class="doc-icon"></iconify-icon>
                <div class="file-details">
                  <span class="file-name">{{ selectedProfile.resumeFileName }}</span>
                  <span class="file-status">Ready to Save</span>
                </div>
                <div class="file-actions">
                  <button 
                    type="button" 
                    class="file-action-btn download" 
                    @click.stop="handleDownloadResume"
                    title="Download uploaded file"
                  >
                    <iconify-icon icon="solar:download-linear"></iconify-icon>
                  </button>
                  <button 
                    type="button" 
                    class="file-action-btn delete" 
                    @click.stop="handleClearResume"
                    title="Remove attachment"
                  >
                    <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Paste Text Area -->
          <label class="form-field paste-area">
            <span class="field-label">Or Paste Resume Text</span>
            <textarea 
              v-model="selectedProfile.resumeText" 
              placeholder="Paste the plain-text content of your resume / CV here for quick references..."
              rows="12"
              class="mono-textarea"
            ></textarea>
          </label>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.profile-view-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header Selector Card */
.profile-header-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.25rem 1.5rem;
  background: rgba(17, 17, 17, 0.4);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(10px);
}

.selector-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}

.selector-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--neutral-500);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.label-icon {
  font-size: 1rem;
}

.dropdown-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.profile-select-dropdown {
  width: 100%;
  max-width: 24rem;
  padding: 0.5rem 0.75rem;
  color: var(--neutral-100);
  background: rgba(23, 23, 23, 0.6);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md);
  font-size: 0.9rem;
  transition: border-color 0.2s, background-color 0.2s;
  cursor: pointer;
}

.profile-select-dropdown:focus {
  border-color: var(--neutral-500);
  outline: none;
}

.new-profile-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  color: var(--neutral-200);
  background: rgba(38, 38, 38, 0.5);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s;
}

.new-profile-btn:hover {
  color: var(--neutral-50);
  background: rgba(52, 52, 52, 0.7);
  border-color: var(--neutral-600);
}

.header-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  color: var(--color-warning);
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-dot {
  width: 6px;
  height: 6px;
  background-color: var(--color-warning);
  border-radius: var(--radius-full);
}

.badge-dot.pulse {
  animation: pulse-dot 1.5s infinite;
}

@keyframes pulse-dot {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 5px rgba(245, 158, 11, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}

/* Two Column Layout */
.profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  align-items: start;
}

@media (max-width: 900px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }
}

.editor-column {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.75rem;
  background: rgba(10, 10, 10, 0.4);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(10px);
}

.card-header {
  border-bottom: 1px solid rgba(38, 38, 38, 0.4);
  padding-bottom: 1rem;
}

.card-header h2 {
  margin: 0 0 0.25rem 0;
  color: var(--neutral-50);
  font-size: 1.15rem;
  font-weight: 600;
}

.section-desc {
  margin: 0;
  color: var(--neutral-500);
  font-size: 0.8rem;
}

/* Forms & Fields */
.form-inputs {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.input-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 600px) {
  .input-row {
    grid-template-columns: 1fr;
  }
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
}

.field-label {
  color: var(--neutral-400);
  font-size: 0.75rem;
  font-weight: 500;
}

.form-field input,
.form-field textarea {
  width: 100%;
  padding: 0.55rem 0.75rem;
  color: var(--neutral-100);
  background: rgba(23, 23, 23, 0.5);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  transition: all 0.2s;
}

.form-field input:focus,
.form-field textarea:focus {
  border-color: var(--neutral-600);
  background: rgba(38, 38, 38, 0.4);
  outline: none;
}

.form-actions-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(38, 38, 38, 0.4);
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.25rem;
  color: var(--neutral-950);
  background: var(--neutral-50);
  border: 0;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 600;
  transition: background-color 0.2s;
}

.save-btn:hover {
  background: var(--neutral-200);
}

.cancel-btn {
  padding: 0.55rem 1rem;
  color: var(--neutral-400);
  background: transparent;
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  transition: all 0.2s;
}

.cancel-btn:hover {
  color: var(--neutral-100);
  background: rgba(38, 38, 38, 0.4);
}

.delete-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
  padding: 0.55rem 1rem;
  color: var(--color-danger);
  background: rgba(244, 63, 94, 0.05);
  border: 1px solid rgba(244, 63, 94, 0.15);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  transition: all 0.2s;
}

.delete-btn:hover {
  color: #fff;
  background: var(--color-danger);
}

.success-alert {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  color: var(--color-success);
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.15);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
}

.alert-icon {
  font-size: 1.1rem;
}

/* Resume & CV column components */
.resume-sections {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.uploader-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.drag-drop-area {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 7rem;
  padding: 1.25rem;
  background: rgba(23, 23, 23, 0.3);
  border: 2px dashed var(--neutral-800);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
}

.drag-drop-area:hover,
.drag-drop-area.drag-active {
  border-color: var(--neutral-500);
  background: rgba(23, 23, 23, 0.5);
}

.hidden-file-input {
  display: none;
}

.uploader-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
}

.upload-icon {
  font-size: 2rem;
  color: var(--neutral-600);
}

.upload-title {
  color: var(--neutral-300);
  font-size: 0.85rem;
  font-weight: 500;
}

.upload-subtitle {
  color: var(--neutral-500);
  font-size: 0.75rem;
}

/* Uploader Success state */
.uploader-success {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem;
}

.doc-icon {
  font-size: 2.25rem;
  color: var(--color-primary);
}

.file-details {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.file-name {
  color: var(--neutral-200);
  font-size: 0.875rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-status {
  color: var(--color-success);
  font-size: 0.75rem;
  font-weight: 600;
}

.file-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.file-action-btn {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  color: var(--neutral-400);
  background: rgba(38, 38, 38, 0.4);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md);
  transition: all 0.2s;
  cursor: pointer;
}

.file-action-btn:hover {
  color: var(--neutral-100);
  background: rgba(52, 52, 52, 0.6);
}

.file-action-btn.delete:hover {
  color: var(--color-danger);
  border-color: rgba(244, 63, 94, 0.2);
  background: rgba(244, 63, 94, 0.05);
}

.mono-textarea {
  font-family: var(--font-mono);
  line-height: 1.5;
  font-size: 0.8rem !important;
  resize: vertical;
}

/* Fades */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
