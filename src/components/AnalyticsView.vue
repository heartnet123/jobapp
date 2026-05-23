<script setup lang="ts">
import { computed } from 'vue';
import type { JobApplication, Stage } from '../types';
import { STAGES } from '../constants';


const props = defineProps<{
  applications: JobApplication[];
}>();

// Helper to count by stage
const countStage = (stage: Stage) => {
  return props.applications.filter((app) => app.stage === stage).length;
};

// Calculations
const total = computed(() => props.applications.length);

const stats = computed(() => {
  const t = total.value || 1;
  const appliedCount = countStage('Applied');
  const takehomeCount = countStage('Take-home');
  const interviewCount = countStage('Interview');
  const offerCount = countStage('Offer');
  const rejectedCount = countStage('Rejected');

  // We define "interview rate" as: (Interview + Offer + Rejected (if reached interview)) / total
  // For simplicity, let's count actual Interview and Offer counts as success indicators
  const interviewRate = Math.round(((interviewCount + offerCount) / t) * 100);
  const offerRate = Math.round((offerCount / t) * 100);
  const rejectionRate = Math.round((rejectedCount / t) * 100);

  return {
    applied: appliedCount,
    takehome: takehomeCount,
    interview: interviewCount,
    offer: offerCount,
    rejected: rejectedCount,
    interviewRate,
    offerRate,
    rejectionRate,
  };
});

// SVG Donut Chart Slices
const donutSlices = computed(() => {
  const t = total.value;
  if (t === 0) return [];

  const stagesOrder = STAGES;
  const colors = {
    Applied: 'var(--stage-applied-color)',
    'Take-home': 'var(--stage-takehome-color)',
    Interview: 'var(--stage-interview-color)',
    Offer: 'var(--stage-offer-color)',
    Rejected: 'var(--stage-rejected-color)',
  };

  let accumulatedPercent = 0;
  const radius = 50;
  const circumference = 2 * Math.PI * radius;

  return stagesOrder
    .map((stage) => {
      const count = countStage(stage);
      const percent = count / t;
      const strokeDasharray = `${percent * circumference} ${circumference}`;
      const strokeDashoffset = -accumulatedPercent * circumference;

      accumulatedPercent += percent;

      return {
        stage,
        count,
        percent: Math.round(percent * 100),
        color: colors[stage],
        strokeDasharray,
        strokeDashoffset,
      };
    })
    .filter((slice) => slice.count > 0);
});

// Hot opportunities (Offers or Interviews)
const hotOpportunities = computed(() => {
  return props.applications.filter((app) => app.stage === 'Offer' || app.stage === 'Interview');
});

// Dynamic accessible label for screen readers to describe the donut chart breakdown
const donutAriaLabel = computed(() => {
  if (total.value === 0) return 'Donut chart showing 0 job applications';
  const slicesDescription = donutSlices.value
    .map((slice) => `${slice.stage}: ${slice.count} (${slice.percent}%)`)
    .join(', ');
  return `Donut chart showing stage distribution of ${total.value} job applications: ${slicesDescription}`;
});
</script>

<template>
  <div class="analytics-dashboard">
    <!-- Stat grid -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon-wrapper applied">
          <iconify-icon icon="solar:folder-open-linear"></iconify-icon>
        </div>
        <div class="stat-info">
          <span class="stat-label">Total Tracked</span>
          <span class="stat-value">{{ total }}</span>
        </div>
        <div class="stat-badge">Active</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon-wrapper interview">
          <iconify-icon icon="solar:calendar-mark-linear"></iconify-icon>
        </div>
        <div class="stat-info">
          <span class="stat-label">Interview Rate</span>
          <span class="stat-value">{{ stats.interviewRate }}%</span>
        </div>
        <div class="stat-badge success" v-if="stats.interviewRate >= 40">Strong</div>
        <div class="stat-badge" v-else>Progress</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon-wrapper offer">
          <iconify-icon icon="solar:cup-bold-linear"></iconify-icon>
        </div>
        <div class="stat-info">
          <span class="stat-label">Offer Rate</span>
          <span class="stat-value">{{ stats.offerRate }}%</span>
        </div>
        <div class="stat-badge emerald" v-if="stats.offerRate > 0">Winner</div>
        <div class="stat-badge" v-else>Searching</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon-wrapper rejected">
          <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
        </div>
        <div class="stat-info">
          <span class="stat-label">Rejection Rate</span>
          <span class="stat-value">{{ stats.rejectionRate }}%</span>
        </div>
        <div class="stat-badge warning">Normal</div>
      </div>
    </div>

    <!-- Charts & Lists -->
    <div class="analytics-layout">
      <!-- Donut Chart Card -->
      <div class="analytics-card chart-card">
        <header class="card-header">
          <h3>Stage Distribution</h3>
        </header>

        <div class="donut-chart-container" v-if="total > 0">
          <div class="svg-wrapper">
            <svg viewBox="0 0 120 120" width="100%" height="100%" role="img" :aria-label="donutAriaLabel">
              <circle cx="60" cy="60" r="50" fill="transparent" stroke="#1f1f1f" stroke-width="12" />
              <circle
                v-for="slice in donutSlices"
                :key="slice.stage"
                cx="60"
                cy="60"
                r="50"
                fill="transparent"
                :stroke="slice.color"
                stroke-width="12"
                :stroke-dasharray="slice.strokeDasharray"
                :stroke-dashoffset="slice.strokeDashoffset"
                transform="rotate(-90, 60, 60)"
                stroke-linecap="round"
                class="donut-segment"
              />
            </svg>
            <div class="chart-center">
              <span class="center-value">{{ total }}</span>
              <span class="center-label">Jobs</span>
            </div>
          </div>

          <div class="donut-legend">
            <div
              v-for="slice in donutSlices"
              :key="slice.stage"
              class="legend-item"
            >
              <div class="legend-color-dot" :style="{ backgroundColor: slice.color }"></div>
              <span class="legend-name">{{ slice.stage }}</span>
              <span class="legend-count">{{ slice.count }}</span>
              <span class="legend-percent">{{ slice.percent }}%</span>
            </div>
          </div>
        </div>

        <div v-else class="empty-chart">
          <iconify-icon icon="solar:pie-chart-linear"></iconify-icon>
          <span>Add applications to see visual analytics</span>
        </div>
      </div>

      <!-- Funnel Progress -->
      <div class="analytics-card funnel-card">
        <header class="card-header">
          <h3>Application Pipeline Funnel</h3>
        </header>

        <div class="funnel-container" v-if="total > 0">
          <!-- Applied -->
          <div class="funnel-row">
            <div class="funnel-label-group">
              <span class="funnel-step">Applied</span>
              <span class="funnel-count">{{ stats.applied + stats.takehome + stats.interview + stats.offer + stats.rejected }}</span>
            </div>
            <div class="funnel-bar-outer">
              <div class="funnel-bar-inner applied" style="width: 100%"></div>
            </div>
            <span class="funnel-percent">100%</span>
          </div>

          <!-- Take-home -->
          <div class="funnel-row">
            <div class="funnel-label-group">
              <span class="funnel-step">Take-homes</span>
              <span class="funnel-count">{{ stats.takehome + stats.interview + stats.offer }}</span>
            </div>
            <div class="funnel-bar-outer">
              <div
                class="funnel-bar-inner takehome"
                :style="{ width: `${Math.round(((stats.takehome + stats.interview + stats.offer) / (total || 1)) * 100)}%` }"
              ></div>
            </div>
            <span class="funnel-percent">
              {{ Math.round(((stats.takehome + stats.interview + stats.offer) / (total || 1)) * 100) }}%
            </span>
          </div>

          <!-- Interview -->
          <div class="funnel-row">
            <div class="funnel-label-group">
              <span class="funnel-step">Interviews</span>
              <span class="funnel-count">{{ stats.interview + stats.offer }}</span>
            </div>
            <div class="funnel-bar-outer">
              <div
                class="funnel-bar-inner interview"
                :style="{ width: `${Math.round(((stats.interview + stats.offer) / (total || 1)) * 100)}%` }"
              ></div>
            </div>
            <span class="funnel-percent">
              {{ Math.round(((stats.interview + stats.offer) / (total || 1)) * 100) }}%
            </span>
          </div>

          <!-- Offer -->
          <div class="funnel-row">
            <div class="funnel-label-group">
              <span class="funnel-step">Offers</span>
              <span class="funnel-count">{{ stats.offer }}</span>
            </div>
            <div class="funnel-bar-outer">
              <div
                class="funnel-bar-inner offer"
                :style="{ width: `${Math.round((stats.offer / (total || 1)) * 100)}%` }"
              ></div>
            </div>
            <span class="funnel-percent">
              {{ Math.round((stats.offer / (total || 1)) * 100) }}%
            </span>
          </div>
        </div>

        <div v-else class="empty-chart">
          <iconify-icon icon="solar:align-bottom-linear"></iconify-icon>
          <span>Funnel charts populate dynamically as you progress.</span>
        </div>
      </div>
    </div>

    <!-- Active High-Value Opportunities -->
    <div class="hot-opportunities-section">
      <header class="card-header">
        <h3>Hot Opportunities (Interviews &amp; Offers)</h3>
        <span class="hot-count">{{ hotOpportunities.length }} High Interest</span>
      </header>

      <div class="hot-grid" v-if="hotOpportunities.length > 0">
        <div v-for="app in hotOpportunities" :key="app.id" class="hot-card">
          <div class="hot-card-info">
            <span class="hot-company">{{ app.company }}</span>
            <span class="hot-role">{{ app.role }}</span>
            <span class="hot-salary" v-if="app.salary">{{ app.salary }}</span>
          </div>

          <div class="hot-card-status">
            <span class="stage-pill" :class="`stage-${app.stage.toLowerCase().replace(/\s+/g, '-').replace('-home', 'home')}`">
              <iconify-icon
                :icon="app.stage === 'Offer' ? 'solar:cup-bold' : 'solar:calendar-bold'"
              ></iconify-icon>
              <span>{{ app.stage }}</span>
            </span>
            <span class="hot-loc">{{ app.location || 'Remote' }}</span>
          </div>
        </div>
      </div>

      <div v-else class="hot-empty">
        <iconify-icon icon="solar:stars-line-duotone"></iconify-icon>
        <span>No applications in Interview or Offer stages yet. Keep pushing!</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analytics-dashboard {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  overflow-y: auto;
  padding-bottom: 2rem;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.25rem;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: rgba(13, 13, 13, 0.4);
  border: 1px solid #262626;
  border-radius: 0.5rem;
  padding: 1.25rem;
  position: relative;
  overflow: hidden;
}

.stat-icon-wrapper {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.375rem;
  font-size: 1.25rem;
}

.stat-icon-wrapper.applied {
  background: rgba(115, 115, 115, 0.1);
  color: #a3a3a3;
  border: 1px solid rgba(115, 115, 115, 0.2);
}

.stat-icon-wrapper.interview {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.stat-icon-wrapper.offer {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.stat-icon-wrapper.rejected {
  background: rgba(244, 63, 94, 0.1);
  color: #f43f5e;
  border: 1px solid rgba(244, 63, 94, 0.2);
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  color: #737373;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.stat-value {
  color: #f5f5f5;
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 0.1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.stat-badge {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  font-size: 0.65rem;
  font-weight: 600;
  color: #737373;
  background: #171717;
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
  border: 1px solid #262626;
  text-transform: uppercase;
}

.stat-badge.success {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.2);
}

.stat-badge.emerald {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
}

.stat-badge.warning {
  color: #a3a3a3;
}

.analytics-layout {
  display: grid;
  grid-template-columns: 1.2fr 1.8fr;
  gap: 1.25rem;
}

.analytics-card {
  background: rgba(13, 13, 13, 0.4);
  border: 1px solid #262626;
  border-radius: 0.5rem;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.card-header h3 {
  margin: 0;
  color: #f5f5f5;
  font-size: 1rem;
  font-weight: 600;
}

.donut-chart-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2rem;
}

.svg-wrapper {
  position: relative;
  width: 9rem;
  height: 9rem;
  flex: 0 0 9rem;
}

.donut-segment {
  transition: stroke-dashoffset 0.35s ease;
}

.chart-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.center-value {
  color: #f5f5f5;
  font-size: 1.75rem;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.center-label {
  color: #737373;
  font-size: 0.75rem;
  text-transform: uppercase;
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.legend-color-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
}

.legend-name {
  color: #a3a3a3;
  flex: 1;
}

.legend-count {
  color: #525252;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  margin-right: 0.5rem;
}

.legend-percent {
  color: #e5e5e5;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  min-width: 2.25rem;
  text-align: right;
}

.empty-chart {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 4rem 1.5rem;
  color: #404040;
  text-align: center;
  font-size: 0.85rem;
  border: 1px dashed #262626;
  border-radius: 0.375rem;
}

.empty-chart iconify-icon {
  font-size: 2rem;
}

/* Funnel Styling */
.funnel-container {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.funnel-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.funnel-label-group {
  width: 7.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
}

.funnel-step {
  color: #a3a3a3;
  font-weight: 500;
}

.funnel-count {
  color: #525252;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  margin-right: 0.5rem;
}

.funnel-bar-outer {
  flex: 1;
  height: 0.6rem;
  background: #171717;
  border-radius: 9999px;
  overflow: hidden;
  border: 1px solid #262626;
}

.funnel-bar-inner {
  height: 100%;
  border-radius: 9999px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.funnel-bar-inner.applied { background: #737373; }
.funnel-bar-inner.takehome { background: #3b82f6; }
.funnel-bar-inner.interview { background: #f59e0b; }
.funnel-bar-inner.offer { background: #10b981; }

.funnel-percent {
  width: 2.5rem;
  text-align: right;
  color: #f5f5f5;
  font-weight: 600;
  font-size: 0.8rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Hot opportunities Styling */
.hot-opportunities-section {
  background: rgba(13, 13, 13, 0.4);
  border: 1px solid #262626;
  border-radius: 0.5rem;
  padding: 1.5rem;
}

.hot-opportunities-section .card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.hot-count {
  color: #f59e0b;
  font-size: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-weight: 600;
}

.hot-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.hot-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(23, 23, 23, 0.5);
  border: 1px solid #262626;
  border-radius: 0.375rem;
  padding: 0.85rem 1rem;
  transition: border-color 150ms;
}

.hot-card:hover {
  border-color: #404040;
}

.hot-card-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.hot-company {
  color: #f5f5f5;
  font-weight: 600;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-role {
  color: #737373;
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-salary {
  color: #a3a3a3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  margin-top: 0.15rem;
}

.hot-card-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
}

.stage-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
}

.stage-interview {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.2);
}

.stage-offer {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
}

.hot-loc {
  color: #525252;
  font-size: 0.7rem;
}

.hot-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #404040;
  font-size: 0.8rem;
  padding: 2.5rem;
  border: 1px dashed #262626;
  border-radius: 0.375rem;
}

.hot-empty iconify-icon {
  font-size: 1.25rem;
}

@media (max-width: 1100px) {
  .stat-grid {
    grid-template-columns: 1fr 1fr;
  }
  .analytics-layout {
    grid-template-columns: 1fr;
  }
  .hot-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 600px) {
  .stat-grid {
    grid-template-columns: 1fr;
  }
  .donut-chart-container {
    flex-direction: column;
    gap: 1.5rem;
  }
  .hot-grid {
    grid-template-columns: 1fr;
  }
}
</style>
