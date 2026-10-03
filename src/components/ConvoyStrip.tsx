import { fmtPercent, fmtTime, hourTicks } from '../lib/format.ts'
import { MOVING_STATES, STATE_COLORS, STATE_ORDER, STATE_SHORT, stateLabel, stateRuns } from '../lib/states.ts'
import type { PairAnalysis, Thresholds } from '../lib/types.ts'

export function ConvoyStrip({ pair, thresholds }: { pair: PairAnalysis; thresholds: Thresholds }) {
  const samples = pair.samples
  if (samples.length === 0) return null
  const start = samples[0].t
  const end = samples[samples.length - 1].t
  const runs = stateRuns(samples)
  const present = new Set(runs.map((r) => r.state))

  return (
    <div className="strip-block">
      <div className="strip" role="img" aria-label="Estado del convoy minuto a minuto">
        {runs.map((run) => (
          <span
            key={run.fromT}
            className={run.state === 'sinDato' ? 'is-empty' : undefined}
            style={{ flexGrow: run.count, background: run.state === 'sinDato' ? undefined : STATE_COLORS[run.state] }}
            title={`${fmtTime(run.fromT)} a ${fmtTime(run.toT)}: ${STATE_SHORT[run.state]}`}
          />
        ))}
      </div>
      <div className="strip-axis" aria-hidden="true">
        {hourTicks(start, end).map((t) => (
          <span key={t} style={{ left: `${((t - start) / (end - start || 1)) * 100}%` }}>
            {fmtTime(t)}
          </span>
        ))}
      </div>
      <ul className="strip-legend">
        {STATE_ORDER.filter((s) => MOVING_STATES.includes(s) || present.has(s)).map((state) => (
          <li key={state}>
            <i
              className={state === 'sinDato' ? 'is-empty' : undefined}
              style={{ background: state === 'sinDato' ? undefined : STATE_COLORS[state] }}
            />
            <span>{stateLabel(state, thresholds)}</span>
            {MOVING_STATES.includes(state) && <b>{fmtPercent(pair.share[state])}</b>}
          </li>
        ))}
      </ul>
    </div>
  )
}
