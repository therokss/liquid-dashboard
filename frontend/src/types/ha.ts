export interface HassEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
  last_updated: string
  context: { id: string; parent_id: string | null; user_id: string | null }
}

export interface HassArea {
  area_id: string
  name: string
  picture: string | null
  aliases: string[]
  floor_id: string | null
  icon: string | null
  labels: string[]
}

export interface HassDevice {
  id: string
  area_id: string | null
  name: string
  name_by_user: string | null
  model: string | null
  manufacturer: string | null
}

export interface HassEntityRegistry {
  entity_id: string
  unique_id: string
  platform: string
  device_id: string | null
  area_id: string | null
  name: string | null
  icon: string | null
  disabled_by: string | null
  hidden_by: string | null
  labels: string[]
}

export type LightColorMode = 'color_temp' | 'rgb' | 'rgbw' | 'hs' | 'xy' | 'brightness' | 'onoff'

export interface LightAttributes {
  friendly_name?: string
  supported_color_modes?: LightColorMode[]
  color_mode?: LightColorMode
  brightness?: number
  color_temp?: number
  hs_color?: [number, number]
  rgb_color?: [number, number, number]
  min_color_temp_kelvin?: number
  max_color_temp_kelvin?: number
  min_mireds?: number
  max_mireds?: number
  icon?: string
}

export interface ClimateAttributes {
  friendly_name?: string
  hvac_modes?: string[]
  current_temperature?: number
  temperature?: number
  target_temp_step?: number
  min_temp?: number
  max_temp?: number
  unit_of_measurement?: string
  preset_mode?: string
  preset_modes?: string[]
  fan_mode?: string
  hvac_action?: string
}

export interface MediaPlayerAttributes {
  friendly_name?: string
  media_title?: string
  media_artist?: string
  media_album_name?: string
  entity_picture?: string
  volume_level?: number
  is_volume_muted?: boolean
  source?: string
  source_list?: string[]
  media_duration?: number
  media_position?: number
  media_content_type?: string
  supported_features?: number
}

export interface SensorAttributes {
  friendly_name?: string
  unit_of_measurement?: string
  device_class?: string
  state_class?: string
  icon?: string
}

export interface WeatherAttributes {
  friendly_name?: string
  temperature?: number
  temperature_unit?: string
  humidity?: number
  pressure?: number
  wind_speed?: number
  wind_speed_unit?: string
  wind_bearing?: number
  apparent_temperature?: number
}

export interface WeatherForecast {
  datetime: string
  condition?: string
  temperature?: number
  templow?: number
  precipitation?: number
  precipitation_probability?: number
}

export interface CalendarEvent {
  start: string        // ISO date o date-time
  end: string
  summary: string
  description?: string
  location?: string
}

export type EntityDomain =
  | 'light'
  | 'switch'
  | 'climate'
  | 'media_player'
  | 'sensor'
  | 'binary_sensor'
  | 'cover'
  | 'fan'
  | 'input_boolean'
  | 'scene'
  | 'script'
  | 'automation'
  | 'weather'
  | 'calendar'
  | 'lock'
  | 'vacuum'
  | 'humidifier'

export function getDomain(entityId: string): EntityDomain {
  return entityId.split('.')[0] as EntityDomain
}
