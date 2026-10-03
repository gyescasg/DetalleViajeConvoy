import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  DataZoomComponent,
  CanvasRenderer,
])

export interface CapturedImage {
  url: string
  width: number
  height: number
}

export interface ImageHandle {
  /** Imagen del gráfico tal como se ve, para incrustarla en el PDF. */
  getImage(): CapturedImage | null
}

interface Props {
  option: EChartsCoreOption
  height: number
  label: string
  ref?: Ref<ImageHandle>
}

export function EChart({ option, height, label, ref }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!host.current) return
    const instance = echarts.init(host.current)
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, true)
  }, [option])

  useImperativeHandle(ref, () => ({
    getImage() {
      const instance = chart.current
      if (!instance) return null
      return {
        url: instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }),
        width: instance.getWidth(),
        height: instance.getHeight(),
      }
    },
  }))

  return <div ref={host} className="chart" style={{ height }} role="img" aria-label={label} />
}
