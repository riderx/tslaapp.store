import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import SpeedTest from './views/SpeedTest.vue'

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
  ]
})
