<script setup lang="ts">
import { computed, ref } from 'vue';
import type { JobApplication, Stage } from '../types';
import { STAGES as stages, STAGE_ICONS as stageIcons } from '../constants';
import { getTodayString, isReminderDue, stageClass } from '../utils';

const props = defineProps<{
  applications: JobApplication[];
}>();

const emit = defineEmits<{
  (e: 'select', app: JobApplication): void;
  (e: 'update-stage', id: string, stage: Stage): void;
}>();

// Drag and Drop Reactive State
const draggedAppId = ref<string | null>(null);
const activeDropStage = ref<Stage | null>(null);

// Group applications by stage
const columns = computed(() => {
  const groups = stages.reduce(
    (acc, stage) => {
      acc[stage] = [];
      return acc;
    },
    {} as Record<Stage, JobApplication[]>
  );

  props.applications.forEach((app) => {
    if (groups[app.stage]) {
      groups[app.stage].push(app);
    } else {
      // fallback
      groups['Applied'].push(app);
    }
  });

  return groups;
});

// Returns the index of a stage, to move items left or right
function moveStage(app: JobApplication, direction: 'prev' | 'next') {
  const currentIndex = stages.indexOf(app.stage);
  if (direction === 'prev' && currentIndex > 0) {
    emit('update-stage', app.id, stages[currentIndex - 1]);
  } else if (direction === 'next' && currentIndex < stages.length - 1) {
    emit('update-stage', app.id, stages[currentIndex + 1]);
  }
}

function getCompletedChecklistCount(app: JobApplication) {
  if (!app.checklist || app.checklist.length === 0) return { completed: 0, total: 0 };
  const completed = app.checklist.filter((item) => item.done).length;
  return { completed, total: app.checklist.length };
}

// Drag & Drop Operations
function onDragStart(event: DragEvent, app: JobApplication) {
  draggedAppId.value = app.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', app.id);
  }
  // Delay adding drag-active class slightly to let browser capture solid card as drag ghost
  setTimeout(() => {
    const el = document.getElementById(`card-${app.id}`);
    if (el) el.classList.add('is-dragging');
  }, 0);
}

function onDragEnd() {
  const el = draggedAppId.value ? document.getElementById(`card-${draggedAppId.value}`) : null;
  if (el) el.classList.remove('is-dragging');
  draggedAppId.value = null;
  activeDropStage.value = null;
}

function onDragOver(event: DragEvent, stage: Stage) {
  // Prevent default to allow drop
  event.preventDefault();
}

function onDragEnter(event: DragEvent, stage: Stage) {
  event.preventDefault();
  activeDropStage.value = stage;
}

function onDragLeave(event: DragEvent, stage: Stage) {
  if (activeDropStage.value === stage) {
    activeDropStage.value = null;
  }
}

function onDrop(event: DragEvent, stage: Stage) {
  event.preventDefault();
  const appId = event.dataTransfer?.getData('text/plain') || draggedAppId.value;
  if (appId) {
    const app = props.applications.find((a) => a.id === appId);
    if (app && app.stage !== stage) {
      emit('update-stage', appId, stage);
    }
  }
  onDragEnd();
}


</script>

<template>
  <div class="pipeline-board" :class="{ 'drag-active': draggedAppId !== null }">
    <div
      v-for="stage in stages"
      :key="stage"
      class="pipeline-column"
      :class="{
        'drag-over': activeDropStage === stage,
        ['drag-over-' + stageClass(stage)]: activeDropStage === stage
      }"
      @dragover="onDragOver($event, stage)"
      @dragenter.prevent="onDragEnter($event, stage)"
      @dragleave="onDragLeave($event, stage)"
      @drop="onDrop($event, stage)"
    >
      <header class="column-header">
        <div class="column-title-group">
          <iconify-icon :icon="stageIcons[stage]" class="column-icon" :class="`icon-${stageClass(stage)}`"></iconify-icon>
          <h3>{{ stage }}</h3>
        </div>
        <span class="column-count">{{ columns[stage].length }}</span>
      </header>

      <div class="column-cards">
        <article
          v-for="app in columns[stage]"
          :key="app.id"
          :id="`card-${app.id}`"
          class="job-card"
          :class="{ 'is-dragging': draggedAppId === app.id }"
          draggable="true"
          @dragstart="onDragStart($event, app)"
          @dragend="onDragEnd"
          tabindex="0"
          role="button"
          :aria-label="`View details for ${app.company}, role ${app.role}`"
          @click="emit('select', app)"
          @keydown.enter.prevent="emit('select', app)"
          @keydown.space.prevent="emit('select', app)"
        >
          <div class="card-header">
            <div class="card-company-wrapper">
              <span class="card-company">{{ app.company }}</span>
              <span v-if="isReminderDue(app)" class="card-reminder-badge" title="Follow-up due!">
                <iconify-icon icon="solar:bell-bing-bold-duotone"></iconify-icon>
              </span>
            </div>
            <span class="card-date">{{ app.date }}</span>
          </div>

          <h4 class="card-role">{{ app.role }}</h4>

          <div class="card-meta">
            <span class="card-tag work-mode" :class="app.workMode.toLowerCase()">
              {{ app.workMode }}
            </span>
            <span v-if="app.location" class="card-location">{{ app.location }}</span>
          </div>

          <div class="card-footer">
            <span class="card-salary" v-if="app.salary && app.salary !== 'TBD'">
              {{ app.salary }}
            </span>
            <span class="card-salary tbd" v-else>TBD</span>

            <!-- Checklist indicators -->
            <div
              v-if="app.checklist && app.checklist.length > 0"
              class="card-checklist-badge"
              :class="{ 'all-done': getCompletedChecklistCount(app).completed === getCompletedChecklistCount(app).total }"
            >
              <iconify-icon icon="solar:clipboard-list-linear"></iconify-icon>
              <span>
                {{ getCompletedChecklistCount(app).completed }}/{{ getCompletedChecklistCount(app).total }}
              </span>
            </div>
          </div>

          <!-- Quick Move stage actions -->
          <div class="card-actions" @click.stop>
            <button
              type="button"
              class="quick-move-btn"
              :disabled="stages.indexOf(stage) === 0"
              @click="moveStage(app, 'prev')"
              aria-label="Move stage backward"
              title="Move backward"
            >
              <iconify-icon icon="solar:arrow-left-linear"></iconify-icon>
            </button>
            <button
              type="button"
              class="quick-move-btn"
              :disabled="stages.indexOf(stage) === stages.length - 1"
              @click="moveStage(app, 'next')"
              aria-label="Move stage forward"
              title="Move forward"
            >
              <iconify-icon icon="solar:arrow-right-linear"></iconify-icon>
            </button>
          </div>
        </article>

        <!-- Column Empty state -->
        <div v-if="columns[stage].length === 0" class="column-empty">
          <iconify-icon icon="solar:folder-empty-linear"></iconify-icon>
          <span>Empty stage</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-company-wrapper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}

.card-reminder-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-warning);
  font-size: 0.95rem;
  animation: pulse-bell 2s infinite ease-in-out;
}

.pipeline-board {
  display: grid;
  grid-template-columns: repeat(5, minmax(18rem, 1fr));
  grid-template-rows: 100%;
  gap: 1.25rem;
  height: 100%;
  min-height: 0;
  overflow-x: auto;
  align-items: stretch;
  
  /* Firefox Scrollbar Styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(82, 82, 82, 0.25) transparent;
}

/* Custom Horizontal Scrollbar for WebKit (Chrome, Safari, Edge) */
.pipeline-board::-webkit-scrollbar {
  height: 8px; /* Perfectly sized for horizontal scroll grabbing */
}

.pipeline-board::-webkit-scrollbar-track {
  background: transparent;
}

.pipeline-board::-webkit-scrollbar-thumb {
  background: rgba(82, 82, 82, 0.15);
  border-radius: 999px;
  border: 2px solid transparent; /* Padding effect */
  background-clip: padding-box;
  transition: background-color var(--transition-speed-normal) var(--transition-ease);
}

.pipeline-board:hover::-webkit-scrollbar-thumb {
  background: rgba(82, 82, 82, 0.45);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* Prevent drag flickering by turning off pointer events on all column descendants during active drag, making the column a single solid dropzone */
.pipeline-board.drag-active .pipeline-column * {
  pointer-events: none;
}

.pipeline-column {
  position: relative;
  background: rgba(13, 13, 13, 0.4);
  border: 1px solid #262626;
  border-radius: 0.5rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: background-color 250ms cubic-bezier(0.16, 1, 0.3, 1),
              border-color 250ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 250ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Board receptive state when dragging is active */
.pipeline-board.drag-active .pipeline-column {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(13, 13, 13, 0.2);
}

/* Inner dropzone border overlay */
.pipeline-board.drag-active .pipeline-column::after {
  content: '';
  position: absolute;
  inset: 0.5rem;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 0.375rem;
  pointer-events: none;
  transition: opacity 250ms cubic-bezier(0.16, 1, 0.3, 1),
              border-color 250ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 250ms cubic-bezier(0.16, 1, 0.3, 1);
  opacity: 0.6;
  z-index: 10;
}

.pipeline-board.drag-active .pipeline-column.drag-over::after {
  opacity: 1;
  border-style: solid;
  border-width: 1.5px;
}

/* Hover effects for dragging over columns */
.pipeline-column.drag-over {
  transform: translateY(-4px) scale(1.005);
  border-style: solid;
}

/* Stage-specific radial gradient glows and outline styling */
.pipeline-column.drag-over-applied {
  background: radial-gradient(circle at top, rgba(163, 163, 163, 0.12), rgba(13, 13, 13, 0.6));
  border-color: rgba(163, 163, 163, 0.6);
  box-shadow: 0 12px 40px rgba(163, 163, 163, 0.15), inset 0 0 12px rgba(163, 163, 163, 0.05);
  color: var(--stage-applied-color);
}
.pipeline-column.drag-over-applied::after {
  border-color: rgba(163, 163, 163, 0.5);
  box-shadow: 0 0 15px rgba(163, 163, 163, 0.15);
}

.pipeline-column.drag-over-takehome {
  background: radial-gradient(circle at top, rgba(59, 130, 246, 0.15), rgba(13, 13, 13, 0.6));
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 12px 40px rgba(59, 130, 246, 0.2), inset 0 0 12px rgba(59, 130, 246, 0.05);
  color: var(--stage-takehome-color);
}
.pipeline-column.drag-over-takehome::after {
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.2);
}

.pipeline-column.drag-over-interview {
  background: radial-gradient(circle at top, rgba(245, 158, 11, 0.15), rgba(13, 13, 13, 0.6));
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: 0 12px 40px rgba(245, 158, 11, 0.2), inset 0 0 12px rgba(245, 158, 11, 0.05);
  color: var(--stage-interview-color);
}
.pipeline-column.drag-over-interview::after {
  border-color: rgba(245, 158, 11, 0.5);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.2);
}

.pipeline-column.drag-over-offer {
  background: radial-gradient(circle at top, rgba(16, 185, 129, 0.18), rgba(13, 13, 13, 0.6));
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 12px 40px rgba(16, 185, 129, 0.25), inset 0 0 12px rgba(16, 185, 129, 0.05);
  color: var(--stage-offer-color);
}
.pipeline-column.drag-over-offer::after {
  border-color: rgba(16, 185, 129, 0.5);
  box-shadow: 0 0 15px rgba(16, 185, 129, 0.25);
}

.pipeline-column.drag-over-rejected {
  background: radial-gradient(circle at top, rgba(244, 63, 94, 0.15), rgba(13, 13, 13, 0.6));
  border-color: rgba(244, 63, 94, 0.6);
  box-shadow: 0 12px 40px rgba(244, 63, 94, 0.2), inset 0 0 12px rgba(244, 63, 94, 0.05);
  color: var(--stage-rejected-color);
}
.pipeline-column.drag-over-rejected::after {
  border-color: rgba(244, 63, 94, 0.5);
  box-shadow: 0 0 15px rgba(244, 63, 94, 0.2);
}

/* Drag hover micro-interactions for header elements */
.pipeline-column.drag-over .column-title-group {
  transform: scale(1.05);
}
.pipeline-column.drag-over .column-icon {
  animation: icon-float 0.8s cubic-bezier(0.25, 1, 0.5, 1) infinite alternate;
}
.pipeline-column.drag-over .column-count {
  background: currentColor;
  color: var(--neutral-950);
  box-shadow: 0 0 10px currentColor;
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid #262626;
  background: rgba(10, 10, 10, 0.5);
  border-top-left-radius: 0.5rem;
  border-top-right-radius: 0.5rem;
}

.column-title-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.column-header h3 {
  margin: 0;
  color: #e5e5e5;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.column-icon {
  font-size: 1rem;
}

.icon-applied { color: #a3a3a3; }
.icon-takehome { color: #3b82f6; }
.icon-interview { color: #f59e0b; }
.icon-offer { color: #10b981; }
.icon-rejected { color: #f43f5e; }

.column-count {
  background: #262626;
  color: #a3a3a3;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  transition: background-color 250ms cubic-bezier(0.16, 1, 0.3, 1),
              color 250ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.column-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.job-card {
  position: relative;
  background: rgba(23, 23, 23, 0.5);
  border: 1px solid #262626;
  border-radius: 0.375rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  cursor: grab;
  transition: border-color 200ms cubic-bezier(0.16, 1, 0.3, 1),
              background-color 200ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.job-card:active {
  cursor: grabbing;
}

.job-card.is-dragging {
  opacity: 0.25;
  border-style: dashed;
  border-color: #737373;
  background: rgba(13, 13, 13, 0.3);
  transform: scale(0.95);
  box-shadow: none;
}

.job-card:hover {
  background: rgba(23, 23, 23, 0.8);
  border-color: #404040;
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.card-company-wrapper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}

.card-company {
  color: #f5f5f5;
  font-weight: 600;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.card-reminder-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-warning);
  font-size: 0.95rem;
  animation: pulse-bell 2s infinite ease-in-out;
}

.card-date {
  color: #525252;
  font-size: 0.7rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.card-role {
  margin: 0;
  color: #a3a3a3;
  font-size: 0.875rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.card-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  text-transform: uppercase;
}

.work-mode.remote {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.work-mode.hybrid {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.work-mode.on-site {
  color: #a3a3a3;
  background: rgba(163, 163, 163, 0.1);
  border: 1px solid rgba(163, 163, 163, 0.2);
}

.card-location {
  color: #525252;
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 10rem;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
  border-top: 1px solid rgba(38, 38, 38, 0.5);
  padding-top: 0.5rem;
}

.card-salary {
  color: #737373;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
}

.card-salary.tbd {
  color: #404040;
}

.card-checklist-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  color: #737373;
  background: #171717;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  border: 1px solid #262626;
}

.card-checklist-badge.all-done {
  color: #10b981;
  background: rgba(16, 185, 129, 0.05);
  border-color: rgba(16, 185, 129, 0.2);
}

.card-checklist-badge iconify-icon {
  font-size: 0.8rem;
}

.card-actions {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  justify-content: space-between;
  padding: 0 0.5rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms;
}

.job-card:hover .card-actions {
  opacity: 1;
}

.quick-move-btn {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  background: #171717;
  border: 1px solid #404040;
  border-radius: 999px;
  color: #a3a3a3;
  font-size: 0.9rem;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  transition: color 150ms, background-color 150ms, border-color 150ms;
  position: relative;
}

.quick-move-btn::after {
  content: '';
  position: absolute;
  top: -10px;
  bottom: -10px;
  left: -10px;
  right: -10px;
}

.quick-move-btn:hover:not(:disabled) {
  color: #f5f5f5;
  background: #262626;
  border-color: #737373;
}

.quick-move-btn:disabled {
  opacity: 0;
  pointer-events: none;
}

.column-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: #404040;
  font-size: 0.75rem;
  border: 1px dashed #262626;
  border-radius: 0.375rem;
}

.column-empty iconify-icon {
  font-size: 1.5rem;
}

/* Global Keyframes for Floating Icon & Reminder Bell */
@keyframes icon-float {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-4px);
  }
}
</style>
