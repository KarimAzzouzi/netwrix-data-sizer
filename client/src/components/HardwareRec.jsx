import { ServerIcon, CpuIcon, MemoryIcon, StorageIcon, AlertIcon } from './Icons'

function RecRow({ label, spec, value, notes, alt }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-zinc-200 border-b border-gray-100 dark:border-zinc-800 whitespace-nowrap">{label}</td>
      <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-zinc-400 border-b border-gray-100 dark:border-zinc-800">{spec}</td>
      <td className="px-4 py-2.5 text-sm font-bold text-[#2A5298] dark:text-[#4A90D9] border-b border-gray-100 dark:border-zinc-800">{value}</td>
      <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-zinc-500 border-b border-gray-100 dark:border-zinc-800">{notes}</td>
    </tr>
  )
}

export default function HardwareRec({ sizing }) {
  if (!sizing) return null

  const { ndcServers, ndcPerServer, sql, index, ocrAdj, notes, ocrNote, storageNote, tier } = sizing
  const ocrAdjStr = ndcPerServer.ocrAdj > 0
    ? ` (${ndcPerServer.baseCores} base + ${ndcPerServer.ocrAdj} OCR)`
    : ''

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-800">
        <table className="data-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Specification</th>
              <th>Value</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <RecRow
              label="NDC Server(s)"
              spec="Count"
              value={`${ndcServers} server${ndcServers > 1 ? 's' : ''}`}
              notes={ndcServers > 1 ? 'Clustered with DQS mode' : 'Single server deployment'}
              alt={false}
            />
            <RecRow
              label=""
              spec="CPU per server"
              value={`${ndcPerServer.cores} cores${ocrAdjStr}`}
              notes="Physical or virtual cores"
              alt={true}
            />
            <RecRow
              label=""
              spec="RAM per server"
              value={`${ndcPerServer.ramGB} GB`}
              notes="Minimum recommended"
              alt={false}
            />
            <RecRow
              label=""
              spec="Index storage"
              value={`${index.storageGB} GB`}
              notes="35% of NDC data — SSD required"
              alt={true}
            />
            <RecRow
              label="SQL Server"
              spec="CPU"
              value={`${sql.cores} cores`}
              notes="Dedicated SQL server recommended"
              alt={false}
            />
            <RecRow
              label=""
              spec="RAM"
              value={`${sql.ramGB} GB`}
              notes="SQL buffer pool memory"
              alt={true}
            />
            <RecRow
              label=""
              spec="Database size"
              value={`${sql.dbSizeGB} GB`}
              notes="~11 KB per indexed object"
              alt={false}
            />
            <RecRow
              label=""
              spec="Autogrowth"
              value={sql.sqlAutogrowth}
              notes="Recovery: Simple | Max size: Unlimited"
              alt={true}
            />
          </tbody>
        </table>
      </div>

      {/* OCR Impact box */}
      {ndcPerServer.ocrAdj > 0 && (
        <div className="mt-4 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-orange-800 dark:text-orange-300 mb-2">
            <AlertIcon className="w-4 h-4" />
            OCR Workload Impact
          </div>
          <p className="text-sm text-orange-700 dark:text-orange-300 leading-relaxed">{ocrNote}</p>
          <div className="flex gap-5 mt-3">
            <div className="text-center">
              <div className="text-xl font-extrabold text-orange-700 dark:text-orange-300">+{ndcPerServer.ocrAdj}</div>
              <div className="text-xs text-orange-600 dark:text-orange-400 uppercase tracking-wider mt-0.5">Extra Cores / Server</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-extrabold text-orange-700 dark:text-orange-300">{sizing.ocrPct}%</div>
              <div className="text-xs text-orange-600 dark:text-orange-400 uppercase tracking-wider mt-0.5">OCR Workload</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-extrabold text-orange-700 dark:text-orange-300">{Number(sizing.ocrEffective || 0).toLocaleString()}</div>
              <div className="text-xs text-orange-600 dark:text-orange-400 uppercase tracking-wider mt-0.5">Effective OCR Files</div>
            </div>
          </div>
        </div>
      )}

      {/* Notes box */}
      <div className="mt-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <div className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-2">Deployment Notes</div>
        <ul className="text-sm text-amber-800 dark:text-amber-300 space-y-1.5">
          <li className="leading-relaxed">{notes}</li>
          {storageNote && <li className="leading-relaxed">{storageNote}</li>}
        </ul>
      </div>
    </div>
  )
}
