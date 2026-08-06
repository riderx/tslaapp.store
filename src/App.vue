<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import CallOverlay from '@/components/CallOverlay.vue'
import FriendsNotify from '@/components/FriendsNotify.vue'
import { useFriendsStore } from '@/stores/friendsStore'
import { useCallStore } from '@/stores/callStore'
import { useNotifyStore } from '@/stores/notifyStore'

const friends = useFriendsStore()
useCallStore() // bind ring listener for every route/tab
useNotifyStore() // friend request / accept banners
onMounted(() => {
  friends.bootstrap().catch(() => null)
})
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <RouterView />
    <CallOverlay />
    <FriendsNotify />
  </div>
</template>
