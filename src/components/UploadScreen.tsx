import { useRef, useState, type DragEvent } from 'react'

interface Props {
  busy: boolean
  error: string | null
  onFile: (file: File) => void
  onExample: () => void
  /** Excel con datos ficticios en el formato esperado, para descargar y usar de guía. */
  templateUrl: string
}

export function UploadScreen({ busy, error, onFile, onExample, templateUrl }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <main className="upload">
      <div className="upload-intro">
        <p className="brand">Reporte GPS</p>
        <h1>¿Viajaron juntas tus unidades?</h1>
        <p className="lead">
          Carga el reporte de la plataforma GPS y compara el recorrido de cada vehículo, la distancia que mantuvieron
          entre sí y los puntos donde el convoy se abrió.
        </p>
        <dl className="facts">
          <div>
            <dt>Qué archivo cargar</dt>
            <dd>El reporte «Detallado (varios vehículos)» exportado a Excel, sin modificar.</dd>
          </div>
          <div>
            <dt>Dónde se procesa</dt>
            <dd>En este equipo. El archivo no se envía a ningún servidor ni se guarda.</dd>
          </div>
          <div>
            <dt>Qué obtienes</dt>
            <dd>Resumen por vehículo, mapa, separación en el tiempo y un reporte en PDF.</dd>
          </div>
        </dl>
      </div>

      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
        <div className="lane" aria-hidden="true" />
        <p className="dropzone-title">{busy ? 'Leyendo el reporte…' : 'Arrastra aquí el Excel del reporte'}</p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          Elegir archivo
        </button>
        <div className="dropzone-links">
          <button type="button" className="btn-link" disabled={busy} onClick={onExample}>
            Probar con datos de ejemplo
          </button>
          <a className="btn-link" href={templateUrl} download="plantilla-reporte-gps.xlsx">
            Descargar plantilla de Excel
          </a>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
