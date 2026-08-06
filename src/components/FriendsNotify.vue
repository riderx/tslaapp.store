<script setup lang="ts">
import { computed } from 'vue'
import { UserPlus, Check, X, Phone } from 'lucide-vue-next'
import { useNotifyStore } from '@/stores/notifyStore'
import { useCallStore } from '@/stores/callStore'

const notify = useNotifyStore()
const call = useCallStore()

const alert = computed(() => notify.current)
const visible = computed(() => Boolean(alert.value) && call.phase === 'idle')

async function callFriend() {
  const a = alert.value
  if (!a || a.kind !== 'friend_accepted') return
  const { friendId, friendName } = a
  notify.dismiss()
  await call.startFriendCall(friendId, friendName)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && alert" class="notify-layer" role="dialog" aria-live="polite">
      <div class="notify-bar" :class="alert.kind">
        <div class="icon-wrap">
          <UserPlus v-if="alert.kind === 'friend_request'" class="ico" />
          <Check v-else class="ico" />
        </div>
        <div class="info">
          <div class="status">{{ alert.title }}</div>
          <div class="title">{{ alert.body }}</div>
        </div>
        <div class="actions">
          <button type="button" class="btn ghost" aria-label="Dismiss" @click="notify.dismiss()">
            <X class="ico" />
            <span>Dismiss</span>
          </button>
          <button
            v-if="alert.kind === 'friend_request'"
            type="button"
            class="btn primary"
            :disabled="notify.busy"
            @click="notify.acceptCurrent()"
          >
            <Check class="ico" />
            <span>{{ notify.busy ? '…' : 'Accept' }}</span>
          </button>
          <button
            v-else
            type="button"
            class="btn primary"
            aria-label="Call friend"
            @click="callFriend"
          >
            <Phone class="ico" />
            <span>Call</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.notify-layer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9990;
  display: flex;
  justify-content: center;
  padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
}

.notify-bar {
  pointer-events: auto;
  width: min(560px, 100%);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-radius: 1rem;
  border: 1px solid #2e2e2e;
  background: rgba(18, 18, 18, 0.94);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}

.notify-bar.friend_request {
  border-color: rgba(59, 130, 246, 0.55);
}

.notify-bar.friend_accepted {
  border-color: rgba(34, 197, 94, 0.45);
}

.icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: #1f1f1f;
  flex-shrink: 0;
}

.friend_request .icon-wrap {
  background: #172554;
  color: #93c5fd;
}

.friend_accepted .icon-wrap {
  background: #14532d;
  color: #86efac;
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
  font-size: 1rem;
  font-weight: 600;
  color: #fff;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
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
}

.btn:disabled {
  opacity: 0.55;
}

.btn .ico {
  width: 1.1rem;
  height: 1.1rem;
}

.btn.ghost {
  background: #262626;
  border-color: #3a3a3a;
  color: #eee;
}

.btn.primary {
  background: #e82127;
  color: #fff;
}
</style>
