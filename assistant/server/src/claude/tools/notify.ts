import { z } from 'zod'
import { deviceName } from '../../ha/types.ts'
import { domainOf } from '../../inventory/privacy.ts'
import { loadIndex } from './common.ts'
import type { ToolSpec } from './registry.ts'

// Dove può arrivare una notifica: serve a Claude per CHIEDERE all'utente il dispositivo,
// invece di sceglierlo da solo. Solo nomi di servizi ed entità, nessun dato dei telefoni.

/** Come Home Assistant ricava il nome del servizio dal nome del dispositivo (slugify). */
function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const schema = z.object({})

export const elencaNotifiche: ToolSpec<typeof schema> = {
  name: 'elenca_notifiche',
  description:
    "Dispositivi e servizi a cui un'automazione può mandare una notifica: app di Home Assistant su telefoni e tablet, entità di notifica (notify.send_message), altri servizi notify (es. Alexa) e la notifica nell'interfaccia di Home Assistant. Usalo per chiedere all'utente dove inviare una notifica prima di proporre la bozza.",
  schema,
  label: () => 'Cerco dove inviare le notifiche',
  async run(_input, ctx) {
    const [services, idx] = await Promise.all([ctx.ha.services(), loadIndex(ctx)])
    const notify = [...(services.get('notify') ?? [])].sort()
    // Nome leggibile delle app: dispositivi dell'integrazione mobile_app con lo stesso slug.
    const appNames = new Map<string, string>()
    for (const d of idx.reg.devices) {
      const domains = d.config_entries.map((e) => idx.reg.configEntryDomain[e])
      if (domains.includes('mobile_app')) appNames.set(`mobile_app_${slug(deviceName(d))}`, deviceName(d))
    }
    const apps = notify
      .filter((s) => s.startsWith('mobile_app_'))
      .map((s) => ({ azione: `notify.${s}`, ...(appNames.has(s) ? { dispositivo: appNames.get(s) } : {}), tipo: 'app Home Assistant (telefono o tablet)' }))
    const others = notify
      .filter((s) => !s.startsWith('mobile_app_') && !['notify', 'send_message', 'persistent_notification'].includes(s))
      .map((s) => ({ azione: `notify.${s}`, tipo: s.startsWith('alexa_media') ? 'Alexa (annuncio o notifica)' : 'servizio di notifica' }))
    const entities = [...idx.states.keys()]
      .filter((id) => domainOf(id) === 'notify' && !idx.entries.get(id)?.disabled_by)
      .sort()
      .map((id) => ({ entity_id: id, nome: idx.name(id), uso: 'action: notify.send_message con target entity_id (campi message e title)' }))
    return {
      telefoni_e_tablet: apps,
      entita_di_notifica: entities,
      altri_servizi: others,
      ...(services.get('persistent_notification')?.has('create')
        ? { interfaccia_home_assistant: { azione: 'persistent_notification.create', tipo: "notifica nella campanella dell'interfaccia di Home Assistant" } }
        : {}),
      nota: "Chiedi all'utente quale usare (anche più di uno), senza scegliere tu. notify.notify è un servizio generico che invia al predefinito: non usarlo.",
    }
  },
}
