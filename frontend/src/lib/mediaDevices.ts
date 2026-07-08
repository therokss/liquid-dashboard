import type { HassEntity } from '../types/ha'

// Tipo di media player, dedotto dall'integrazione (platform del registro) e dagli attributi.
// Serve a scegliere il telecomando giusto (LG webOS, Apple TV, Android TV, TV generica) o la
// card altoparlante.
export type MediaKind = 'lg' | 'appletv' | 'androidtv' | 'tv' | 'speaker'

export function mediaKind(
  entity: HassEntity,
  platform: string | undefined,
  hasPairedRemote: boolean,
  model?: string,
): MediaKind {
  const dc = (entity.attributes as Record<string, unknown>).device_class as string | undefined
  // HomePod / speaker AirPlay: l'integrazione apple_tv li espone (con remote), ma sono
  // altoparlanti, non TV. Riconoscibili dal modello.
  if (model && /homepod|home ?pod|speaker/i.test(model)) return 'speaker'
  if (platform === 'webostv') return 'lg'
  if (platform === 'apple_tv') return 'appletv'
  if (platform === 'androidtv' || platform === 'androidtv_remote') return 'androidtv'
  if (dc === 'tv' || dc === 'receiver') return 'tv'
  // Un media_player con un'entità remote abbinata sullo stesso device è quasi sempre una TV/box.
  if (hasPairedRemote) return 'tv'
  return 'speaker'
}

export function isTV(kind: MediaKind): boolean {
  return kind !== 'speaker'
}

// Cerca l'entità remote.* sullo stesso device del media_player (Apple TV, Android TV, …).
export function findPairedRemote(
  mediaId: string,
  entities: Record<string, HassEntity>,
  entityDevices: Record<string, string>,
): string | undefined {
  const dev = entityDevices[mediaId]
  if (!dev) return undefined
  for (const id in entities) {
    if (id.startsWith('remote.') && entityDevices[id] === dev) return id
  }
  return undefined
}
