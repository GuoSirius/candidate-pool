import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './styles/main.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

createApp(App).use(router).mount('#app');
