import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import HomeView from './views/HomeView.vue';
import RepoDetailView from './views/RepoDetailView.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/repos/:id', component: RepoDetailView },
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
