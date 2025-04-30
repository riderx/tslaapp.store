<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useSpeedStore } from '../stores/speedStore'

const speedStore = useSpeedStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const ctx = ref<CanvasRenderingContext2D | null>(null)

onMounted(() => {
  if (!canvasRef.value) return
  
  ctx.value = canvasRef.value.getContext('2d')
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  
  drawGraph()
})

// Redraw when unit changes
watch(() => speedStore.isMetric, drawGraph)

function resizeCanvas() {
  if (!canvasRef.value || !canvasRef.value.parentElement) return
  
  const container = canvasRef.value.parentElement
  canvasRef.value.width = container.clientWidth
  canvasRef.value.height = 200
  
  drawGraph()
}

function drawGraph() {
  if (!ctx.value || !canvasRef.value) return
  if (speedStore.speedLog.length === 0) return
  
  const c = ctx.value
  const width = canvasRef.value.width
  const height = canvasRef.value.height
  const padding = 30
  
  // Clear canvas
  c.clearRect(0, 0, width, height)
  
  // Get max values
  const maxTime = speedStore.endTime - speedStore.startTime
  const maxSpeed = Math.max(
    speedStore.targetSpeedInCurrentUnit,
    Math.ceil(Math.max(...speedStore.speedLog.map(log => log.speed)) / 10) * 10
  )
  
  // Draw axes
  c.beginPath()
  c.moveTo(padding, padding)
  c.lineTo(padding, height - padding)
  c.lineTo(width - padding, height - padding)
  c.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  c.lineWidth = 1
  c.stroke()
  
  // Draw speed curve
  if (speedStore.speedLog.length > 1) {
    c.beginPath()
    
    speedStore.speedLog.forEach((log, index) => {
      const x = padding + (log.time / maxTime) * (width - padding * 2)
      const y = height - padding - (log.speed / maxSpeed) * (height - padding * 2)
      
      if (index === 0) {
        c.moveTo(x, y)
      } else {
        c.lineTo(x, y)
      }
    })
    
    // Add line to end point if test completed
    if (speedStore.endTime > 0) {
      const lastLog = speedStore.speedLog[speedStore.speedLog.length - 1]
      const endTime = speedStore.endTime - speedStore.startTime
      
      const x = padding + (endTime / maxTime) * (width - padding * 2)
      const y = height - padding - (lastLog.speed / maxSpeed) * (height - padding * 2)
      
      c.lineTo(x, y)
    }
    
    c.strokeStyle = 'var(--tesla-red)'
    c.lineWidth = 2
    c.stroke()
    
    // Create gradient fill
    const gradient = c.createLinearGradient(0, height - padding, 0, padding)
    gradient.addColorStop(0, 'rgba(232, 33, 39, 0.1)')
    gradient.addColorStop(1, 'rgba(232, 33, 39, 0.4)')
    
    c.lineTo(padding + (maxTime / maxTime) * (width - padding * 2), height - padding)
    c.lineTo(padding, height - padding)
    c.fillStyle = gradient
    c.fill()
  }
  
  // Draw time markers (seconds)
  const totalSeconds = Math.ceil(maxTime / 1000)
  const secondInterval = Math.ceil(totalSeconds / 5) // Show approximately 5 markers
  
  for (let i = 0; i <= totalSeconds; i += secondInterval) {
    const x = padding + (i * 1000 / maxTime) * (width - padding * 2)
    
    if (x <= width - padding) {
      // Draw marker line
      c.beginPath()
      c.moveTo(x, height - padding)
      c.lineTo(x, height - padding + 5)
      c.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      c.stroke()
      
      // Draw label
      c.font = '12px Gotham SSm, Arial, sans-serif'
      c.fillStyle = 'rgba(255, 255, 255, 0.7)'
      c.textAlign = 'center'
      c.fillText(`${i}s`, x, height - padding + 20)
    }
  }
  
  // Draw speed markers
  const speedInterval = maxSpeed <= 60 ? 20 : 40
  
  for (let i = 0; i <= maxSpeed; i += speedInterval) {
    const y = height - padding - (i / maxSpeed) * (height - padding * 2)
    
    // Draw marker line
    c.beginPath()
    c.moveTo(padding - 5, y)
    c.lineTo(padding, y)
    c.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    c.stroke()
    
    // Draw label
    c.font = '12px Gotham SSm, Arial, sans-serif'
    c.fillStyle = 'rgba(255, 255, 255, 0.7)'
    c.textAlign = 'right'
    c.textBaseline = 'middle'
    c.fillText(`${i}`, padding - 10, y)
  }
  
  // Draw target speed line
  const targetY = height - padding - (speedStore.targetSpeedInCurrentUnit / maxSpeed) * (height - padding * 2)
  
  c.beginPath()
  c.moveTo(padding, targetY)
  c.lineTo(width - padding, targetY)
  c.setLineDash([5, 5])
  c.strokeStyle = 'rgba(255, 255, 255, 0.4)'
  c.stroke()
  c.setLineDash([])
  
  // Add labels
  c.font = '14px Gotham SSm, Arial, sans-serif'
  c.fillStyle = 'rgba(255, 255, 255, 0.7)'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  
  // X-axis label (Time)
  c.fillText('Time (seconds)', width / 2, height - 5)
  
  // Y-axis label (Speed)
  c.save()
  c.translate(10, height / 2)
  c.rotate(-Math.PI / 2)
  c.fillText(`Speed (${speedStore.displayUnit})`, 0, 0)
  c.restore()
}
</script>

<template>
  <div class="graph-wrapper">
    <canvas ref="canvasRef" class="speed-graph"></canvas>
  </div>
</template>

<style scoped>
.graph-wrapper {
  width: 100%;
  height: 200px;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  overflow: hidden;
}

.speed-graph {
  width: 100%;
  height: 100%;
}
</style>