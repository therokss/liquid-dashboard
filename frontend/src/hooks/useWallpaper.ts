import { useEffect, useRef } from 'react'
import { useStore } from '../store'

export type TimeSlot = 'morning' | 'day' | 'evening' | 'night'

function getTimeSlot(): TimeSlot {
  const h = new Date().getHours()
  if (h >= 6 && h < 11) return 'morning'
  if (h >= 11 && h < 18) return 'day'
  if (h >= 18 && h < 22) return 'evening'
  return 'night'
}

const FALLBACK_GRADIENTS: Record<TimeSlot, string> = {
  morning: 'linear-gradient(160deg, #ff9a6c 0%, #ffd89b 40%, #c9a0dc 100%)',
  day: 'linear-gradient(160deg, #4facfe 0%, #a8edea 50%, #fed6e3 100%)',
  evening: 'linear-gradient(160deg, #f7971e 0%, #c54b8c 50%, #4a0080 100%)',
  night: 'linear-gradient(160deg, #0c0c1e 0%, #1a1a4e 50%, #0d2137 100%)',
}

export function useWallpaper() {
  const wallpapers = useStore((s) => s.wallpapers)
  const slot = getTimeSlot()
  const wallpaperUrl = wallpapers[slot]
  const prevSlotRef = useRef<TimeSlot | null>(null)

  useEffect(() => {
    const root = document.documentElement

    if (wallpaperUrl) {
      root.style.setProperty('--wallpaper-url', `url(${wallpaperUrl})`)
    } else {
      root.style.setProperty('--wallpaper-url', FALLBACK_GRADIENTS[slot])
    }

    if (prevSlotRef.current !== slot) {
      prevSlotRef.current = slot
    }

    // Controlla ogni ora se il time slot cambia
    const interval = setInterval(() => {
      const newSlot = getTimeSlot()
      if (newSlot !== prevSlotRef.current) {
        const newUrl = wallpapers[newSlot]
        if (newUrl) {
          root.style.setProperty('--wallpaper-url', `url(${newUrl})`)
        } else {
          root.style.setProperty('--wallpaper-url', FALLBACK_GRADIENTS[newSlot])
        }
        prevSlotRef.current = newSlot
      }
    }, 60_000)

    return () => clearInterval(interval)
  }, [wallpapers, slot, wallpaperUrl])

  return { slot, wallpaperUrl }
}

export function useAccentFromWallpaper() {
  const autoAccent = useStore((s) => s.theme.autoAccent)
  const wallpapers = useStore((s) => s.wallpapers)
  const setTheme = useStore((s) => s.setTheme)

  useEffect(() => {
    if (!autoAccent) return
    const slot = getTimeSlot()
    const url = wallpapers[slot]
    if (!url) return

    // Estrai il colore dominante tramite canvas
    extractDominantHue(url).then((hue) => {
      if (hue !== null) setTheme({ accentHue: hue })
    })
  }, [wallpapers, autoAccent, setTheme])
}

async function extractDominantHue(imageUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 50
        canvas.height = 50
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }

        ctx.drawImage(img, 0, 0, 50, 50)
        const data = ctx.getImageData(0, 0, 50, 50).data

        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 16) {
          r += data[i]; g += data[i+1]; b += data[i+2]; count++
        }
        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)

        const hue = rgbToHue(r, g, b)
        resolve(hue)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

function rgbToHue(r: number, g: number, b: number): number {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 210

  let h = 0
  if (max === r) h = ((g - b) / d + 6) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4

  return Math.round(h * 60)
}

export { getTimeSlot, FALLBACK_GRADIENTS }
