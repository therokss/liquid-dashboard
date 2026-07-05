import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HassEntity, HassArea } from '../types/ha'

export type Theme = 'dark' | 'light' | 'auto'
export type WallpaperSlot = 'morning' | 'day' | 'evening' | 'night'

export interface WallpaperConfig {
  morning: string | null
  day: string | null
  evening: string | null
  night: string | null
}

export interface ThemeConfig {
  mode: Theme
  glassIntensity: number      // 0.3 – 1.0
  accentHue: number           // 0 – 360, null = auto da wallpaper
  autoAccent: boolean
}

export interface DashboardConfig {
  hassUrl: string
  setupComplete: boolean
  enabledAreas: string[]
  wallpapers: WallpaperConfig
  theme: ThemeConfig
  pinnedEntities: string[]
  userHiddenEntities: Record<string, true> // entità nascoste manualmente dall'utente
  visibilityReviewed: Record<string, true> // entità per cui è già stata presa una decisione (stepper)
  kioskMode: boolean                       // nasconde la barra di HA (schermo intero)
  onboardingDone: boolean                  // wizard di primo avvio completato
  serverExtraEntities: string[]            // sensori extra fissati nella pagina Info server

  // Meteo & calendario
  weatherEnabled: boolean
  weatherEntity: string | null            // entità weather.* scelta (null = auto)
  externalTempSource: string              // 'weather' oppure entity_id di un sensore temperatura
  calendarEnabled: boolean
  calendarEntities: string[]              // calendari selezionati (vuoto = tutti)

  // Elettricità (dashboard Energia)
  energyEnabled: boolean
  energyPowerEntity: string | null // sensore potenza per il consumo istantaneo (W/kW)

  // Raccolta rifiuti
  wasteEnabled: boolean
  wasteSchedule: Record<string, number[]>  // tipo rifiuto → giorni settimana (0=Dom … 6=Sab)
  wasteInterval: Record<string, number>    // tipo rifiuto → ogni N settimane (default 1)
  wasteAnchor: Record<string, string>      // tipo rifiuto → data ISO di riferimento (per N>1)
}

interface HAState {
  entities: Record<string, HassEntity>
  areas: HassArea[]
  entityAreas: Record<string, string>  // entity_id → area_id (da entity/device registry)
  entityDevices: Record<string, string> // entity_id → device_id
  hiddenEntities: Record<string, true> // entità nascoste/disabilitate in HA
  connected: boolean
  loading: boolean
  isAdmin: boolean                     // l'utente che sta guardando è amministratore HA
  currentUserId: string | null         // ID dell'utente HA che sta guardando (da ingress)
  userPermissions: Record<string, boolean> // permessi per non-admin (dal server addon)
}

interface AppStore extends DashboardConfig, HAState {
  // Config actions
  setHassUrl: (url: string) => void
  completeSetup: () => void
  setEnabledAreas: (areas: string[]) => void
  setWallpaper: (slot: WallpaperSlot, url: string | null) => void
  setTheme: (theme: Partial<ThemeConfig>) => void
  togglePinnedEntity: (entityId: string) => void
  toggleEntityHidden: (entityId: string) => void
  setEntityHidden: (entityId: string, hidden: boolean) => void
  decideVisibility: (entityId: string, hidden: boolean) => void
  clearReviewed: (entityIds: string[]) => void
  setKioskMode: (enabled: boolean) => void
  setOnboardingDone: (done: boolean) => void
  toggleServerEntity: (entityId: string) => void
  setWeatherEnabled: (enabled: boolean) => void
  setWeatherEntity: (entityId: string | null) => void
  setExternalTempSource: (source: string) => void
  setCalendarEnabled: (enabled: boolean) => void
  toggleCalendarEntity: (entityId: string) => void
  setEnergyEnabled: (enabled: boolean) => void
  setEnergyPowerEntity: (entityId: string | null) => void
  setWasteEnabled: (enabled: boolean) => void
  toggleWasteDay: (typeId: string, day: number) => void
  setWasteInterval: (typeId: string, weeks: number) => void
  setWasteAnchor: (typeId: string, isoDate: string) => void
  resetSetup: () => void

  // HA state actions
  setEntities: (entities: Record<string, HassEntity>) => void
  updateEntity: (entityId: string, entity: HassEntity) => void
  setAreas: (areas: HassArea[]) => void
  setEntityAreas: (map: Record<string, string>) => void
  setEntityDevices: (map: Record<string, string>) => void
  setHiddenEntities: (map: Record<string, true>) => void
  setIsAdmin: (isAdmin: boolean) => void
  setCurrentUserId: (id: string | null) => void
  setUserPermissions: (perms: Record<string, boolean>) => void
  setConnected: (connected: boolean) => void
  setLoading: (loading: boolean) => void
}

const DEFAULT_CONFIG: DashboardConfig = {
  hassUrl: 'http://homeassistant.local:8123',
  setupComplete: false,
  enabledAreas: [],
  wallpapers: { morning: null, day: null, evening: null, night: null },
  theme: {
    mode: 'dark',
    glassIntensity: 0.7,
    accentHue: 184,
    autoAccent: false,
  },
  pinnedEntities: [],
  userHiddenEntities: {},
  visibilityReviewed: {},
  kioskMode: true,
  onboardingDone: false,
  serverExtraEntities: [],
  weatherEnabled: true,
  weatherEntity: null,
  externalTempSource: 'weather',
  calendarEnabled: true,
  calendarEntities: [],
  energyEnabled: true,
  energyPowerEntity: null,
  wasteEnabled: true,
  wasteSchedule: {},
  wasteInterval: {},
  wasteAnchor: {},
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      ...DEFAULT_CONFIG,
      entities: {},
      areas: [],
      entityAreas: {},
      entityDevices: {},
      hiddenEntities: {},
      connected: false,
      loading: true,
      isAdmin: false,
      currentUserId: null,
      userPermissions: {},

      setHassUrl: (url) => set({ hassUrl: url }),
      completeSetup: () => set({ setupComplete: true }),
      setEnabledAreas: (areas) => set({ enabledAreas: areas }),
      setWallpaper: (slot, url) =>
        set((s) => ({ wallpapers: { ...s.wallpapers, [slot]: url } })),
      setTheme: (theme) =>
        set((s) => ({ theme: { ...s.theme, ...theme } })),
      togglePinnedEntity: (entityId) =>
        set((s) => ({
          pinnedEntities: s.pinnedEntities.includes(entityId)
            ? s.pinnedEntities.filter((id) => id !== entityId)
            : [...s.pinnedEntities, entityId],
        })),
      toggleEntityHidden: (entityId) =>
        set((s) => {
          const next = { ...s.userHiddenEntities }
          if (next[entityId]) delete next[entityId]
          else next[entityId] = true
          return { userHiddenEntities: next }
        }),
      setEntityHidden: (entityId, hidden) =>
        set((s) => {
          const next = { ...s.userHiddenEntities }
          if (hidden) next[entityId] = true
          else delete next[entityId]
          return { userHiddenEntities: next }
        }),
      decideVisibility: (entityId, hidden) =>
        set((s) => {
          const next = { ...s.userHiddenEntities }
          if (hidden) next[entityId] = true
          else delete next[entityId]
          return {
            userHiddenEntities: next,
            visibilityReviewed: { ...s.visibilityReviewed, [entityId]: true },
          }
        }),
      clearReviewed: (entityIds) =>
        set((s) => {
          const next = { ...s.visibilityReviewed }
          for (const id of entityIds) delete next[id]
          return { visibilityReviewed: next }
        }),
      setKioskMode: (kioskMode) => set({ kioskMode }),
      setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
      toggleServerEntity: (entityId) =>
        set((s) => ({
          serverExtraEntities: s.serverExtraEntities.includes(entityId)
            ? s.serverExtraEntities.filter((id) => id !== entityId)
            : [...s.serverExtraEntities, entityId],
        })),
      setWeatherEnabled: (weatherEnabled) => set({ weatherEnabled }),
      setWeatherEntity: (weatherEntity) => set({ weatherEntity }),
      setExternalTempSource: (externalTempSource) => set({ externalTempSource }),
      setCalendarEnabled: (calendarEnabled) => set({ calendarEnabled }),
      setEnergyEnabled: (energyEnabled) => set({ energyEnabled }),
      setEnergyPowerEntity: (energyPowerEntity) => set({ energyPowerEntity }),
      toggleCalendarEntity: (entityId) =>
        set((s) => ({
          calendarEntities: s.calendarEntities.includes(entityId)
            ? s.calendarEntities.filter((id) => id !== entityId)
            : [...s.calendarEntities, entityId],
        })),
      setWasteEnabled: (wasteEnabled) => set({ wasteEnabled }),
      toggleWasteDay: (typeId, day) =>
        set((s) => {
          const cur = s.wasteSchedule[typeId] ?? []
          const next = cur.includes(day)
            ? cur.filter((d) => d !== day)
            : [...cur, day].sort((a, b) => a - b)
          return { wasteSchedule: { ...s.wasteSchedule, [typeId]: next } }
        }),
      setWasteInterval: (typeId, weeks) =>
        set((s) => ({ wasteInterval: { ...s.wasteInterval, [typeId]: weeks } })),
      setWasteAnchor: (typeId, isoDate) =>
        set((s) => ({ wasteAnchor: { ...s.wasteAnchor, [typeId]: isoDate } })),
      resetSetup: () => set({ ...DEFAULT_CONFIG }),

      setEntities: (entities) => set({ entities }),
      updateEntity: (entityId, entity) =>
        set((s) => ({ entities: { ...s.entities, [entityId]: entity } })),
      setAreas: (areas) => set({ areas }),
      setEntityAreas: (entityAreas) => set({ entityAreas }),
      setEntityDevices: (entityDevices) => set({ entityDevices }),
      setHiddenEntities: (hiddenEntities) => set({ hiddenEntities }),
      setIsAdmin: (isAdmin) => set({ isAdmin }),
      setCurrentUserId: (currentUserId) => set({ currentUserId }),
      setUserPermissions: (userPermissions) => set({ userPermissions }),
      setConnected: (connected) => set({ connected }),
      setLoading: (loading) => set({ loading }),
    }),
    {
      name: 'liquid-dashboard-config',
      partialize: (state) => ({
        hassUrl: state.hassUrl,
        setupComplete: state.setupComplete,
        enabledAreas: state.enabledAreas,
        wallpapers: state.wallpapers,
        theme: state.theme,
        pinnedEntities: state.pinnedEntities,
        userHiddenEntities: state.userHiddenEntities,
        visibilityReviewed: state.visibilityReviewed,
        kioskMode: state.kioskMode,
        onboardingDone: state.onboardingDone,
        serverExtraEntities: state.serverExtraEntities,
        weatherEnabled: state.weatherEnabled,
        weatherEntity: state.weatherEntity,
        externalTempSource: state.externalTempSource,
        calendarEnabled: state.calendarEnabled,
        calendarEntities: state.calendarEntities,
        energyEnabled: state.energyEnabled,
        energyPowerEntity: state.energyPowerEntity,
        wasteEnabled: state.wasteEnabled,
        wasteSchedule: state.wasteSchedule,
        wasteInterval: state.wasteInterval,
        wasteAnchor: state.wasteAnchor,
      }),
    }
  )
)
