import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from './components/OverviewView.vue';
import PipelineView from './components/PipelineView.vue';
import AnalyticsView from './components/AnalyticsView.vue';
import AutomationView from './components/AutomationView.vue';
import ProfileView from './components/ProfileView.vue';

const routes = [
  {
    path: '/',
    redirect: '/overview',
  },
  {
    path: '/overview',
    name: 'Overview',
    component: OverviewView,
  },
  {
    path: '/pipeline',
    name: 'Pipeline',
    component: PipelineView,
  },
  {
    path: '/analytics',
    name: 'Analytics',
    component: AnalyticsView,
  },
  {
    path: '/automation',
    name: 'Automation',
    component: AutomationView,
  },
  {
    path: '/profile',
    name: 'Profile',
    component: ProfileView,
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/overview',
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
