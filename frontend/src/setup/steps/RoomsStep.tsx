import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Home, BedDouble, Utensils, Sofa, Bath, Car, TreePine, Dumbbell } from 'lucide-react'
import { createLongLivedTokenAuth, createConnection } from 'home-assistant-js-websocket'
import type { Connection } from 'home-assistant-js-websocket'

async function fetchAreas(conn: Connection) {
  const result = await conn.sendMessagePromise({ type: 'config/area_registry/list' })
  return result as Array<{ area_id: string; name: string; picture: string | null; aliases: string[]; floor_id: string | null; icon: string | null; labels: string[] }>
}
import { useStore } from '../../store'
import { getToken } from '../../hooks/useHA'
import type { HassArea } from '../../types/ha'

interface RoomsStepProps {
  onNext: () => void
}

const AREA_ICONS: Record<string, React.ReactNode> = {
  soggiorno: <Sofa size={20} />,
  sala: <Sofa size={20} />,
  cucina: <Utensils size={20} />,
  camera: <BedDouble size={20} />,
  bagno: <Bath size={20} />,
  garage: <Car size={20} />,
  giardino: <TreePine size={20} />,
  palestra: <Dumbbell size={20} />,
  default: <Home size={20} />,
}

function getAreaIcon(name: string): React.ReactNode {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(AREA_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return AREA_ICONS.default
}

function getAreaGradient(index: number): string {
  const gradients = [
    'linear-gradient(135deg, #667eea, #764ba2)',
    'linear-gradient(135deg, #f093fb, #f5576c)',
    'linear-gradient(135deg, #4facfe, #00f2fe)',
    'linear-gradient(135deg, #43e97b, #38f9d7)',
    'linear-gradient(135deg, #fa709a, #fee140)',
    'linear-gradient(135deg, #a18cd1, #fbc2eb)',
  ]
  return gradients[index % gradients.length]
}

export function RoomsStep({ onNext }: RoomsStepProps) {
  const hassUrl = useStore((s) => s.hassUrl)
  const setEnabledAreas = useStore((s) => s.setEnabledAreas)

  const [areas, setAreas] = useState<HassArea[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const token = getToken()
      if (!token) return

      try {
        const auth = createLongLivedTokenAuth(hassUrl, token)
        const conn = await createConnection({ auth })
        const fetchedAreas = await fetchAreas(conn)
        conn.close()
        setAreas(fetchedAreas)
        setSelected(new Set(fetchedAreas.map((a: { area_id: string }) => a.area_id)))
      } catch (e) {
        console.error('[LD] Errore caricamento aree:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [hassUrl])

  function toggle(areaId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(areaId)) next.delete(areaId)
      else next.add(areaId)
      return next
    })
  }

  function handleNext() {
    setEnabledAreas([...selected])
    onNext()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}
    >
      <div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 8 }}>
          Scegli le stanze
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
          Seleziona le aree da mostrare nella dashboard. Puoi cambiarle in qualsiasi momento.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : areas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-secondary)', fontSize: 14 }}>
          Nessuna area trovata in Home Assistant.
          <br />Creale in Impostazioni → Aree.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {areas.map((area, index) => {
            const isSelected = selected.has(area.area_id)
            return (
              <motion.button
                key={area.area_id}
                className="anim-scale-in"
                style={{
                  animationDelay: `${index * 50}ms`,
                  background: isSelected ? 'var(--glass-bg-active)' : 'var(--glass-bg)',
                  backdropFilter: 'blur(var(--glass-blur))',
                  WebkitBackdropFilter: 'blur(var(--glass-blur))',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease, background 0.2s ease',
                }}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggle(area.area_id)}
              >
                {/* Gradient accent background */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: getAreaGradient(index),
                    opacity: isSelected ? 0.12 : 0,
                    transition: 'opacity 0.3s ease',
                    borderRadius: 'inherit',
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-secondary)', transition: 'color 0.2s ease' }}>
                    {getAreaIcon(area.name)}
                  </div>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Check size={12} color="white" />
                    </motion.div>
                  )}
                </div>

                <div style={{ position: 'relative' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                    {area.name}
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Selezione rapida */}
      {areas.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setSelected(new Set(areas.map((a) => a.area_id)))}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', color: 'var(--text-secondary)', fontSize: 12, padding: '6px 14px', cursor: 'pointer' }}
          >
            Tutte
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', color: 'var(--text-secondary)', fontSize: 12, padding: '6px 14px', cursor: 'pointer' }}
          >
            Nessuna
          </button>
        </div>
      )}

      <motion.button
        className="glass-btn glass-btn-accent"
        whileTap={{ scale: 0.97 }}
        onClick={handleNext}
        disabled={selected.size === 0}
        style={{ width: '100%', opacity: selected.size === 0 ? 0.5 : 1 }}
      >
        Continua ({selected.size} stanze)
      </motion.button>
    </motion.div>
  )
}
