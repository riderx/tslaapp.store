import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { getToken } from '@/api/friendsApi'
import { teslaApi, type TeslaVehicle } from '@/api/teslaApi'

const VIN_KEY = 'tslap.tesla.vin'

export const useTeslaStore = defineStore('tesla', () => {
  const loaded = ref(false)
  const configured = ref(true)
  const connected = ref(false)
  const vehicles = ref<TeslaVehicle[]>([])
  const selectedVin = ref<string | null>(localStorage.getItem(VIN_KEY))
  const error = ref<string | null>(null)

  const vehicle = computed(
    () => vehicles.value.find((v) => v.vin === selectedVin.value) || vehicles.value[0] || null,
  )

  watch(selectedVin, (vin) => {
    if (vin) localStorage.setItem(VIN_KEY, vin)
  })

  async function load() {
    error.value = null
    if (!getToken()) {
      loaded.value = true
      return
    }
    try {
      const s = await teslaApi.status()
      configured.value = s.configured
      connected.value = s.connected
      vehicles.value = s.vehicles
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load Tesla status'
    } finally {
      loaded.value = true
    }
  }

  async function connect() {
    error.value = null
    try {
      const { url } = await teslaApi.connect()
      window.location.href = url
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not start Tesla login'
    }
  }

  async function disconnect() {
    await teslaApi.disconnect()
    connected.value = false
    vehicles.value = []
  }

  async function sync() {
    const res = await teslaApi.sync()
    vehicles.value = res.vehicles
  }

  return { loaded, configured, connected, vehicles, selectedVin, vehicle, error, load, connect, disconnect, sync }
})
