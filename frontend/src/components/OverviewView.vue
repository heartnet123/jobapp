<script setup lang="ts">
import type { JobApplication, Stage } from '@jobapp/shared';
import { STAGE_ICONS } from '@jobapp/shared';
import { isReminderDue, stageClass } from '../utils';

defineProps<{
  filteredApplications: JobApplication[];
  sortBy: 'company' | 'stage' | 'location' | 'salary' | 'date';
  sortOrder: 'asc' | 'desc';
}>();

const emit = defineEmits<{
  (e: 'select', app: JobApplication): void;
  (e: 'sort', key: 'company' | 'stage' | 'location' | 'salary' | 'date'): void;
}>();

function openEditEntry(app: JobApplication) {
  emit('select', app);
}

function handleSort(key: 'company' | 'stage' | 'location' | 'salary' | 'date') {
  emit('sort', key);
}
</script>

<template>
  <div class="application-table">
    <div class="table-header">
      <button
        type="button"
        class="company-column header-sort-btn"
        @click="handleSort('company')"
        :aria-sort="sortBy === 'company' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"
      >
        <span>Company &amp; Role</span>
        <iconify-icon
          v-if="sortBy === 'company'"
          :icon="sortOrder === 'asc' ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'"
          class="sort-icon active"
        ></iconify-icon>
        <iconify-icon
          v-else
          icon="solar:alt-arrow-down-linear"
          class="sort-icon placeholder"
        ></iconify-icon>
      </button>
      <button
        type="button"
        class="stage-column header-sort-btn"
        @click="handleSort('stage')"
        :aria-sort="sortBy === 'stage' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"
      >
        <span>Stage</span>
        <iconify-icon
          v-if="sortBy === 'stage'"
          :icon="sortOrder === 'asc' ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'"
          class="sort-icon active"
        ></iconify-icon>
        <iconify-icon
          v-else
          icon="solar:alt-arrow-down-linear"
          class="sort-icon placeholder"
        ></iconify-icon>
      </button>
      <button
        type="button"
        class="location-column header-sort-btn"
        @click="handleSort('location')"
        :aria-sort="sortBy === 'location' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"
      >
        <span>Location</span>
        <iconify-icon
          v-if="sortBy === 'location'"
          :icon="sortOrder === 'asc' ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'"
          class="sort-icon active"
        ></iconify-icon>
        <iconify-icon
          v-else
          icon="solar:alt-arrow-down-linear"
          class="sort-icon placeholder"
        ></iconify-icon>
      </button>
      <button
        type="button"
        class="salary-column header-sort-btn"
        @click="handleSort('salary')"
        :aria-sort="sortBy === 'salary' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"
      >
        <span>Salary</span>
        <iconify-icon
          v-if="sortBy === 'salary'"
          :icon="sortOrder === 'asc' ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'"
          class="sort-icon active"
        ></iconify-icon>
        <iconify-icon
          v-else
          icon="solar:alt-arrow-down-linear"
          class="sort-icon placeholder"
        ></iconify-icon>
      </button>
      <button
        type="button"
        class="date-column header-sort-btn"
        @click="handleSort('date')"
        :aria-sort="sortBy === 'date' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"
      >
        <span>Last Updated</span>
        <iconify-icon
          v-if="sortBy === 'date'"
          :icon="sortOrder === 'asc' ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'"
          class="sort-icon active"
        ></iconify-icon>
        <iconify-icon
          v-else
          icon="solar:alt-arrow-down-linear"
          class="sort-icon placeholder"
        ></iconify-icon>
      </button>
      <div class="action-column"></div>
    </div>

    <div class="table-body">
      <article
        v-for="application in filteredApplications"
        :key="application.id"
        class="table-row"
        tabindex="0"
        role="button"
        :aria-label="`Edit ${application.company} application for ${application.role}`"
        @click="openEditEntry(application)"
        @keydown.enter.prevent="openEditEntry(application)"
        @keydown.space.prevent="openEditEntry(application)"
      >
        <div class="company-column company-cell">
          <div class="company-name-wrapper">
            <span class="company-name">{{ application.company }}</span>
            <span v-if="isReminderDue(application)" class="reminder-badge" title="Follow-up due!">
              <iconify-icon icon="solar:bell-bing-bold-duotone"></iconify-icon>
            </span>
          </div>
          <span class="role-name">{{ application.role }}</span>
        </div>

        <div class="stage-column stage-cell">
          <span class="stage-pill" :class="'stage-' + stageClass(application.stage)">
            <iconify-icon :icon="STAGE_ICONS[application.stage]"></iconify-icon>
            <span>{{ application.stage }}</span>
          </span>
        </div>

        <div class="location-column muted-cell">
          <span class="mode-bullet" :class="application.workMode.toLowerCase()"></span>
          <span>{{ application.location || 'Remote' }}</span>
        </div>

        <div class="salary-column mono-cell">
          {{ application.salary || 'TBD' }}
        </div>

        <div class="date-column date-cell">
          <span>{{ application.date }}</span>
          <span>{{ application.id }}</span>
        </div>

        <div class="mobile-date">{{ application.date }}</div>

        <div class="action-column action-cell">
          <button type="button" aria-label="More actions" @click.stop="openEditEntry(application)">
            <iconify-icon icon="solar:menu-dots-bold"></iconify-icon>
          </button>
        </div>
      </article>

      <!-- Table empty state -->
      <div v-if="filteredApplications.length === 0" class="empty-state">
        <iconify-icon icon="solar:ghost-linear"></iconify-icon>
        <span>No applications found matching your criteria.</span>
      </div>
    </div>
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

/* Premium Sortable Headers Styling */
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
  color: #3b82f6;
  opacity: 1;
}

.sort-icon.placeholder {
  opacity: 0;
}

.header-sort-btn:hover .sort-icon.placeholder {
  opacity: 0.45;
  color: #a3a3a3;
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

@keyframes pulse-bell {
  0% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
    filter: drop-shadow(0 0 4px rgba(245, 158, 11, 0.6));
  }
  100% {
    transform: scale(1);
    opacity: 0.8;
  }
}
</style>
