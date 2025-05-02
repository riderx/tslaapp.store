import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import SpeedTest from './views/SpeedTest.vue'
import CarSound from './views/CarSound.vue'
import Results from './views/Results.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: Home
    },
    {
      path: '/speed-test',
      component: SpeedTest
    },
    {
      path: '/car-sound',
      component: CarSound
    },
    {
      path: '/results',
      component: Results
    }
  ]
})
