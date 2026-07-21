import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import SpeedTest from './views/SpeedTest.vue'
import CarSoundV2 from './views/CarSoundV2.vue'
import Results from './views/Results.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/speed-test', component: SpeedTest },
    { path: '/car-sound', component: CarSoundV2 },
    { path: '/car-sound-v2', redirect: '/car-sound' },
    { path: '/results', component: Results },
    { path: '/nav', component: () => import('./views/Nav.vue') },
  ]
})
