import { useRef, useState } from 'react'
import { thresholdsError } from '../lib/states.ts'
import { DEFAULT_THRESHOLDS, type Thresholds } from '../lib/types.ts'
import type { CapturedImage } from './EChart.tsx'

export interface Company {
  name: string
  logo: CapturedImage | null
}

interface Props {
  plates: string[]
  pair: [string, string] | null
  onPair: (pair: [string, string]) => void
  thresholds: Thresholds
  onThresholds: (thresholds: Thresholds) => void
  company: Company
  onCompany: (company: Company) => void
}

const FIELDS: { key: keyof Thresholds; label: string; unit: string }[] = [
  { key: 'bandMinM', label: 'Banda de convoy, mínimo', unit: 'm' },
  { key: 'bandMaxM', label: 'Banda de convoy, máximo', unit: 'm' },
  { key: 'alertM', label: 'Alerta a partir de', unit: 'm' },
  { key: 'criticalM', label: 'Crítico a partir de', unit: 'm' },
  { key: 'speedLimitKmh', label: 'Límite de velocidad', unit: 'km/h' },
  { key: 'briefS', label: 'Exceso breve, hasta', unit: 's' },
  { key: 'longS', label: 'Exceso prolongado, desde', unit: 's' },
  { key: 'minStopMin', label: 'Parada prolongada, desde', unit: 'min' },
]

const LOGO_MAX_PX = 600

const toDraft = (th: Thresholds) =>
  Object.fromEntries(FIELDS.map((f) => [f.key, String(th[f.key])])) as Record<keyof Thresholds, string>

/** Convierte cualquier imagen (incluido SVG) a PNG, el formato que el PDF acepta sin sorpresas. */
function readLogo(file: File): Promise<CapturedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight, 1))
      const width = Math.max(1, Math.round((img.naturalWidth || LOGO_MAX_PX) * scale))
      const height = Math.max(1, Math.round((img.naturalHeight || LOGO_MAX_PX) * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve({ url: canvas.toDataURL('image/png'), width, height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('imagen no válida'))
    }
    img.src = url
  })
}

export function SettingsPanel({ plates, pair, onPair, thresholds, onThresholds, company, onCompany }: Props) {
  const [draft, setDraft] = useState(() => toDraft(thresholds))
  const [error, setError] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  const update = (next: Record<keyof Thresholds, string>) => {
    setDraft(next)
    const parsed = Object.fromEntries(FIELDS.map((f) => [f.key, Number(next[f.key])])) as unknown as Thresholds
    const problem = thresholdsError(parsed)
    setError(problem)
    // Un valor a medio escribir no recalcula nada: se conserva el último análisis válido.
    if (!problem) onThresholds(parsed)
  }

  return (
    <aside className="panel">
      {pair && plates.length > 2 && (
        <section>
          <h2>Unidades a comparar</h2>
          {([0, 1] as const).map((slot) => (
            <label key={slot} className="field">
              <span>{slot === 0 ? 'Unidad A' : 'Unidad B'}</span>
              <select
                value={pair[slot]}
                onChange={(e) => {
                  const next: [string, string] = [...pair]
                  // Elegir la placa que ya ocupa el otro lugar las intercambia.
                  if (e.target.value === pair[1 - slot]) next[1 - slot] = pair[slot]
                  next[slot] = e.target.value
                  onPair(next)
                }}
              >
                {plates.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}

      <section>
        <h2>Umbrales</h2>
        <p className="hint">Valores sugeridos. Cámbialos antes de exportar si tu operación usa otros.</p>
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <span className="with-unit">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={draft[f.key]}
                onChange={(e) => update({ ...draft, [f.key]: e.target.value })}
              />
              <em>{f.unit}</em>
            </span>
          </label>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn-link" onClick={() => update(toDraft(DEFAULT_THRESHOLDS))}>
          Restablecer valores sugeridos
        </button>
      </section>

      <section>
        <h2>Datos para el reporte</h2>
        <p className="hint">Opcionales. Aparecen en el encabezado del PDF.</p>
        <label className="field">
          <span>Nombre de la empresa</span>
          <input
            type="text"
            value={company.name}
            maxLength={80}
            onChange={(e) => onCompany({ ...company, name: e.target.value })}
          />
        </label>
        <div className="field">
          <span>Logo</span>
          <input
            ref={logoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                onCompany({ ...company, logo: await readLogo(file) })
                setLogoError(null)
              } catch {
                setLogoError('No se pudo leer la imagen. Usa un archivo PNG, JPG o SVG.')
              }
            }}
          />
          {company.logo ? (
            <div className="logo-preview">
              <img src={company.logo.url} alt="Logo cargado" />
              <button type="button" className="btn-link" onClick={() => onCompany({ ...company, logo: null })}>
                Quitar logo
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => logoInput.current?.click()}>
              Elegir logo
            </button>
          )}
          {logoError && (
            <p className="error" role="alert">
              {logoError}
            </p>
          )}
        </div>
      </section>
    </aside>
  )
}
