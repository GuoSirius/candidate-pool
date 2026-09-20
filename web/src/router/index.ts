import { createRouter, createWebHistory } from 'vue-router';
import RunsView from '../views/RunsView.vue';
import RulesView from '../views/RulesView.vue';
import StockView from '../views/StockView.vue';
import StatsView from '../views/StatsView.vue';
import AllStocksView from '../views/AllStocksView.vue';
import MineView from '../views/MineView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'runs', component: RunsView },
    { path: '/stocks', name: 'stocks', component: AllStocksView },
    { path: '/stats', name: 'stats', component: StatsView },
    { path: '/mine', name: 'mine', component: MineView },
    { path: '/rules', name: 'rules', component: RulesView },
    { path: '/stock/:code', name: 'stock', component: StockView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export default router;
