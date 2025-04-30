<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useSpeedStore } from '../stores/speedStore'

const props = defineProps({
  animated: {
    type: Boolean,
    default: true
  }
})

const speedStore = useSpeedStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const ctx = ref<CanvasRenderingContext2D | null>(null)
const canvasSize = ref({ width: 300, height: 300 })
const centerX = computed(() => canvasSize.value.width / 2)
const centerY = computed(() => canvasSize.value.height / 2)
const radius = computed(() => Math.min(centerX.value, centerY.value) * 0.85)

// Animation related
const animatedSpeed = ref(0)
const animationSpeed = 0.2 // Speed of animation (0-1)

// Init canvas
onMounted(() => {
  if (!canvasRef.value) return
  
  ctx.value = canvasRef.value.getContext('2d')
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  
  // Start animation loop
  if (props.animated) {
    animationLoop()
  } else {
    drawSpeedometer(speedStore.currentSpeed)
  }
})

// Animate speed changes
watch(() => speedStore.currentSpeed, (newSpeed) => {
  if (!props.animated) {
    drawSpeedometer(newSpeed)
  }
})

// Redraw when unit changes
watch(() => speedStore.isMetric, () => {
  drawSpeedometer(props.animated ? animatedSpeed.value : speedStore.currentSpeed)
})

function resizeCanvas() {
  if (!canvasRef.value || !canvasRef.value.parentElement) return
  
  const container = canvasRef.value.parentElement
  const size = Math.min(container.clientWidth, 400)
  
  canvasSize.value = {
    width: size,
    height: size
  }
  
  canvasRef.value.width = size
  canvasRef.value.height = size
  
  drawSpeedometer(props.animated ? animatedSpeed.value : speedStore.currentSpeed)
}

function animationLoop() {
  if (!ctx.value) return
  
  // Smoothly animate to target speed
  const targetSpeed = speedStore.currentSpeed
  const diff = targetSpeed - animatedSpeed.value
  
  if (Math.abs(diff) > 0.01) {
    animatedSpeed.value += diff * animationSpeed
    drawSpeedometer(animatedSpeed.value)
  }
  
  requestAnimationFrame(animationLoop)
}

function drawSpeedometer(speed: number) {
  if (!ctx.value) return
  
  const c = ctx.value
  c.clearRect(0, 0, canvasSize.value.width, canvasSize.value.height)
  
  const maxSpeed = speedStore.isMetric ? 160 : 100 // Max speed on the dial
  const startAngle = Math.PI * 0.75 // Start at -135 degrees (bottom left)
  const endAngle = Math.PI * 2.25   // End at +45 degrees (bottom right)
  const totalAngle = endAngle - startAngle
  
  // Draw background
  c.beginPath()
  c.arc(centerX.value, centerY.value, radius.value + 20, 0, Math.PI * 2)
  c.fillStyle = 'rgba(0, 0, 0, 0.3)'
  c.fill()
  
  // Draw outer arc
  c.beginPath()
  c.arc(centerX.value, centerY.value, radius.value, startAngle, endAngle)
  c.lineWidth = 5
  c.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  c.stroke()
  
  // Calculate speed ratio (0-1)
  const speedRatio = Math.min(Math.max(0, speed / maxSpeed), 1)
  
  // Create gradient based on speed
  const gradient = c.createLinearGradient(
    centerX.value - radius.value, 
    centerY.value, 
    centerX.value + radius.value, 
    centerY.value
  )
  
  if (speed < (maxSpeed * 0.5)) {
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.7)')
    gradient.addColorStop(1, 'rgba(230, 33, 39, 0.7)')
  } else {
    gradient.addColorStop(0, 'rgba(230, 33, 39, 0.7)')
    gradient.addColorStop(1, 'rgba(255, 0, 0, 0.9)')
  }
  
  if (speed > 0) {
    c.beginPath()
    c.arc(centerX.value, centerY.value, radius.value, startAngle, startAngle + (totalAngle * speedRatio))
    c.lineWidth = 10
    c.strokeStyle = gradient
    c.stroke()
  }
  
  // Draw speed markers
  const markerCount = speedStore.isMetric ? 16 : 10 // Markers every 10km/h or 10mph
  const markerInterval = maxSpeed / markerCount
  
  for (let i = 0; i <= markerCount; i++) {
    const markerValue = i * markerInterval
    const markerRatio = markerValue / maxSpeed
    const markerAngle = startAngle + (totalAngle * markerRatio)
    
    const markerLength = i % 5 === 0 ? 15 : 7
    const innerRadius = radius.value - markerLength
    
    const x1 = centerX.value + Math.cos(markerAngle) * radius.value
    const y1 = centerY.value + Math.sin(markerAngle) * radius.value
    const x2 = centerX.value + Math.cos(markerAngle) * innerRadius
    const y2 = centerY.value + Math.sin(markerAngle) * innerRadius
    
    c.beginPath()
    c.moveTo(x1, y1)
    c.lineTo(x2, y2)
    c.lineWidth = i % 5 === 0 ? 2 : 1
    c.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    c.stroke()
    
    // Add labels for major ticks
    if (i % 5 === 0 && i > 0) {
      const labelRadius = radius.value - 30
      const labelX = centerX.value + Math.cos(markerAngle) * labelRadius
      const labelY = centerY.value + Math.sin(markerAngle) * labelRadius
      
      c.font = '14px Gotham SSm, Arial, sans-serif'
      c.fillStyle = 'rgba(255, 255, 255, 0.7)'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(markerValue.toString(), labelX, labelY)
    }
  }
  
  // Draw needle
  const needleAngle = startAngle + (totalAngle * speedRatio)
  const needleLength = radius.value - 20
  
  c.save()
  c.translate(centerX.value, centerY.value)
  c.rotate(needleAngle)
  
  // Needle shape
  c.beginPath()
  c.moveTo(-5, 0)
  c.lineTo(0, -needleLength)
  c.lineTo(5, 0)
  c.closePath()
  c.fillStyle = 'var(--tesla-red)'
  c.fill()
  
  // Needle center
  c.beginPath()
  c.arc(0, 0, 10, 0, Math.PI * 2)
  c.fillStyle = 'var(--tesla-red)'
  c.fill()
  
  // Add shadow effect
  c.shadowColor = 'rgba(232, 33, 39, 0.4)'
  c.shadowBlur = 10
  
  c.restore()
}
</script>

<template>
  <div class="speedometer-container">
    <canvas ref="canvasRef" class="speedometer-canvas"></canvas>
  </div>
</template>

<style scoped>
.speedometer-container {
  width: 100%;
  max-width: 400px;
  aspect-ratio: 1 / 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.speedometer-canvas {
  display: block;
}
</style>