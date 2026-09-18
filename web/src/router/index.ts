import { createRouter, createWebHistory } from 'vue-router';
import RunsView from '../views/RunsView.vue';
import RulesView from '../views/RulesView.vue';
import StockView from '../views/StockView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'runs', component: RunsView },
    { path: '/rules', name: 'rules', component: RulesView },
    { path: '/stock/:code', name: 'stock', component: StockView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export default router;
