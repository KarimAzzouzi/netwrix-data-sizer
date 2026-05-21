import { fmtBytes, tierClass } from '../utils'
import { DatabaseIcon, FolderIcon, ScanIcon, EyeIcon, StorageIcon, ServerIcon } from './Icons'

function KPICard({ label, value, sub, accent, icon }) {
  return (
    <div className={`card p-5 ${accent ? `border-l-4 border-l-[${accent}]` : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-extrabold text-gray-900 dark:text-gray-50 leading-tight truncate">{value}</div>
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-1.5">{label}</div>
          {sub && <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{sub}</div>}
        </div>
        {icon && (
          <div className="ml-3 text-gray-200 dark:text-zinc-700 flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

export default function KPICards({ sizing }) {
  if (!sizing) return null

  const totalDisplay = parseFloat(sizing.totalTB) >= 1
    ? `${sizing.totalTB} TB`
    : `${sizing.totalGB} GB`

  const ndcDisplay = parseFloat(sizing.ndcTB) >= 1
    ? `${sizing.ndcTB} TB`
    : `${sizing.ndcGB} GB`

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <KPICard
        label="Total Scanned Size"
        value={totalDisplay}
        sub={`${Number(sizing.totalFiles).toLocaleString()} total files`}
        icon={<StorageIcon className="w-8 h-8" />}
      />
      <KPICard
        label="Total Files"
        value={Number(sizing.totalFiles).toLocaleString()}
        sub="across all scanned paths"
        icon={<FolderIcon className="w-8 h-8" />}
      />
      <KPICard
        label="NDC Classifiable Size"
        value={ndcDisplay}
        sub={`${sizing.ndcPct}% of total data`}
        icon={<DatabaseIcon className="w-8 h-8" />}
        accent="#10B981"
      />
      <KPICard
        label="NDC Classifiable Files"
        value={Number(sizing.ndcFiles).toLocaleString()}
        sub={`${sizing.ndcPct}% of all files`}
        icon={<ScanIcon className="w-8 h-8" />}
        accent="#10B981"
      />
      <KPICard
        label="OCR Candidates"
        value={Number(sizing.ocrCount).toLocaleString()}
        sub={`${sizing.ocrPct}% of NDC files`}
        icon={<EyeIcon className="w-8 h-8" />}
        accent="#E8702A"
      />
      <div className="card p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="mt-0.5">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${tierClass(sizing.tier)}`}>
                {sizing.tier}
              </span>
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-2">Deployment Tier</div>
            <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{sizing.ndcServers} NDC server{sizing.ndcServers > 1 ? 's' : ''}</div>
          </div>
          <div className="ml-3 text-gray-200 dark:text-zinc-700 flex-shrink-0">
            <ServerIcon className="w-8 h-8" />
          </div>
        </div>
      </div>
    </div>
  )
}
