<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import type { JobApplication, Stage, Contact } from '@jobapp/shared';
import ApplicationDrawer from './components/ApplicationDrawer.vue';
import Toast from './components/Toast.vue';
import { STAGE_ICONS } from '@jobapp/shared';
import { getTodayString, isReminderDue, stageClass, detectChangesAndGenerateLogs } from './utils';

// Active User Profile info for sidebar & header
const activeProfileName = ref('John Doe');
const activeProfileTitle = ref('Professional Pro');

function handleUpdateActiveProfile(name: string, title: string) {
  activeProfileName.value = name || 'John Doe';
  activeProfileTitle.value = title || 'Professional Pro';
}

const avatarInitials = computed(() => {
  const parts = activeProfileName.value.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return activeProfileName.value.substring(0, 2).toUpperCase();
}
);


// -------------------------------------------------------------
// TOAST STATE & UTILITIES
// -------------------------------------------------------------
interface ToastNotification {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

const toasts = ref<ToastNotification[]>([]);
let toastCounter = 0;

function showToast(message: string, type: 'success' | 'info' | 'error' = 'success') {
  const id = `toast-${Date.now()}-${++toastCounter}`;
  toasts.value.push({ id, message, type });
}

function removeToast(id: string) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

// -------------------------------------------------------------
// CORE APPLICATIONS STATE & PERSISTENCE
// -------------------------------------------------------------
const defaultApplications: JobApplication[] = [];

const applications = ref<JobApplication[]>([]);
let notificationInterval: number | undefined;

async function loadApplications() {
  try {
    const res = await fetch('/api/applications');
    if (!res.ok) {
      throw new Error(`Failed to fetch from SQLite: ${res.statusText}`);
    }
    applications.value = await res.json();
  } catch (err) {
    console.error('Failed to load applications from SQLite database:', err);
    applications.value = [];
    showToast('Cannot connect to SQLite database. Please start the daemon and refresh.', 'error');
  }
}

onMounted(async () => {
  await loadApplications();

  // Load active profile info
  try {
    const profilesRes = await fetch('/api/profiles');
    if (profilesRes.ok) {
      const list = await profilesRes.json();
      const storedActiveId = localStorage.getItem('active_profile_id');
      const active = list && list.length > 0 ? (list.find((p: any) => p.id === storedActiveId) || list[0]) : null;
      if (active) {
        activeProfileName.value = active.fullName || 'John Doe';
        activeProfileTitle.value = active.title || 'Professional Pro';
      }
    }
  } catch (err) {
    console.warn('Could not fetch active profile on mount', err);
  }

  // Initialize follow-up notifications
  checkNotificationPermission();
  setTimeout(() => {
    triggerBrowserNotifications();
  }, 1000);

  // Background reminder notifications check every 5 minutes
  notificationInterval = window.setInterval(() => {
    triggerBrowserNotifications();
  }, 5 * 60 * 1000);
});

onUnmounted(() => {
  if (notificationInterval) {
    clearInterval(notificationInterval);
  }
});

async function saveApplication(appData: JobApplication, isNew: boolean) {
  const url = isNew ? '/api/applications' : `/api/applications/${appData.id}`;
  const method = isNew ? 'POST' : 'PUT';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appData),
  });
  if (!res.ok) {
    throw new Error(`Failed to save to SQLite: ${res.statusText}`);
  }
}

async function deleteApplication(id: string) {
  const res = await fetch(`/api/applications/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete from SQLite: ${res.statusText}`);
  }
}

// -------------------------------------------------------------
// ROUTING & NAVIGATION VIEWS
// -------------------------------------------------------------
type ViewLabel = 'Overview' | 'Pipeline' | 'Analytics' | 'Automation' | 'Profile';

const router = useRouter();
const route = useRoute();

const currentView = computed<ViewLabel>(() => {
  const name = route.name;
  if (name === 'Pipeline') return 'Pipeline';
  if (name === 'Analytics') return 'Analytics';
  if (name === 'Automation') return 'Automation';
  if (name === 'Profile') return 'Profile';
  return 'Overview';
});

const navItems = computed(() => [
  { icon: 'solar:widget-5-linear', label: 'Overview', active: currentView.value === 'Overview' },
  { icon: 'solar:layers-minimalistic-linear', label: 'Pipeline', active: currentView.value === 'Pipeline' },
  { icon: 'solar:chart-square-linear', label: 'Analytics', active: currentView.value === 'Analytics' },
  { icon: 'solar:bolt-circle-linear', label: 'Automation', active: currentView.value === 'Automation' },
  { icon: 'solar:user-rounded-linear', label: 'Profile', active: currentView.value === 'Profile' },
]);

function setView(view: ViewLabel) {
  const nameMap: Record<ViewLabel, string> = {
    'Overview': 'Overview',
    'Pipeline': 'Pipeline',
    'Analytics': 'Analytics',
    'Automation': 'Automation',
    'Profile': 'Profile'
  };
  router.push({ name: nameMap[view] });
}

// -------------------------------------------------------------
// FILTER, SEARCH, & SORT LOGIC
// -------------------------------------------------------------
const tabs = ['All', 'Applied', 'Take-home', 'Interview', 'Offer', 'Rejected'] as const;
type Tab = (typeof tabs)[number];

const activeTab = ref<Tab>('All');
const searchQuery = ref('');

// Sort State & Session Persistence
type SortKey = 'company' | 'stage' | 'location' | 'salary' | 'date';
type SortOrder = 'asc' | 'desc';

const sortBy = ref<SortKey>((sessionStorage.getItem('job_tracker_sort_by') as SortKey) || 'date');
const sortOrder = ref<SortOrder>((sessionStorage.getItem('job_tracker_sort_order') as SortOrder) || 'desc');

function handleSort(key: SortKey) {
  if (sortBy.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = key;
    sortOrder.value = (key === 'date' || key === 'salary') ? 'desc' : 'asc';
  }
  sessionStorage.setItem('job_tracker_sort_by', sortBy.value);
  sessionStorage.setItem('job_tracker_sort_order', sortOrder.value);
}

// Robust Parsers for Sorting
function parseDate(dateStr: string): number {
  if (!dateStr) return 0;
  
  // Try standard Date parsing first
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return parsed;
  }

  // Custom fallback for "MMM DD" or "MMM D" formats (e.g. "Nov 12", "Oct 28")
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  const parts = dateStr.trim().toLowerCase().split(/\s+/);
  if (parts.length === 2) {
    const monthName = parts[0].substring(0, 3);
    const day = parseInt(parts[1], 10);
    if (months[monthName] !== undefined && !isNaN(day)) {
      const year = new Date().getFullYear();
      return new Date(year, months[monthName], day).getTime();
    }
  }

  return 0;
}

function parseSalary(salaryStr: string): number {
  if (!salaryStr) return 0;
  const normalized = salaryStr.toLowerCase().trim();
  if (normalized === 'tbd' || normalized === 'unknown') return 0;

  const match = normalized.match(/([0-9.]+)\s*(k|m)?/);
  if (match) {
    const value = parseFloat(match[1]);
    if (isNaN(value)) return 0;
    const multiplierStr = match[2];
    let multiplier = 1;
    if (multiplierStr === 'k') {
      multiplier = 1000;
    } else if (multiplierStr === 'm') {
      multiplier = 1000000;
    }
    return value * multiplier;
  }
  return 0;
}

const filteredApplications = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  const temp = applications.value.filter((application) => {
    // Stage filtering (only relevant for Table Overview tab)
    const matchesTab = activeTab.value === 'All' || application.stage === activeTab.value;

    // Search query filtering
    const matchesSearch =
      !query ||
      application.company.toLowerCase().includes(query) ||
      application.role.toLowerCase().includes(query) ||
      (application.location && application.location.toLowerCase().includes(query));

    return matchesTab && matchesSearch;
  });

  return temp.sort((a, b) => {
    let valA: any = '';
    let valB: any = '';

    if (sortBy.value === 'company') {
      valA = a.company.toLowerCase();
      valB = b.company.toLowerCase();
    } else if (sortBy.value === 'stage') {
      const stageOrderMap: Record<Stage, number> = {
        'Applied': 1,
        'Take-home': 2,
        'Interview': 3,
        'Offer': 4,
        'Rejected': 5
      };
      valA = stageOrderMap[a.stage] || 0;
      valB = stageOrderMap[b.stage] || 0;
    } else if (sortBy.value === 'location') {
      valA = (a.location || 'Remote').toLowerCase();
      valB = (b.location || 'Remote').toLowerCase();
    } else if (sortBy.value === 'salary') {
      valA = parseSalary(a.salary);
      valB = parseSalary(b.salary);
    } else if (sortBy.value === 'date') {
      valA = parseDate(a.date);
      valB = parseDate(b.date);
    }

    if (valA < valB) return sortOrder.value === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder.value === 'asc' ? 1 : -1;

    // Tie-breaker: sort by Date descending, then ID descending
    if (sortBy.value !== 'date') {
      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);
      if (dateA !== dateB) return dateB - dateA;
    }
    return b.id.localeCompare(a.id);
  });
});

// Used inside Kanban board view which groups itself by stage, but can still filter cards by search query
const searchFilteredApplications = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return applications.value;

  return applications.value.filter(
    (app) =>
      app.company.toLowerCase().includes(query) ||
      app.role.toLowerCase().includes(query) ||
      (app.location && app.location.toLowerCase().includes(query))
  );
});

// -------------------------------------------------------------
// DRAWER / FORM ACTIONS (ADD, EDIT, DELETE)
// -------------------------------------------------------------
const isDrawerOpen = ref(false);
const selectedApplication = ref<JobApplication | null>(null);

function openNewEntry() {
  selectedApplication.value = null; // Create Mode
  isDrawerOpen.value = true;
}

function openEditEntry(app: JobApplication) {
  selectedApplication.value = app; // Edit Mode
  isDrawerOpen.value = true;
}

async function handleSave(updatedApp: JobApplication) {
  const index = applications.value.findIndex((a) => a.id === updatedApp.id);
  const isNew = index === -1;

  if (!isNew) {
    // Update existing record
    const oldApp = applications.value[index];
    const newLogs = detectChangesAndGenerateLogs(oldApp, updatedApp);
    
    if (newLogs.length > 0) {
      if (!updatedApp.history) {
        updatedApp.history = oldApp.history || [];
      }
      updatedApp.history = [...newLogs, ...updatedApp.history];
    } else if (oldApp.history && !updatedApp.history) {
      updatedApp.history = oldApp.history;
    }
    
    applications.value[index] = updatedApp;
    showToast(`Updated entry for ${updatedApp.company}`, 'success');
  } else {
    // Create new record
    updatedApp.history = [
      {
        id: `log-${Date.now()}-creation-${Math.floor(Math.random() * 10000)}`,
        timestamp: new Date().toISOString(),
        type: 'creation',
        message: `Opportunity tracked for ${updatedApp.company} at stage ${updatedApp.stage}`
      }
    ];
    applications.value.unshift(updatedApp);
    showToast(`Added entry for ${updatedApp.company}`, 'success');
  }

  isDrawerOpen.value = false;
  await saveApplication(updatedApp, isNew);
}

async function handleDelete(id: string) {
  const appToDelete = applications.value.find((a) => a.id === id);
  if (appToDelete) {
    applications.value = applications.value.filter((a) => a.id !== id);
    showToast(`Deleted ${appToDelete.company} tracking`, 'info');
    await deleteApplication(id);
  }
  isDrawerOpen.value = false;
}

async function handleUpdateStage(id: string, newStage: Stage) {
  const index = applications.value.findIndex((a) => a.id === id);
  if (index !== -1) {
    const oldStage = applications.value[index].stage;
    if (oldStage !== newStage) {
      const app = applications.value[index];
      const updatedApp = { ...app, stage: newStage };
      
      if (!updatedApp.history) {
        updatedApp.history = app.history || [];
      }
      
      updatedApp.history = [
        {
          id: `log-${Date.now()}-stage-${Math.floor(Math.random() * 10000)}`,
          timestamp: new Date().toISOString(),
          type: 'stage_change',
          message: `Stage moved from ${oldStage} → ${newStage}`
        },
        ...updatedApp.history
      ];
      
      applications.value[index] = updatedApp;
      showToast(`${updatedApp.company} stage moved from ${oldStage} → ${newStage}`, 'success');
      await saveApplication(updatedApp, false);
    }
  }
}



// -------------------------------------------------------------
// NOTIFICATIONS CENTER & BROWSER NOTIFICATIONS
// -------------------------------------------------------------
const isNotificationsOpen = ref(false);
const desktopNotificationsEnabled = ref(false);

const categorizedReminders = computed(() => {
  const todayStr = getTodayString();
  const overdue: JobApplication[] = [];
  const today: JobApplication[] = [];

  applications.value.forEach((app) => {
    if (app.reminderDate) {
      if (app.reminderDate < todayStr) {
        overdue.push(app);
      } else if (app.reminderDate === todayStr) {
        today.push(app);
      }
    }
  });

  return { overdue, today };
});

const dueRemindersCount = computed(() => {
  return categorizedReminders.value.overdue.length + categorizedReminders.value.today.length;
});

const dismissedHash = ref(sessionStorage.getItem('job_tracker_dismissed_reminders_hash') || '');

const currentDueHash = computed(() => {
  const ids = [
    ...categorizedReminders.value.overdue.map(a => a.id),
    ...categorizedReminders.value.today.map(a => a.id)
  ];
  return ids.sort().join(',');
});

const showNotificationBar = computed(() => {
  if (dueRemindersCount.value === 0) return false;
  return dismissedHash.value !== currentDueHash.value;
});

function dismissNotificationBar() {
  dismissedHash.value = currentDueHash.value;
  sessionStorage.setItem('job_tracker_dismissed_reminders_hash', currentDueHash.value);
}

function toggleNotificationsDropdown() {
  isNotificationsOpen.value = !isNotificationsOpen.value;
}

async function dismissReminder(appId: string) {
  const index = applications.value.findIndex((app) => app.id === appId);
  if (index !== -1) {
    const app = applications.value[index];
    const updatedApp = { ...app };
    delete updatedApp.reminderDate;
    
    if (!updatedApp.history) {
      updatedApp.history = app.history || [];
    }
    
    updatedApp.history = [
      {
        id: `log-${Date.now()}-reminderDate-${Math.floor(Math.random() * 10000)}`,
        timestamp: new Date().toISOString(),
        type: 'field_edit',
        message: `Follow-up reminder cleared`
      },
      ...updatedApp.history
    ];
    
    applications.value[index] = updatedApp;
    showToast(`Reminder cleared for ${app.company}`, 'info');
    await saveApplication(updatedApp, false);
  }
}

function handleNotificationClick(app: JobApplication) {
  openEditEntry(app);
  isNotificationsOpen.value = false;
}

function checkNotificationPermission() {
  if ('Notification' in window) {
    const pref = localStorage.getItem('job_tracker_desktop_notif_pref');
    desktopNotificationsEnabled.value = Notification.permission === 'granted' && pref === 'true';
  }
}

async function toggleDesktopNotifications() {
  if (!('Notification' in window)) {
    showToast('Browser notifications not supported by this browser', 'error');
    return;
  }

  if (Notification.permission === 'denied') {
    showToast('Notifications are blocked by your browser settings. Please enable them manually.', 'error');
    return;
  }

  if (Notification.permission === 'granted') {
    const isCurrentlyEnabled = desktopNotificationsEnabled.value;
    localStorage.setItem('job_tracker_desktop_notif_pref', String(!isCurrentlyEnabled));
    desktopNotificationsEnabled.value = !isCurrentlyEnabled;
    showToast(desktopNotificationsEnabled.value ? 'Desktop notifications enabled' : 'Desktop notifications muted', 'info');
  } else {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem('job_tracker_desktop_notif_pref', 'true');
      desktopNotificationsEnabled.value = true;
      showToast('Desktop notifications enabled!', 'success');
      new Notification('🔔 Job Tracker Reminders Enabled', {
        body: 'We will notify you when it is time to follow up on your applications!',
      });
    } else {
      localStorage.setItem('job_tracker_desktop_notif_pref', 'false');
      desktopNotificationsEnabled.value = false;
      showToast('Notification permission denied', 'info');
    }
  }
}

function triggerBrowserNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('job_tracker_desktop_notif_pref') === 'false') return;

  const dueApps = applications.value.filter((app) => isReminderDue(app));
  if (dueApps.length === 0) return;

  const notifiedAppsCached = sessionStorage.getItem('job_tracker_notified_apps');
  const notifiedAppIds = notifiedAppsCached ? JSON.parse(notifiedAppsCached) : [];

  const newDueApps = dueApps.filter((app) => !notifiedAppIds.includes(app.id));

  if (newDueApps.length > 0) {
    if (newDueApps.length === 1) {
      const app = newDueApps[0];
      new Notification(`🔔 Follow up: ${app.company}`, {
        body: `Reminder to follow up for the ${app.role} position today!`,
        tag: app.id,
      });
    } else {
      new Notification(`🔔 Job Follow-up Reminders`, {
        body: `You have ${newDueApps.length} applications due for a follow-up today!`,
      });
    }

    const updatedNotified = [...notifiedAppIds, ...newDueApps.map((a) => a.id)];
    sessionStorage.setItem('job_tracker_notified_apps', JSON.stringify(updatedNotified));
  }
}
</script>

<template>
  <div class="app-shell">
    <!-- Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-main">
        <div class="brand">
          <div class="brand-mark">TR</div>
          <span class="brand-name">T r a c k e r</span>
        </div>

        <nav class="nav-list" aria-label="Views">
          <span class="nav-section">Views</span>
          <button
            v-for="item in navItems"
            :key="item.label"
            type="button"
            class="nav-item"
            :class="{ active: item.active }"
            @click="setView(item.label as ViewLabel)"
          >
            <iconify-icon :icon="item.icon" class="nav-icon"></iconify-icon>
            <span>{{ item.label }}</span>
          </button>
        </nav>
      </div>

      <div class="profile-panel" @click="setView('Profile')">
        <button type="button" class="profile-button" :class="{ active: currentView === 'Profile' }">
          <span class="avatar">{{ avatarInitials }}</span>
          <span class="profile-text">
            <span class="profile-name">{{ activeProfileName }}</span>
            <span class="profile-plan">{{ activeProfileTitle }}</span>
          </span>
        </button>
      </div>
    </aside>

    <!-- Main Workspace -->
    <main class="main-content">
      <!-- Topbar Header -->
      <header class="topbar">
        <div class="title-group">
          <h1>{{ currentView }}</h1>
          <span class="title-divider"></span>
          <span class="record-count">{{ applications.length }} Total Records</span>
        </div>

        <div class="topbar-actions">
          <!-- Hide Search Bar in Analytics View for layout elegance -->
          <label class="search-field" v-if="currentView !== 'Analytics' && currentView !== 'Automation'">
            <iconify-icon icon="solar:magnifer-linear" class="search-icon"></iconify-icon>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search roles, companies, locations..."
              aria-label="Search roles, companies, locations..."
            />
          </label>

          <!-- Notifications Bell & Dropdown Panel -->
          <div class="notification-container">
            <button
              type="button"
              class="bell-btn"
              :class="{ 'has-unread': dueRemindersCount > 0 }"
              @click="toggleNotificationsDropdown"
              aria-label="Toggle follow-up notifications"
              title="Follow-up notifications"
            >
              <iconify-icon :icon="dueRemindersCount > 0 ? 'solar:bell-bing-linear' : 'solar:bell-linear'" class="bell-btn-icon"></iconify-icon>
              <span v-if="dueRemindersCount > 0" class="bell-badge-count">{{ dueRemindersCount }}</span>
            </button>

            <!-- Dropdown List -->
            <div v-if="isNotificationsOpen" class="notification-dropdown" role="dialog" aria-label="Notifications panel">
              <header class="dropdown-header">
                <h3>Follow-up Reminders</h3>
                <span class="due-summary" v-if="dueRemindersCount > 0">{{ dueRemindersCount }} due</span>
              </header>

              <div class="dropdown-body">
                <!-- Overdue Section -->
                <div v-if="categorizedReminders.overdue.length > 0" class="dropdown-section overdue">
                  <h4 class="section-title">Overdue Reminders</h4>
                  <div class="dropdown-list">
                    <div
                      v-for="app in categorizedReminders.overdue"
                      :key="app.id"
                      class="notification-item overdue"
                      @click="handleNotificationClick(app)"
                    >
                      <div class="notif-item-body">
                        <div class="notif-company">{{ app.company }}</div>
                        <div class="notif-role">{{ app.role }}</div>
                        <div class="notif-date">Due: {{ app.reminderDate }}</div>
                      </div>
                      <button
                        type="button"
                        class="notif-dismiss-btn"
                        @click.stop="dismissReminder(app.id)"
                        title="Dismiss reminder"
                        aria-label="Dismiss reminder"
                      >
                        <iconify-icon icon="solar:check-square-linear"></iconify-icon>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Today Section -->
                <div v-if="categorizedReminders.today.length > 0" class="dropdown-section today">
                  <h4 class="section-title">Today's Reminders</h4>
                  <div class="dropdown-list">
                    <div
                      v-for="app in categorizedReminders.today"
                      :key="app.id"
                      class="notification-item today"
                      @click="handleNotificationClick(app)"
                    >
                      <div class="notif-item-body">
                        <div class="notif-company">{{ app.company }}</div>
                        <div class="notif-role">{{ app.role }}</div>
                        <div class="notif-date">Today</div>
                      </div>
                      <button
                        type="button"
                        class="notif-dismiss-btn"
                        @click.stop="dismissReminder(app.id)"
                        title="Dismiss reminder"
                        aria-label="Dismiss reminder"
                      >
                        <iconify-icon icon="solar:check-square-linear"></iconify-icon>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Empty State -->
                <div v-if="dueRemindersCount === 0" class="dropdown-empty-state">
                  <iconify-icon icon="solar:bell-linear" class="empty-icon"></iconify-icon>
                  <span>You're all caught up! No reminders.</span>
                </div>
              </div>

              <!-- Footer Settings Toggle -->
              <footer class="dropdown-footer">
                <label class="settings-toggle">
                  <span class="toggle-label">Desktop Notifications</span>
                  <button
                    type="button"
                    class="toggle-switch-btn"
                    :class="{ active: desktopNotificationsEnabled }"
                    @click="toggleDesktopNotifications"
                    role="switch"
                    :aria-checked="desktopNotificationsEnabled"
                    aria-label="Enable Desktop Notifications"
                  >
                    <span class="toggle-switch-thumb"></span>
                  </button>
                </label>
              </footer>
            </div>
          </div>

          <button type="button" class="new-button" @click="openNewEntry">
            <iconify-icon icon="solar:add-circle-linear"></iconify-icon>
            <span>New Entry</span>
          </button>
        </div>
      </header>

      <!-- In-app Notification Bar Banner -->
      <Transition name="slide-down">
        <div v-if="showNotificationBar" class="reminder-banner">
          <div class="banner-body">
            <span class="banner-icon-container">
              <iconify-icon icon="solar:bell-bing-bold-duotone" class="bell-pulse-icon"></iconify-icon>
            </span>
            <span class="banner-message">
              You have 
              <span v-if="categorizedReminders.overdue.length > 0">
                <strong class="count-overdue">{{ categorizedReminders.overdue.length }} overdue</strong>
              </span>
              <span v-if="categorizedReminders.overdue.length > 0 && categorizedReminders.today.length > 0"> and </span>
              <span v-if="categorizedReminders.today.length > 0">
                <strong class="count-today">{{ categorizedReminders.today.length }} today's</strong>
              </span>
              follow-up reminder{{ dueRemindersCount > 1 ? 's' : '' }} waiting!
            </span>
          </div>
          <div class="banner-actions">
            <button type="button" class="banner-action-btn primary" @click="toggleNotificationsDropdown">
              Review Reminders
            </button>
            <button type="button" class="banner-dismiss-btn" @click="dismissNotificationBar" aria-label="Dismiss alert">
              <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
            </button>
          </div>
        </div>
      </Transition>

      <!-- Stage tab bar - only visible in Overview list view -->
      <div class="tabs" role="tablist" aria-label="Application stages" v-if="currentView === 'Overview'">
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          class="tab-button"
          role="tab"
          :aria-selected="activeTab === tab"
          :aria-controls="`tabpanel-${tab.toLowerCase().replace(/\s+/g, '-')}`"
          :id="`tab-${tab.toLowerCase().replace(/\s+/g, '-')}`"
          :class="{ active: activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </div>

      <!-- Displays the active view with slot states -->
      <div class="table-area" :class="{ 'pipeline-view-active': currentView === 'Pipeline' }">
        <router-view v-slot="{ Component }">
          <component
            :is="Component"
            v-if="Component"
            :filtered-applications="filteredApplications"
            :applications="applications"
            :search-filtered-applications="searchFilteredApplications"
            :sort-by="sortBy"
            :sort-order="sortOrder"
            @select="openEditEntry"
            @sort="handleSort"
            @applications-changed="loadApplications"
            @update-stage="handleUpdateStage"
            @update-active-profile="handleUpdateActiveProfile"
          />
        </router-view>
      </div>
    </main>

    <!-- Slide Over Right Drawer -->
    <ApplicationDrawer
      :is-open="isDrawerOpen"
      :application="selectedApplication"
      @close="isDrawerOpen = false"
      @save="handleSave"
      @delete="handleDelete"
    />

    <!-- Toast Notification Deck -->
    <div class="toast-deck">
      <TransitionGroup name="toast-list" tag="div" class="toast-list-container">
        <Toast
          v-for="toast in toasts"
          :key="toast.id"
          :message="toast.message"
          :type="toast.type"
          @close="removeToast(toast.id)"
        />
      </TransitionGroup>
    </div>

    <!-- Mobile Bottom Navigation Bar -->
    <nav class="mobile-nav" aria-label="Mobile navigation">
      <button
        v-for="item in navItems"
        :key="item.label"
        type="button"
        class="mobile-nav-item"
        :class="{ active: item.active }"
        @click="setView(item.label as ViewLabel)"
      >
        <iconify-icon :icon="item.icon" class="mobile-nav-icon"></iconify-icon>
        <span class="mobile-nav-label">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.company-name-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.reminder-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-warning);
  font-size: 0.95rem;
  animation: pulse-bell 2s infinite ease-in-out;
}

/* -------------------------------------------------------------
 * NOTIFICATION POPUP & BELL
 * ------------------------------------------------------------- */
.notification-container {
  position: relative;
  display: inline-block;
}

.bell-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  background: rgba(23, 23, 23, 0.5);
  border: 1px solid var(--neutral-800);
  border-radius: var(--radius-md);
  color: var(--neutral-500);
  transition: color 150ms, border-color 150ms, background-color 150ms, transform 100ms;
  padding: 0;
  outline: none;
}

.bell-btn:hover {
  color: var(--neutral-100);
  border-color: var(--neutral-700);
  background: rgba(23, 23, 23, 0.8);
}

.bell-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.bell-btn:active {
  transform: scale(0.96);
}

.bell-btn.has-unread {
  color: var(--color-warning); /* Amber */
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.03);
}

.bell-btn.has-unread:hover {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.06);
}

.bell-btn-icon {
  font-size: 1.15rem;
}

.bell-badge-count {
  position: absolute;
  top: -0.35rem;
  right: -0.35rem;
  display: grid;
  place-items: center;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.25rem;
  font-size: 0.65rem;
  font-weight: 700;
  color: #ffffff;
  background: var(--color-danger); /* Vibrant Red */
  border-radius: 9999px;
  border: 1.5px solid var(--neutral-950);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  font-family: var(--font-mono);
}

/* Glassmorphism Notification Dropdown */
.notification-dropdown {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: 20rem;
  max-height: 28rem;
  background: rgba(13, 13, 13, 0.88);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(82, 82, 82, 0.2);
  border-radius: var(--radius-lg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 1px 1px rgba(255, 255, 255, 0.05) inset;
  z-index: 102;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slide-in-dropdown 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-in-dropdown {
  from { opacity: 0; transform: translateY(0.5rem) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--neutral-800);
  background: rgba(10, 10, 10, 0.4);
}

.dropdown-header h3 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #f5f5f5;
}

.due-summary {
  font-size: 0.7rem;
  font-weight: 600;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  padding: 0.1rem 0.4rem;
  border-radius: 9999px;
  text-transform: uppercase;
}

.dropdown-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 0;
  max-height: 20rem;
}

.dropdown-section {
  padding: 0 0.5rem 0.75rem;
}

.dropdown-section:last-child {
  padding-bottom: 0;
}

.section-title {
  margin: 0 0 0.35rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.overdue .section-title {
  color: #f43f5e; /* red */
}

.today .section-title {
  color: #f59e0b; /* amber */
}

.dropdown-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.notification-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border-radius: 0.375rem;
  background: rgba(23, 23, 23, 0.3);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 150ms, border-color 150ms;
}

.notification-item:hover {
  background: rgba(38, 38, 38, 0.5);
  border-color: #262626;
}

.notification-item.overdue {
  border-left: 3px solid #f43f5e;
}

.notification-item.today {
  border-left: 3px solid #f59e0b;
}

.notif-item-body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
  text-align: left;
}

.notif-company {
  font-size: 0.8rem;
  font-weight: 600;
  color: #e5e5e5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-role {
  font-size: 0.75rem;
  color: #737373;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-date {
  font-size: 0.7rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.overdue .notif-date {
  color: rgba(244, 63, 94, 0.85);
}

.today .notif-date {
  color: rgba(245, 158, 11, 0.85);
}

.notif-dismiss-btn {
  display: grid;
  place-items: center;
  background: transparent;
  border: 0;
  color: #525252;
  font-size: 1rem;
  padding: 0.25rem;
  border-radius: 0.25rem;
  transition: color 150ms, background-color 150ms;
  margin-left: 0.5rem;
}

.notif-dismiss-btn:hover {
  color: #10b981; /* Green */
  background: rgba(16, 185, 129, 0.1);
}

.dropdown-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  color: #525252;
  text-align: center;
}

.dropdown-empty-state .empty-icon {
  font-size: 1.5rem;
  color: #262626;
}

.dropdown-empty-state span {
  font-size: 0.75rem;
}

/* Footer Switch Toggle Settings */
.dropdown-footer {
  border-top: 1px solid #262626;
  padding: 0.75rem 1rem;
  background: rgba(10, 10, 10, 0.4);
}

.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  width: 100%;
}

.toggle-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #a3a3a3;
}

.toggle-switch-btn {
  position: relative;
  width: 2.25rem;
  height: 1.25rem;
  background: #262626;
  border: 1px solid #404040;
  border-radius: 999px;
  padding: 0;
  cursor: pointer;
  transition: background-color 200ms, border-color 200ms;
  outline: none;
}

.toggle-switch-btn.active {
  background: #10b981; /* Green toggle active */
  border-color: rgba(16, 185, 129, 0.2);
}

.toggle-switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 1rem;
  height: 1rem;
  background: #d4d4d4;
  border-radius: 999px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms;
}

.toggle-switch-btn.active .toggle-switch-thumb {
  transform: translateX(1rem);
  background: #ffffff;
}

.toast-deck {
  position: fixed;
  top: 1.5rem;
  right: 1.5rem;
  z-index: 101;
  pointer-events: none;
}

.toast-list-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Toast high-fidelity micro-interactions & transitions */
.toast-list-enter-active,
.toast-list-leave-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-list-enter-from {
  opacity: 0;
  transform: translateY(1rem) scale(0.95);
}

.toast-list-leave-to {
  opacity: 0;
  transform: translateX(3rem) scale(0.95);
}

/* absolute position is required on exit to allow move transition to perform smoothly */
.toast-list-leave-active {
  position: absolute !important;
  right: 0;
}

.toast-list-move {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Bullet markers for location work types in table view */
.mode-bullet {
  display: inline-block;
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 999px;
  margin-right: 0.4rem;
  vertical-align: middle;
}

.mode-bullet.remote { background-color: #10b981; }
.mode-bullet.hybrid { background-color: #f59e0b; }
.mode-bullet.on-site { background-color: #a3a3a3; }

/* Table row interactive cursor pointer */
.table-row {
  cursor: pointer;
}

/* Scroll area adjustment */
.table-area {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2rem;
}

.table-area.pipeline-view-active {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 2rem 2rem 1rem;
}

/* -------------------------------------------------------------
 * PREMIUM SORTABLE HEADERS STYLING
 * ------------------------------------------------------------- */
.header-sort-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  text-transform: inherit;
  cursor: pointer;
  transition: color 150ms ease;
  width: fit-content;
  text-align: left;
  outline: none;
}

.header-sort-btn:hover {
  color: #f5f5f5;
}

.header-sort-btn:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.date-column.header-sort-btn {
  justify-content: flex-end;
  width: 100%;
}

.sort-icon {
  font-size: 0.85rem;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms ease, color 150ms ease;
}

.sort-icon.active {
  color: #3b82f6; /* Modern Vibrant Blue accent for active column sort */
  opacity: 1;
}

.sort-icon.placeholder {
  opacity: 0;
}

.header-sort-btn:hover .sort-icon.placeholder {
  opacity: 0.45;
  color: #a3a3a3;
}

/* Glassmorphic Reminder Banner Styling */
.reminder-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.5rem 2rem 0;
  padding: 0.85rem 1.25rem;
  background: rgba(245, 158, 11, 0.08);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 0.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2), 0 1px 0 rgba(255, 255, 255, 0.05) inset;
  z-index: 5;
}

.banner-body {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.banner-icon-container {
  display: grid;
  place-items: center;
  color: #f59e0b;
  font-size: 1.25rem;
}

.bell-pulse-icon {
  animation: pulse-bell 2s infinite ease-in-out;
}

.banner-message {
  color: #e5e5e5;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.4;
}

.count-overdue {
  color: #f43f5e;
  font-weight: 600;
}

.count-today {
  color: #f59e0b;
  font-weight: 600;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.banner-action-btn {
  padding: 0.35rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 150ms ease;
  outline: none;
}

.banner-action-btn.primary {
  background: #f59e0b;
  color: #0a0a0a;
}

.banner-action-btn.primary:hover {
  background: #d97706;
  transform: translateY(-1px);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);
}

.banner-dismiss-btn {
  display: grid;
  place-items: center;
  background: transparent;
  border: 0;
  color: #737373;
  font-size: 1.15rem;
  padding: 0.2rem;
  border-radius: 0.25rem;
  transition: color 150ms, background-color 150ms;
}

.banner-dismiss-btn:hover {
  color: #e5e5e5;
  background: rgba(255, 255, 255, 0.05);
}

/* Slide Down Transition Animations */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateY(-1rem);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-1rem);
}

@media (max-width: 720px) {
  .reminder-banner {
    margin: 1rem 1rem 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.85rem;
  }
  
  .banner-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
