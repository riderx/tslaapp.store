<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, MapPin, Phone, Plus, Users } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useFriendsStore } from '@/stores/friendsStore'
import { useCallStore } from '@/stores/callStore'
import FriendsMap from '@/components/FriendsMap.vue'

const router = useRouter()
const friendsStore = useFriendsStore()
const callStore = useCallStore()
const {
  user,
  friends,
  groups,
  acceptedFriends,
  pendingIncoming,
  sharingLocation,
  sfuReady,
  connected,
  error,
} = storeToRefs(friendsStore)

const nameInput = ref('')
const friendCodeInput = ref('')
const groupNameInput = ref('')
const selectedMembers = ref<string[]>([])
const busy = ref(false)
const notice = ref('')
const tab = ref<'map' | 'friends' | 'groups'>('map')

const myCode = computed(() => user.value?.friendCode || '')

onMounted(async () => {
  await friendsStore.bootstrap()
})

onUnmounted(() => {
  // keep location sharing if user navigates away while road-tripping
})

async function register() {
  busy.value = true
  notice.value = ''
  try {
    await friendsStore.register(nameInput.value.trim())
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Register failed'
  } finally {
    busy.value = false
  }
}

async function addFriend() {
  busy.value = true
  notice.value = ''
  try {
    notice.value = (await friendsStore.addFriend(friendCodeInput.value.trim())) || 'Sent'
    friendCodeInput.value = ''
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not add friend'
  } finally {
    busy.value = false
  }
}

async function createGroup() {
  busy.value = true
  notice.value = ''
  try {
    await friendsStore.createGroup(groupNameInput.value.trim(), selectedMembers.value)
    groupNameInput.value = ''
    selectedMembers.value = []
    tab.value = 'groups'
    notice.value = 'Group created'
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not create group'
  } finally {
    busy.value = false
  }
}

async function toggleShare() {
  try {
    if (sharingLocation.value) friendsStore.stopSharingLocation()
    else await friendsStore.startSharingLocation()
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Location failed'
  }
}

async function callGroup(id: string, name: string) {
  notice.value = ''
  try {
    await callStore.startGroupCall(id, name)
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Call failed'
  }
}

function toggleMember(id: string) {
  if (selectedMembers.value.includes(id)) {
    selectedMembers.value = selectedMembers.value.filter((x) => x !== id)
  } else {
    selectedMembers.value = [...selectedMembers.value, id]
  }
}
</script>

<template>
  <div class="page">
    <header class="header">
      <button class="back" @click="router.push('/')"><ArrowLeft class="icon" /> Home</button>
      <div class="title-wrap">
        <Users class="icon" />
        <h1>Friends</h1>
      </div>
      <div class="conn" :class="{ on: connected }">{{ connected ? 'Live' : 'Offline' }}</div>
    </header>

    <div v-if="!user" class="setup">
      <h2>Pick a driver name</h2>
      <p>Share your friend code so road-trip buddies can add you. You only see each other after both add.</p>
      <input v-model="nameInput" maxlength="32" placeholder="Your name" @keyup.enter="register" />
      <button class="primary" :disabled="busy || nameInput.trim().length < 2" @click="register">
        Continue
      </button>
      <p v-if="notice" class="notice">{{ notice }}</p>
    </div>

    <template v-else>
      <section class="profile">
        <div>
          <div class="label">Your friend code</div>
          <div class="code">{{ myCode }}</div>
        </div>
        <button class="share" @click="toggleShare">
          <MapPin class="icon-sm" />
          {{ sharingLocation ? 'Sharing location' : 'Share on map' }}
        </button>
      </section>

      <p v-if="!sfuReady" class="warn">
        Group calls need Cloudflare Realtime SFU secrets on the worker (CALLS_APP_ID / CALLS_APP_SECRET).
      </p>
      <p v-if="error || notice || callStore.error" class="notice">
        {{ error || notice || callStore.error }}
      </p>

      <nav class="tabs">
        <button :class="{ active: tab === 'map' }" @click="tab = 'map'">Map</button>
        <button :class="{ active: tab === 'friends' }" @click="tab = 'friends'">Friends</button>
        <button :class="{ active: tab === 'groups' }" @click="tab = 'groups'">Groups</button>
      </nav>

      <section v-if="tab === 'map'" class="panel map-panel">
        <FriendsMap />
        <p class="hint">Mutual friends appear only while they share location.</p>
      </section>

      <section v-else-if="tab === 'friends'" class="panel">
        <div class="row">
          <input v-model="friendCodeInput" maxlength="8" placeholder="Friend code" class="grow" />
          <button class="primary" :disabled="busy" @click="addFriend"><Plus class="icon-sm" /> Add</button>
        </div>

        <div v-if="pendingIncoming.length" class="block">
          <h3>Incoming</h3>
          <div v-for="f in pendingIncoming" :key="f.id" class="list-item">
            <div>
              <div class="name">{{ f.name }}</div>
              <div class="sub">{{ f.friendCode }}</div>
            </div>
            <button class="primary small" @click="friendsStore.acceptFriend(f.id)">Accept</button>
          </div>
        </div>

        <div class="block">
          <h3>Friends</h3>
          <div v-if="!friends.length" class="empty">No friends yet — exchange codes.</div>
          <div v-for="f in friends" :key="f.id" class="list-item">
            <div>
              <div class="name">{{ f.name }}</div>
              <div class="sub">{{ f.friendCode }} · {{ f.status }}{{ f.direction === 'outgoing' && f.status === 'pending' ? ' (waiting)' : '' }}</div>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="panel">
        <div class="block">
          <h3>New group</h3>
          <input v-model="groupNameInput" maxlength="40" placeholder="Road trip name" />
          <div class="member-picks">
            <button
              v-for="f in acceptedFriends"
              :key="f.id"
              class="chip"
              :class="{ on: selectedMembers.includes(f.id) }"
              @click="toggleMember(f.id)"
            >
              {{ f.name }}
            </button>
          </div>
          <button
            class="primary"
            :disabled="busy || groupNameInput.trim().length < 2"
            @click="createGroup"
          >
            Create group
          </button>
        </div>

        <div class="block">
          <h3>Your groups</h3>
          <div v-if="!groups.length" class="empty">Create a group, then call everyone in the cars.</div>
          <div v-for="g in groups" :key="g.id" class="list-item group">
            <div>
              <div class="name">{{ g.name }}</div>
              <div class="sub">{{ g.members.map((m) => m.name).join(', ') }}</div>
            </div>
            <button class="primary small call" @click="callGroup(g.id, g.name)">
              <Phone class="icon-sm" /> Call
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 10% -10%, #2a1012 0%, #000 55%);
  color: #fff;
  padding: 1.25rem;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.back, .conn {
  background: transparent;
  border: none;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.conn.on { color: #4ade80; }
.title-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.title-wrap h1 {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.icon { width: 1.15rem; height: 1.15rem; }
.icon-sm { width: 1rem; height: 1rem; }
.setup, .panel, .profile {
  background: rgba(20, 20, 20, 0.9);
  border: 1px solid #222;
  border-radius: 0.9rem;
  padding: 1.1rem;
}
.setup h2 { font-size: 1.4rem; margin-bottom: 0.4rem; }
.setup p, .hint { color: #9a9a9a; font-size: 0.9rem; margin-bottom: 1rem; }
input {
  width: 100%;
  background: #0c0c0c;
  border: 1px solid #333;
  color: #fff;
  border-radius: 0.5rem;
  padding: 0.85rem 0.9rem;
  margin-bottom: 0.75rem;
}
.primary {
  background: #e82127;
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  padding: 0.85rem 1rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.primary:disabled { opacity: 0.5; }
.primary.small { padding: 0.55rem 0.8rem; font-size: 0.85rem; }
.profile {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.label { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
.code { font-size: 1.6rem; font-weight: 700; letter-spacing: 0.18em; }
.share {
  background: #1c1c1c;
  border: 1px solid #333;
  color: #fff;
  border-radius: 999px;
  padding: 0.65rem 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
}
.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  margin: 0.75rem 0;
}
.tabs button {
  background: #141414;
  border: 1px solid #2a2a2a;
  color: #aaa;
  padding: 0.7rem;
  border-radius: 0.6rem;
  cursor: pointer;
}
.tabs button.active {
  color: #fff;
  border-color: #e82127;
  background: #1a0d0e;
}
.map-panel { padding: 0.6rem; }
.row { display: flex; gap: 0.5rem; align-items: flex-start; }
.grow { flex: 1; margin-bottom: 0; }
.block { margin-top: 1rem; }
.block h3 {
  font-size: 0.8rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.6rem;
}
.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #222;
}
.name { font-weight: 600; }
.sub { color: #888; font-size: 0.8rem; margin-top: 0.15rem; }
.empty { color: #777; font-size: 0.9rem; }
.member-picks { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
.chip {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #ccc;
  border-radius: 999px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
}
.chip.on { border-color: #e82127; color: #fff; background: #2a1214; }
.notice { color: #fca5a5; margin: 0.5rem 0; font-size: 0.9rem; }
.warn {
  background: #2a1c00;
  border: 1px solid #664400;
  color: #fbbf24;
  padding: 0.7rem 0.85rem;
  border-radius: 0.6rem;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}
</style>
