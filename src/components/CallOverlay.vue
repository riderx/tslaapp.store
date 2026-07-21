<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Mic, MicOff, PhoneOff, Play } from 'lucide-vue-next'
import { useCallStore } from '@/stores/callStore'

const call = useCallStore()
const pressing = ref(false)
const longFired = ref(false)
let pressTimer: number | null = null
const LONG_MS = 650

const visible = computed(() => call.phase !== 'idle')
const icon = computed(() => {
  if (call.phase === 'ringing') return Play
  if (call.phase === 'in_call' && call.muted) return MicOff
  if (call.phase === 'in_call') return Mic
  return Play
})

function clearPress() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
  pressing.value = false
}

function onPointerDown() {
  if (call.phase !== 'in_call') return
  pressing.value = true
  longFired.value = false
  pressTimer = window.setTimeout(async () => {
    pressTimer = null
    longFired.value = true
    pressing.value = false
    await call.hangUp()
  }, LONG_MS)
}

async function onPointerUp() {
  const wasLong = longFired.value
  clearPress()
  if (wasLong) return
  if (call.phase === 'in_call') {
    call.toggleMute()
  }
}

async function onClick() {
  if (call.phase === 'ringing') {
    await call.answerCall()
  }
}

onBeforeUnmount(clearPress)
</script>

<template>
  <div v-if="visible" class="overlay" :class="{ ringing: call.phase === 'ringing' }">
    <div class="card">
      <div class="meta">
        <div class="status">
          <span v-if="call.phase === 'ringing'">Incoming group call</span>
          <span v-else-if="call.phase === 'connecting'">Connecting…</span>
          <span v-else>Live · {{ call.remoteCount }} listening</span>
        </div>
        <div class="title">{{ call.groupName }}</div>
        <div class="from" v-if="call.fromName">{{ call.fromName }}</div>
        <div class="hint" v-if="call.phase === 'in_call'">
          Tap to mute mic · hold to end call
        </div>
        <div class="error" v-if="call.error">{{ call.error }}</div>
      </div>

      <button
        class="play-button"
        :class="{ muted: call.muted, pressing }"
        :disabled="call.phase === 'connecting'"
        @click="onClick"
        @pointerdown.prevent="onPointerDown"
        @pointerup="onPointerUp"
        @pointerleave="clearPress"
        @pointercancel="clearPress"
      >
        <component :is="icon" class="play-icon" />
        <span>{{ call.playLabel }}</span>
      </button>

      <button v-if="call.phase === 'ringing'" class="decline" @click="call.hangUp()">
        <PhoneOff class="w-4 h-4" /> Decline
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1.25rem;
  background: linear-gradient(180deg, transparent 35%, rgba(0, 0, 0, 0.82));
  pointer-events: none;
}
.overlay.ringing {
  background: linear-gradient(180deg, rgba(232, 33, 39, 0.15), rgba(0, 0, 0, 0.88));
  animation: pulse 1.2s ease-in-out infinite;
}
.card {
  width: min(480px, 100%);
  pointer-events: auto;
  background: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 1rem;
  padding: 1.25rem;
}
.meta { margin-bottom: 1rem; }
.status {
  color: #a0a0a0;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.title {
  margin-top: 0.25rem;
  font-size: 1.35rem;
  font-weight: 600;
}
.from { color: #ccc; margin-top: 0.15rem; }
.hint { margin-top: 0.5rem; color: #888; font-size: 0.8rem; }
.error { margin-top: 0.5rem; color: #e82127; font-size: 0.85rem; }
.play-button {
  width: 100%;
  padding: 1rem;
  background-color: #e82127;
  color: white;
  border: none;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.play-button.muted { background: #444; }
.play-button.pressing { background: #8a1418; transform: scale(0.98); }
.play-button:disabled { opacity: 0.6; }
.play-icon { width: 1.5rem; height: 1.5rem; }
.decline {
  margin-top: 0.75rem;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.75rem;
  background: transparent;
  border: 1px solid #333;
  color: #ddd;
  border-radius: 0.5rem;
  cursor: pointer;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.9; }
}
</style>
