import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import SpeedTest from './views/SpeedTest.vue'
import CarSound from './views/CarSound.vue'
import CarSoundV2 from './views/CarSoundV2.vue'
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
      path: '/car-sound-v2',
      component: CarSoundV2
    },
    {
      path: '/results',
      component: Results
    }
  ]
})
