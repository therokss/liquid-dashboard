// Converte un file immagine in un data URL ridimensionato.
//
// Perché: gli sfondi venivano salvati con URL.createObjectURL(file), che produce
// un blob URL valido SOLO nella sessione corrente: non è serializzabile, non
// sopravvive a un reload e — soprattutto — non si sincronizza (la stringa "blob:…"
// finisce nella config ma è inutile altrove). Un data URL (base64) invece è un dato
// reale: si salva nel backend condiviso e compare anche sull'app. Ridimensioniamo
// con canvas per tenere il peso basso e per stare nel limite del POST.
export async function fileToWallpaperDataUrl(
  file: File,
  maxEdge = 2560,
  quality = 0.82,
): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })

  // Foto già piccola: evita la riconversione (mantiene PNG/trasparenza).
  if (file.size <= 500_000) return original

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('decode'))
    i.src = original
  })

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return original
  ctx.drawImage(img, 0, 0, w, h)
  // JPEG: piccolo per le foto. Per uno sfondo la perdita di trasparenza è irrilevante.
  return canvas.toDataURL('image/jpeg', quality)
}
