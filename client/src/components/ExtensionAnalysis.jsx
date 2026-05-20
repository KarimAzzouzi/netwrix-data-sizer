import { useState } from 'react'
import { fmtBytes } from '../utils'
import { CheckIcon, AlertIcon, EyeIcon } from './Icons'

const CAT_COLORS = {
  Documents: '#3B82F6',
  Spreadsheets: '#10B981',
  Presentations: '#F59E0B',
  Images: '#EC4899',
  Email: '#8B5CF6',
  Archives: '#64748B',
  Media: '#EF4444',
  'Web/Markup': '#F97316',
  'CAD/Design': '#14B8A6',
  'Office Other': '#A78BFA',
  'Code/Text': '#0EA5E9',
  Other: '#94A3B8'
}

function CategoryBadge({ name }) {
  const color = CAT_COLORS[name] || CAT_COLORS.Other
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {name}
    </span>
  )
}

function SupportedTab({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">No supported extensions found.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Extension</th>
            <th>Category</th>
            <th className="text-right">File Count</th>
            <th className="text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s, i) => (
            <tr key={i}>
              <td className="font-mono text-[#1B3A6B] font-semibold">{s.ext}</td>
              <td><CategoryBadge name={s.category || 'Other'} /></td>
              <td className="text-right font-semibold text-slate-700">{s.count.toLocaleString()}</td>
              <td className="text-right text-slate-500">{fmtBytes(s.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UnsupportedTab({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">No unsupported extensions found.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Extension</th>
            <th className="text-right">Count</th>
            <th className="text-right">Size</th>
            <th>Example Path</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u, i) => (
            <tr key={i}>
              <td className="font-mono text-slate-600 font-semibold">{u.ext}</td>
              <td className="text-right font-semibold text-slate-700">{u.count.toLocaleString()}</td>
              <td className="text-right text-slate-500">{fmtBytes(u.size)}</td>
              <td className="text-xs text-slate-400 truncate max-w-[260px]" title={u.sample}>{u.sample || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OCRTab({ ocr, ocrPotential, sizing }) {
  const hasDefinite = ocr && ocr.length > 0
  const hasPotential = ocrPotential && ocrPotential.length > 0

  if (!hasDefinite && !hasPotential) {
    return <p className="text-slate-400 text-sm text-center py-8">No OCR candidates found.</p>
  }

  return (
    <div className="space-y-5">
      {/* Summary box */}
      {sizing && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex flex-wrap gap-6">
          <div className="text-center">
            <div className="text-2xl font-extrabold text-orange-700">{Number(sizing.ocrCount || 0).toLocaleString()}</div>
            <div className="text-xs text-orange-600 uppercase tracking-wider mt-0.5">Definite OCR</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-extrabold text-orange-700">{Number(sizing.ocrPotentialCount || 0).toLocaleString()}</div>
            <div className="text-xs text-orange-600 uppercase tracking-wider mt-0.5">Potential OCR</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-extrabold text-orange-700">{sizing.ocrPct}%</div>
            <div className="text-xs text-orange-600 uppercase tracking-wider mt-0.5">of NDC Files</div>
          </div>
          {sizing.ocrPotentialCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-extrabold text-orange-700">{sizing.ocrPotentialPct}%</div>
              <div className="text-xs text-orange-600 uppercase tracking-wider mt-0.5">Potential Rate</div>
            </div>
          )}
        </div>
      )}

      {hasDefinite && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Definite OCR — Pure Image Files
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Extension</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">Size</th>
                </tr>
              </thead>
              <tbody>
                {ocr.map((o, i) => (
                  <tr key={i}>
                    <td className="font-mono text-[#1B3A6B] font-semibold">{o.ext}</td>
                    <td className="text-right font-semibold text-slate-700">{o.count.toLocaleString()}</td>
                    <td className="text-right text-slate-500">{fmtBytes(o.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasPotential && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Potential OCR — Documents / PDFs (30% estimated)
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Extension</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Est. OCR (30%)</th>
                </tr>
              </thead>
              <tbody>
                {ocrPotential.map((o, i) => (
                  <tr key={i}>
                    <td className="font-mono text-slate-600 font-semibold">{o.ext}</td>
                    <td className="text-right font-semibold text-slate-700">{o.count.toLocaleString()}</td>
                    <td className="text-right text-slate-500">{fmtBytes(o.size)}</td>
                    <td className="text-right text-orange-600 font-semibold">{Math.round(o.count * 0.3).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-2 italic">
            Conservative estimate: 30% of office/PDF files assumed to contain embedded raster images.
            Enable Deep OCR Analysis for exact detection.
          </p>
        </div>
      )}
    </div>
  )
}

export default function ExtensionAnalysis({ tree, sizing }) {
  const [activeTab, setActiveTab] = useState('supported')

  if (!tree) return null

  const supported = tree.supported || []
  const unsupported = tree.unsupported || []
  const ocr = tree.ocr || []
  const ocrPotential = tree.ocrPotential || []

  const tabs = [
    {
      id: 'supported',
      label: 'Supported',
      count: supported.length,
      icon: <CheckIcon className="w-3.5 h-3.5" />,
      color: 'text-emerald-600',
      badgeColor: 'bg-emerald-100 text-emerald-700',
    },
    {
      id: 'unsupported',
      label: 'Unsupported',
      count: unsupported.length,
      icon: <AlertIcon className="w-3.5 h-3.5" />,
      color: 'text-amber-600',
      badgeColor: 'bg-amber-100 text-amber-700',
    },
    {
      id: 'ocr',
      label: 'OCR Required',
      count: ocr.length + ocrPotential.length,
      icon: <EyeIcon className="w-3.5 h-3.5" />,
      color: 'text-orange-600',
      badgeColor: 'bg-orange-100 text-orange-700',
    },
  ]

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`tab-btn flex items-center gap-2 ${activeTab === t.id ? 'active' : ''}`}
          >
            <span className={activeTab === t.id ? 'text-[#1B3A6B]' : t.color}>{t.icon}</span>
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${t.badgeColor}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'supported' && <SupportedTab data={supported} />}
      {activeTab === 'unsupported' && <UnsupportedTab data={unsupported} />}
      {activeTab === 'ocr' && <OCRTab ocr={ocr} ocrPotential={ocrPotential} sizing={sizing} />}
    </div>
  )
}
