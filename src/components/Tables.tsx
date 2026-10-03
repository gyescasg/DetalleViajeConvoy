import { fmtDateTime, fmtDuration, fmtKm, fmtNumber, fmtSeparation } from '../lib/format.ts'
import type { PairAnalysis, VehicleSummary } from '../lib/types.ts'

export function SummaryTable({
  summaries,
  colorOf,
  speedLimit,
}: {
  summaries: VehicleSummary[]
  colorOf: (plate: string) => string
  speedLimit: number
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Vehículo</th>
            <th>Inicio</th>
            <th>Fin</th>
            <th className="num">Recorrido</th>
            <th className="num">En movimiento</th>
            <th className="num">Detenido</th>
            <th className="num">Vel. máxima</th>
            <th className="num">Vel. promedio</th>
            <th>Sobre {fmtNumber(speedLimit)} km/h</th>
            <th className="num">Registros</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.plate}>
              <th scope="row">
                <i className="swatch" style={{ background: colorOf(s.plate) }} />
                {s.plate}
              </th>
              <td>
                {fmtDateTime(s.startT)}
                <small>{s.startRef}</small>
              </td>
              <td>
                {fmtDateTime(s.endT)}
                <small>{s.endRef}</small>
              </td>
              <td className="num">
                {fmtKm(s.gpsKm)}
                <small>{s.odoKm === null ? 'Odómetro sin dato' : `Odómetro ${fmtKm(s.odoKm)}`}</small>
              </td>
              <td className="num">{fmtDuration(s.movingMs)}</td>
              <td className="num">{fmtDuration(s.stoppedMs)}</td>
              <td className="num">{fmtNumber(s.maxSpeed)} km/h</td>
              <td className="num">{fmtNumber(s.avgMovingSpeed)} km/h</td>
              <td>
                {s.speedingPoints > 0 ? fmtDuration(s.speedingMs) : 'Sin excesos'}
                {s.speedingPoints > 0 && <small>{fmtNumber(s.speedingPoints)} registros</small>}
              </td>
              <td className="num">{fmtNumber(s.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PeaksTable({ pair }: { pair: PairAnalysis }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="num">N.º</th>
            <th>Hora</th>
            <th className="num">Separación</th>
            <th>{pair.plateA}</th>
            <th>{pair.plateB}</th>
          </tr>
        </thead>
        <tbody>
          {pair.peaks.map((p, i) => (
            <tr key={p.t}>
              <td className="num">
                <span className="peak-badge">{i + 1}</span>
              </td>
              <td>{fmtDateTime(p.t)}</td>
              <td className="num strong">{fmtSeparation(p.km)}</td>
              <td>
                {p.refA || 'Sin referencia'}
                <small>{fmtNumber(p.speedA)} km/h</small>
              </td>
              <td>
                {p.refB || 'Sin referencia'}
                <small>{fmtNumber(p.speedB)} km/h</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EventsTable({ summaries }: { summaries: VehicleSummary[] }) {
  const rows = summaries.flatMap((s) => s.events.map((e) => ({ plate: s.plate, ...e })))
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Vehículo</th>
            <th>Evento</th>
            <th className="num">Cantidad</th>
            <th>Primero</th>
            <th>Último</th>
            <th>Lugar del primero</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.plate}-${e.type}`}>
              <th scope="row">{e.plate}</th>
              <td>{e.type}</td>
              <td className="num">{fmtNumber(e.count)}</td>
              <td>{fmtDateTime(e.firstT)}</td>
              <td>{fmtDateTime(e.lastT)}</td>
              <td>{e.firstRef || 'Sin referencia'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
