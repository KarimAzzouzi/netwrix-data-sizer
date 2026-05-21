import KPICards from './KPICards'
import { PieChart, BarChart } from './Charts'
import FileTree from './FileTree'
import HardwareRec from './HardwareRec'
import ExtensionAnalysis from './ExtensionAnalysis'
import { PieChartIcon, BarChartIcon, TreeIcon, ServerIcon, ExcelIcon, PdfIcon } from './Icons'
import { fmtBytes } from '../utils'
import { exportExcel, exportPDF } from '../api'

export default function Results({ data, addToast }) {
  if (!data) return null

  const { tree, sizing, scanPaths, deepScan, includeHidden } = data

  async function handleExcelExport() {
    try {
      await exportExcel({ tree, sizing, scanPaths })
      addToast('Excel report exported successfully.', 'success')
    } catch (e) {
      addToast('Export failed: ' + e.message, 'error')
    }
  }

  async function handlePDFExport() {
    try {
      await exportPDF({ tree, sizing, scanPaths })
      addToast('PDF report exported successfully.', 'success')
    } catch (e) {
      addToast('Export failed: ' + e.message, 'error')
    }
  }

  // Prepare top folders bar chart data
  const topFolders = (tree.children || []).slice(0, 10).map(c => ({
    ext: c.name,
    count: c.size,
    size: c.size,
  }))

  // Prepare top extensions bar chart data
  const topExts = (tree.supported || []).slice(0, 12)

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <KPICards sizing={sizing} />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <div className="flex items-center gap-2 card-title">
            <PieChartIcon className="w-4 h-4" />
            File Categories
          </div>
          <PieChart data={tree.categories || []} />
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 card-title">
            <BarChartIcon className="w-4 h-4" />
            Top Extensions by Count
          </div>
          <BarChart
            data={topExts}
            valueKey="count"
            labelKey="ext"
          />
        </div>
      </div>

      {/* Tree + Top Folders row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <div className="flex items-center gap-2 card-title">
            <TreeIcon className="w-4 h-4" />
            Directory Tree
            <span className="ml-auto text-gray-400 dark:text-zinc-500 normal-case font-normal text-xs">Right-click for options</span>
          </div>
          <FileTree tree={tree} />
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 card-title">
            <BarChartIcon className="w-4 h-4" />
            Top Folders by Size
          </div>
          <BarChart
            data={topFolders}
            valueKey="size"
            labelKey="ext"
            formatValue={(v) => fmtBytes(v)}
          />
        </div>
      </div>

      {/* Hardware Recommendations */}
      <div className="card p-6">
        <div className="flex items-center gap-2 card-title">
          <ServerIcon className="w-4 h-4" />
          NDC Hardware Recommendations
        </div>
        <HardwareRec sizing={sizing} />
      </div>

      {/* Extension Analysis */}
      <div className="card p-6">
        <div className="flex items-center gap-2 card-title">
          Extension Analysis
        </div>
        <ExtensionAnalysis tree={tree} sizing={sizing} />
      </div>

      {/* Export buttons */}
      <div className="flex gap-3 flex-wrap pb-8">
        <button className="btn btn-success" onClick={handleExcelExport}>
          <ExcelIcon className="w-4 h-4" />
          Export Excel (.xlsx)
        </button>
        <button className="btn btn-orange" onClick={handlePDFExport}>
          <PdfIcon className="w-4 h-4" />
          Export PDF
        </button>
      </div>
    </div>
  )
}
