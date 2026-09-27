import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import { getDomain } from '../types/ha'
import type { HassEntity, EntityDomain } from '../types/ha'

export function useEntitiesByDomain(domain: EntityDomain): HassEntity[] {
  const entities = useStore((s) => s.entities)
  return useMemo(
    () => Object.values(entities).filter((e) => getDomain(e.entity_id) === domain),
    [entities, domain]
  )
}

export function useEntitiesByArea(areaId: string): HassEntity[] {
  const entities = useStore((s) => s.entities)
  return useMemo(
    () => Object.values(entities).filter((e) => (e.attributes as Record<string, unknown>)['area_id'] === areaId),
    [entities, areaId]
  )
}

export function useEntity(entityId: string): HassEntity | undefined {
  return useStore((s) => s.entities[entityId])
}

export function useLights(areaId?: string): HassEntity[] {
  const entities = useStore((s) => s.entities)
  return useMemo(
    () =>
      Object.values(entities).filter(
        (e) =>
          getDomain(e.entity_id) === 'light' &&
          (!areaId || (e.attributes as Record<string, unknown>)['area_id'] === areaId)
      ),
    [entities, areaId]
  )
}

export function useClimates(): HassEntity[] {
  return useEntitiesByDomain('climate')
}

export function useMediaPlayers(): HassEntity[] {
  const entities = useStore((s) => s.entities)
  return useMemo(
    () =>
      Object.values(entities).filter((e) => {
        if (getDomain(e.entity_id) !== 'media_player') return false
        return e.state !== 'unavailable'
      }),
    [entities]
  )
}

export function useSensors(areaId?: string): HassEntity[] {
  const entities = useStore((s) => s.entities)
  return useMemo(
    () =>
      Object.values(entities).filter(
        (e) =>
          getDomain(e.entity_id) === 'sensor' &&
          e.state !== 'unavailable' &&
          e.state !== 'unknown' &&
          (!areaId || (e.attributes as Record<string, unknown>)['area_id'] === areaId)
      ),
    [entities, areaId]
  )
}

export function usePinnedEntities(): HassEntity[] {
  // useShallow: nuovo array solo se cambia una delle entità fissate (non a ogni evento di HA)
  return useStore(useShallow((s) => s.pinnedEntities.map((id) => s.entities[id]).filter(Boolean)))
}
