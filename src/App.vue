<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import CallOverlay from '@/components/CallOverlay.vue'
import { useFriendsStore } from '@/stores/friendsStore'

const friends = useFriendsStore()
onMounted(() => {
  friends.bootstrap().catch(() => null)
})
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <RouterView />
    <CallOverlay />
  </div>
</template>
