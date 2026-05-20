import { fmtBytes } from '../utils'

export function PieChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">No category data available.</p>
  }

  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return <p className="text-slate-400 text-sm text-center py-8">No data to display.</p>

  const SIZE = 160
  const CX = SIZE / 2
  const CY = SIZE / 2
  const R = 60
  const INNER_R = 36

  let cumAngle = -Math.PI / 2
  const slices = data.map(d => {
    const angle = (d.count / total) * 2 * Math.PI
    const start = cumAngle
    cumAngle += angle
    return { ...d, startAngle: start, endAngle: cumAngle }
  })

  function arcPath(startAngle, endAngle, r, cx, cy) {
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
  }

  function donutSlicePath(s) {
    const { startAngle, endAngle } = s
    const outerStart = {
      x: CX + R * Math.cos(startAngle),
      y: CY + R * Math.sin(startAngle)
    }
    const outerEnd = {
      x: CX + R * Math.cos(endAngle),
      y: CY + R * Math.sin(endAngle)
    }
    const innerStart = {
      x: CX + INNER_R * Math.cos(endAngle),
      y: CY + INNER_R * Math.sin(endAngle)
    }
    const innerEnd = {
      x: CX + INNER_R * Math.cos(startAngle),
      y: CY + INNER_R * Math.sin(startAngle)
    }
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
      'Z'
    ].join(' ')
  }

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg width={SIZE} height={SIZE} className="flex-shrink-0">
        {slices.map((s, i) => (
          <path
            key={i}
            d={donutSlicePath(s)}
            fill={s.color}
            stroke="white"
            strokeWidth="1.5"
          />
        ))}
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1B3A6B">
          {total.toLocaleString()}
        </text>
        <text x={CX} y={CY + 8} textAnchor="middle" fontSize="8" fill="#6B7280">
          files
        </text>
      </svg>
      <div className="flex-1 min-w-[120px]">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <div
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-slate-600 flex-1 truncate">{s.name}</span>
            <span className="text-xs font-semibold text-slate-500">
              {((s.count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BarChart({ data, valueKey = 'count', labelKey = 'ext', colorKey = 'color', formatValue }) {
  if (!data || data.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">No data available.</p>
  }

  const top = data.slice(0, 12)
  const max = Math.max(...top.map(d => d[valueKey] || 0))
  if (max === 0) return <p className="text-slate-400 text-sm text-center py-8">No data to display.</p>

  const defaultColors = [
    '#1B3A6B','#2A5298','#3B82F6','#60A5FA','#93C5FD',
    '#10B981','#34D399','#F59E0B','#F97316','#EF4444',
    '#8B5CF6','#EC4899'
  ]

  return (
    <div className="space-y-2">
      {top.map((d, i) => {
        const val = d[valueKey] || 0
        const pct = max > 0 ? (val / max) * 100 : 0
        const color = d[colorKey] || defaultColors[i % defaultColors.length]
        const label = d[labelKey] || ''
        const display = formatValue ? formatValue(val, d) : val.toLocaleString()
        return (
          <div key={i} className="flex items-center gap-2.5 text-xs">
            <div className="w-24 text-slate-600 font-medium truncate text-right flex-shrink-0">{label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: color, minWidth: '2px' }}
              />
            </div>
            <div className="w-16 text-slate-500 font-semibold text-right flex-shrink-0">{display}</div>
          </div>
        )
      })}
    </div>
  )
}
