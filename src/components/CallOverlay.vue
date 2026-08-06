<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Mic, MicOff, PhoneOff, Phone } from 'lucide-vue-next'
import { useCallStore } from '@/stores/callStore'

const call = useCallStore()
const ending = ref(false)
const answering = ref(false)

const visible = computed(() => call.phase !== 'idle')
const inCall = computed(() => call.phase === 'in_call')
const ringing = computed(() => call.phase === 'ringing')
const connecting = computed(() => call.phase === 'connecting')

const statusText = computed(() => {
  if (ringing.value) return 'Incoming group call'
  if (connecting.value) return 'Connecting…'
  if (!call.micAvailable) return 'Listening only'
  return call.muted ? 'Muted' : 'Live'
})

const micIcon = computed(() => (call.muted || !call.micAvailable ? MicOff : Mic))

async function answer() {
  if (answering.value || ending.value) return
  answering.value = true
  try {
    await call.answerCall()
  } finally {
    answering.value = false
  }
}

async function endCall() {
  if (ending.value) return
  ending.value = true
  try {
    if (call.phase === 'ringing') call.declineRing()
    else await call.hangUp()
  } finally {
    ending.value = false
  }
}

function toggleMute() {
  if (!inCall.value || !call.micAvailable) return
  call.toggleMute()
}

onBeforeUnmount(() => {
  ending.value = false
  answering.value = false
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="call-layer"
      :class="{ ringing }"
      role="dialog"
      aria-live="polite"
      :aria-label="statusText"
    >
      <div class="call-bar">
        <div class="info">
          <div class="status">{{ statusText }}</div>
          <div class="title">{{ call.groupName || 'Group call' }}</div>
          <div v-if="call.fromName && ringing" class="from">{{ call.fromName }}</div>
          <div v-else-if="inCall" class="from">
            {{ call.remoteCount }} remote
            <span v-if="!call.micAvailable"> · speak from phone</span>
          </div>
          <div v-if="call.error" class="error" role="alert">{{ call.error }}</div>
        </div>

        <div class="actions">
          <template v-if="ringing">
            <button
              type="button"
              class="btn decline"
              aria-label="Decline call"
              :disabled="ending || answering"
              @click="endCall"
            >
              <PhoneOff class="ico" />
              <span>Decline</span>
            </button>
            <button
              type="button"
              class="btn answer"
              aria-label="Answer call"
              :disabled="ending || answering"
              @click="answer"
            >
              <Phone class="ico" />
              <span>{{ answering ? 'Joining…' : 'Answer' }}</span>
            </button>
          </template>

          <template v-else>
            <button
              v-if="inCall && call.micAvailable"
              type="button"
              class="btn mute"
              :class="{ on: call.muted }"
              :aria-label="call.muted ? 'Unmute microphone' : 'Mute microphone'"
              @click="toggleMute"
            >
              <component :is="micIcon" class="ico" />
              <span>{{ call.muted ? 'Unmute' : 'Mute' }}</span>
            </button>
            <button
              type="button"
              class="btn end"
              aria-label="End call"
              :disabled="ending || connecting"
              @click="endCall"
            >
              <PhoneOff class="ico" />
              <span>{{ ending ? 'Ending…' : connecting ? 'Cancel' : 'End' }}</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.call-layer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  display: flex;
  justify-content: center;
  padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
  background: transparent;
}

.call-layer.ringing {
  /* Soft top wash only — tabs/map stay visible and tappable above the bar */
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.35) 70%);
}

.call-bar {
  pointer-events: auto;
  width: min(560px, 100%);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  padding: 0.85rem 1rem;
  border-radius: 1rem;
  border: 1px solid #2e2e2e;
  background: rgba(18, 18, 18, 0.94);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}

.ringing .call-bar {
  border-color: rgba(232, 33, 39, 0.55);
  animation: ring-pulse 1.4s ease-in-out infinite;
}

.info {
  flex: 1 1 140px;
  min-width: 0;
}

.status {
  color: #a3a3a3;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.title {
  margin-top: 0.15rem;
  font-size: 1.05rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.from {
  margin-top: 0.15rem;
  color: #c4c4c4;
  font-size: 0.8rem;
}

.error {
  margin-top: 0.35rem;
  color: #f87171;
  font-size: 0.8rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 0 0 auto;
}

.btn {
  min-height: 48px;
  min-width: 48px;
  padding: 0.7rem 1rem;
  border-radius: 0.65rem;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 160ms ease, opacity 160ms ease, background-color 160ms ease;
}

.btn:active:not(:disabled) {
  transform: scale(0.97);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn .ico {
  width: 1.15rem;
  height: 1.15rem;
  flex-shrink: 0;
}

.btn.answer {
  background: #16a34a;
  color: #fff;
}

.btn.decline,
.btn.end {
  background: #e82127;
  color: #fff;
}

.btn.mute {
  background: #262626;
  border-color: #3a3a3a;
  color: #eee;
}

.btn.mute.on {
  background: #3f3f46;
}

@media (prefers-reduced-motion: reduce) {
  .ringing .call-bar {
    animation: none;
  }
  .btn {
    transition: none;
  }
}

@keyframes ring-pulse {
  0%,
  100% {
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.45), 0 0 0 0 rgba(232, 33, 39, 0.35);
  }
  50% {
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.45), 0 0 0 6px rgba(232, 33, 39, 0);
  }
}
</style>
