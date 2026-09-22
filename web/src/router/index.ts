import { createRouter, createWebHistory } from 'vue-router';
import RunsView from '../views/RunsView.vue';
import RulesView from '../views/RulesView.vue';
import StockView from '../views/StockView.vue';
import StatsView from '../views/StatsView.vue';
import AllStocksView from '../views/AllStocksView.vue';
import MineView from '../views/MineView.vue';
import TailView from '../views/TailView.vue';
import TailHistoryView from '../views/TailHistoryView.vue';
import TailReviewView from '../views/TailReviewView.vue';
import TailDiffView from '../views/TailDiffView.vue';
import ReportsView from '../views/ReportsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'runs', component: RunsView },
    { path: '/stocks', name: 'stocks', component: AllStocksView },
    { path: '/stats', name: 'stats', component: StatsView },
    { path: '/mine', name: 'mine', component: MineView },
    { path: '/rules', name: 'rules', component: RulesView },
    { path: '/tail', name: 'tail', component: TailView },
    { path: '/tail/history', name: 'tail-history', component: TailHistoryView },
    { path: '/tail/review', name: 'tail-review', component: TailReviewView },
    { path: '/tail/diff', name: 'tail-diff', component: TailDiffView },
    { path: '/reports', name: 'reports', component: ReportsView, props: { kind: 'eod' } },
    { path: '/tail/reports', name: 'tail-reports', component: ReportsView, props: { kind: 'tail' } },
    { path: '/stock/:code', name: 'stock', component: StockView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export default router;
