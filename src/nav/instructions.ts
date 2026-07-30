/** Short Google Maps–style banner text (not the verbose full sentence). */
export function instructionFor(type: string, modifier: string | undefined, name: string): string {
  const road = name.trim()
  const mod = (modifier || 'straight').toLowerCase()

  switch (type) {
    case 'depart':
      return road ? `Head on ${road}` : 'Continue straight'
    case 'arrive':
      return 'You have arrived'
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return road ? `Roundabout toward ${road}` : 'Enter the roundabout'
    case 'exit roundabout':
    case 'exit rotary':
      return road ? `Exit onto ${road}` : 'Exit the roundabout'
    case 'merge':
      return road ? `Merge onto ${road}` : 'Merge'
    case 'on ramp':
      return road ? `Ramp onto ${road}` : 'Take the ramp'
    case 'off ramp':
      return road ? `Exit onto ${road}` : 'Take the exit'
    case 'fork':
      return mod.includes('left')
        ? `Keep left${road ? ` onto ${road}` : ''}`
        : `Keep right${road ? ` onto ${road}` : ''}`
    case 'end of road':
      return mod.includes('left')
        ? `Turn left${road ? ` onto ${road}` : ''}`
        : `Turn right${road ? ` onto ${road}` : ''}`
    case 'continue':
    case 'new name':
      return road ? `Continue on ${road}` : 'Continue straight'
    case 'turn':
    default:
      if (mod === 'uturn' || mod.includes('u-turn') || mod.includes('u turn')) {
        return road ? `U-turn onto ${road}` : 'Make a U-turn'
      }
      if (mod === 'straight') return road ? `Continue on ${road}` : 'Continue straight'
      if (mod.includes('left')) {
        const sharp = mod.includes('sharp') ? 'sharp ' : mod.includes('slight') ? 'slight ' : ''
        return `Turn ${sharp}left${road ? ` onto ${road}` : ''}`
      }
      if (mod.includes('right')) {
        const sharp = mod.includes('sharp') ? 'sharp ' : mod.includes('slight') ? 'slight ' : ''
        return `Turn ${sharp}right${road ? ` onto ${road}` : ''}`
      }
      return road ? `Continue on ${road}` : 'Continue'
  }
}

/** Pull a short road name out of Google's long navigation sentence. */
export function roadNameFromGoogleInstruction(text?: string): string {
  if (!text) return ''
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const m =
    clean.match(/\b(?:onto|on|toward|towards)\s+(.+)$/i) ||
    clean.match(/\b(?:onto|on|toward|towards)\s+(.+?)(?:\s+[—–-]|\s+\(|$)/i)
  if (!m) return ''
  return m[1]
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '')
    .trim()
    .slice(0, 36)
}
