import { useCallback, useEffect, useState } from 'react'
import { Results } from './components/Results.tsx'
import { UploadScreen } from './components/UploadScreen.tsx'
import { FormatError, parseReport } from './lib/parser.ts'
import type { ParsedReport } from './lib/types.ts'

const EXAMPLE_URL = `${import.meta.env.BASE_URL}ejemplo/reporte-ejemplo.xlsx`
const EXAMPLE_NAME = 'reporte-ejemplo.xlsx'

export function App() {
  const [loaded, setLoaded] = useState<{ report: ParsedReport; fileName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (read: () => Promise<ArrayBuffer>, fileName: string) => {
    setBusy(true)
    setError(null)
    try {
      setLoaded({ report: parseReport(await read()), fileName })
    } catch (e) {
      setError(e instanceof FormatError ? e.message : 'No se pudo leer el archivo. Intenta exportarlo de nuevo desde la plataforma GPS.')
    } finally {
      setBusy(false)
    }
  }, [])

  const loadFile = useCallback((file: File) => load(() => file.arrayBuffer(), file.name), [load])

  const loadExample = useCallback(
    () =>
      load(async () => {
        const response = await fetch(EXAMPLE_URL)
        if (!response.ok) throw new FormatError('No se encontró el archivo de ejemplo. Genéralo con "npm run ejemplo".')
        return response.arrayBuffer()
      }, EXAMPLE_NAME),
    [load],
  )

  // Abrir la página con ?ejemplo=1 carga directamente los datos ficticios.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('ejemplo')) loadExample()
  }, [loadExample])

  if (loaded) {
    return <Results report={loaded.report} fileName={loaded.fileName} onReset={() => setLoaded(null)} />
  }
  return <UploadScreen busy={busy} error={error} onFile={loadFile} onExample={loadExample} templateUrl={EXAMPLE_URL} />
}
