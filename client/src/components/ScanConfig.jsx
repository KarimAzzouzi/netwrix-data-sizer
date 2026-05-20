import { useState, useEffect } from 'react'
import { FolderIcon, NetworkIcon, ServerIcon, PlusIcon, XIcon, ScanIcon } from './Icons'
import { getDrives, listShares as apiListShares, scan as apiScan } from '../api'
import SharePointPanel from './SharePointPanel'

const CloudIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
  </svg>
)

export default function ScanConfig({ onScanComplete, scanning, setScanning, addToast }) {
  const [mode, setMode] = useState('local')
  const [drives, setDrives] = useState([])
  const [selectedDrive, setSelectedDrive] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [networkPath, setNetworkPath] = useState('')
  const [serverHost, setServerHost] = useState('')
  const [shares, setShares] = useState([])
  const [sharesVisible, setSharesVisible] = useState(false)
  const [selectedShares, setSelectedShares] = useState(new Set())
  const [scanPaths, setScanPaths] = useState([])
  const [spTargets, setSpTargets] = useState([])
  const [spCreds, setSpCreds] = useState(null)
  const [deepScan, setDeepScan] = useState(false)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [progress, setProgress] = useState(0)
  const [listingShares, setListingShares] = useState(false)

  useEffect(() => {
    getDrives().then(d => {
      setDrives(d)
      if (d.length > 0) setSelectedDrive(d[0].letter)
    }).catch(() => {})
  }, [])

  function addPath(p) {
    p = p.trim()
    if (!p) return
    if (scanPaths.includes(p)) return
    setScanPaths(prev => [...prev, p])
  }

  function removePath(i) {
    setScanPaths(prev => prev.filter((_, idx) => idx !== i))
  }

  function removeSpTarget(i) {
    setSpTargets(prev => prev.filter((_, idx) => idx !== i))
  }

  function addLocalPath() {
    const p = localPath.trim() || selectedDrive
    if (!p) { addToast('Please select a drive or enter a path.', 'warning'); return }
    addPath(p)
    setLocalPath('')
  }

  function addNetworkPath() {
    const raw = networkPath.trim()
    if (!raw) { addToast('Please enter a network share path.', 'warning'); return }
    raw.split(';').forEach(p => { if (p.trim()) addPath(p.trim()) })
    setNetworkPath('')
  }

  async function handleListShares() {
    const host = serverHost.trim()
    if (!host) { addToast('Please enter a server hostname.', 'warning'); return }
    setListingShares(true)
    try {
      const result = await apiListShares(host)
      setShares(result)
      setSharesVisible(true)
      setSelectedShares(new Set())
      if (result.length === 0) addToast(`No shares found on ${host}`, 'info')
    } catch (e) {
      addToast('Could not list shares: ' + e.message, 'error')
    } finally {
      setListingShares(false)
    }
  }

  function toggleShare(unc) {
    setSelectedShares(prev => {
      const next = new Set(prev)
      if (next.has(unc)) next.delete(unc); else next.add(unc)
      return next
    })
  }

  function addSelectedShares() {
    if (selectedShares.size === 0) { addToast('Select at least one share.', 'warning'); return }
    selectedShares.forEach(unc => addPath(unc))
    setSelectedShares(new Set())
  }

  function handleAddSpTargets(targets, creds) {
    setSpTargets(prev => {
      const existingIds = new Set(prev.map(t => t.id))
      const newTargets = targets.filter(t => !existingIds.has(t.id))
      return [...prev, ...newTargets]
    })
    setSpCreds(creds)
  }

  const totalItems = scanPaths.length + spTargets.length

  async function startScan() {
    if (totalItems === 0) { addToast('Add at least one path or SharePoint/OneDrive target to scan.', 'warning'); return }
    setScanning(true)
    setProgress(10)
    const timer = setInterval(() => setProgress(p => Math.min(p + 3, 88)), 400)

    try {
      let fsResult = null
      let spResult = null

      if (scanPaths.length > 0) {
        fsResult = await apiScan(scanPaths, deepScan, includeHidden)
      }

      if (spTargets.length > 0 && spCreds) {
        const resp = await fetch('/api/sharepoint/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...spCreds, targets: spTargets })
        })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error || 'SharePoint scan failed')
        spResult = data
      }

      clearInterval(timer)
      setProgress(100)
      setTimeout(() => setProgress(0), 600)

      // Merge results if both ran
      let final
      if (fsResult && spResult) {
        const resp2 = await fetch('/api/merge-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ results: [fsResult, spResult] })
        })
        final = await resp2.json()
      } else {
        final = fsResult || spResult
      }

      onScanComplete(final)
      addToast('Scan completed successfully.', 'success')
    } catch (e) {
      addToast('Scan failed: ' + e.message, 'error')
      clearInterval(timer)
    } finally {
      setScanning(false)
    }
  }

  const tabs = [
    { id: 'local',      label: 'Local Drive',        icon: <FolderIcon className="w-4 h-4" /> },
    { id: 'network',    label: 'Network Share',       icon: <NetworkIcon className="w-4 h-4" /> },
    { id: 'server',     label: 'File Server',         icon: <ServerIcon className="w-4 h-4" /> },
    { id: 'sharepoint', label: 'SharePoint / OneDrive', icon: <CloudIcon className="w-4 h-4" /> },
  ]

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 card-title">
        <ScanIcon className="w-4 h-4" />
        Scan Configuration
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-5 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            className={`tab-btn flex items-center gap-2 ${mode === t.id ? 'active' : ''}`}
          >
            {t.icon}
            {t.label}
            {t.id === 'sharepoint' && spTargets.length > 0 && (
              <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 font-bold">{spTargets.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Local Drive panel */}
      {mode === 'local' && (
        <div className="flex gap-2 mb-4">
          <select
            value={selectedDrive}
            onChange={e => setSelectedDrive(e.target.value)}
            className="input-field flex-none w-40"
          >
            {drives.length === 0 && <option value="">Loading...</option>}
            {drives.map(d => (
              <option key={d.letter} value={d.letter}>
                {d.letter}{d.label ? ` — ${d.label}` : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="input-field"
            placeholder="Or type a custom path, e.g. C:\Users\Data"
            value={localPath}
            onChange={e => setLocalPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addLocalPath()}
          />
          <button className="btn btn-secondary whitespace-nowrap" onClick={addLocalPath}>
            <PlusIcon className="w-4 h-4" /> Add
          </button>
        </div>
      )}

      {/* Network Share panel */}
      {mode === 'network' && (
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            className="input-field"
            placeholder="\\server\share  (separate multiple with ;)"
            value={networkPath}
            onChange={e => setNetworkPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNetworkPath()}
          />
          <button className="btn btn-secondary whitespace-nowrap" onClick={addNetworkPath}>
            <PlusIcon className="w-4 h-4" /> Add
          </button>
        </div>
      )}

      {/* File Server panel */}
      {mode === 'server' && (
        <div className="mb-4">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              className="input-field"
              placeholder="Hostname or IP, e.g. fileserver01"
              value={serverHost}
              onChange={e => setServerHost(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleListShares()}
            />
            <button
              className="btn btn-secondary whitespace-nowrap"
              onClick={handleListShares}
              disabled={listingShares}
            >
              <ServerIcon className="w-4 h-4" />
              {listingShares ? 'Loading...' : 'List Shares'}
            </button>
          </div>
          {sharesVisible && (
            <div className="border border-slate-200 rounded-lg bg-slate-50 max-h-44 overflow-y-auto mb-2">
              {shares.length === 0 ? (
                <p className="text-slate-400 text-sm p-3">No shares found.</p>
              ) : (
                shares.map(s => (
                  <label
                    key={s.unc}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="accent-[#1B3A6B] w-3.5 h-3.5"
                      checked={selectedShares.has(s.unc)}
                      onChange={() => toggleShare(s.unc)}
                    />
                    <span className="font-medium text-slate-700">{s.name}</span>
                    <span className="text-slate-400 text-xs">{s.unc}</span>
                  </label>
                ))
              )}
            </div>
          )}
          {sharesVisible && shares.length > 0 && (
            <button className="btn btn-secondary" onClick={addSelectedShares}>
              <PlusIcon className="w-4 h-4" /> Add Selected
            </button>
          )}
        </div>
      )}

      {/* SharePoint / OneDrive panel */}
      {mode === 'sharepoint' && (
        <SharePointPanel onAddTargets={handleAddSpTargets} addToast={addToast} />
      )}

      {/* Paths to scan */}
      <div className="mb-5">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
          Targets to Scan
          {totalItems > 0 && <span className="ml-2 text-[#1B3A6B]">({totalItems})</span>}
        </div>
        <div
          className={`flex flex-wrap gap-2 min-h-[40px] p-2.5 rounded-lg border-2 border-dashed ${
            totalItems === 0 ? 'border-slate-200 items-center justify-center' : 'border-slate-200 bg-slate-50/50'
          }`}
        >
          {totalItems === 0 ? (
            <span className="text-slate-400 text-sm">No targets added yet.</span>
          ) : (
            <>
              {scanPaths.map((p, i) => (
                <div key={`fs-${i}`} className="path-tag">
                  <FolderIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate max-w-[220px] text-sm" title={p}>{p}</span>
                  <button onClick={() => removePath(i)} className="flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors">
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {spTargets.map((t, i) => (
                <div key={`sp-${i}`} className="path-tag bg-purple-50 border-purple-200 text-purple-800">
                  <CloudIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate max-w-[220px] text-sm" title={t.name}>
                    {t.type === 'onedrive' ? 'OneDrive: ' : 'SP: '}{t.name}
                  </span>
                  <button onClick={() => removeSpTarget(i)} className="flex-shrink-0 text-purple-400 hover:text-red-500 transition-colors">
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Scan controls */}
      <div className="flex flex-col gap-3">
        <button className="btn btn-scan" onClick={startScan} disabled={scanning}>
          {scanning ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Scanning...
            </>
          ) : (
            <>
              <ScanIcon className="w-5 h-5" />
              Scan All
            </>
          )}
        </button>

        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer text-sm bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 select-none">
            <input type="checkbox" className="accent-[#E8702A] w-3.5 h-3.5 cursor-pointer" checked={deepScan} onChange={e => setDeepScan(e.target.checked)} />
            <span>
              <strong className="text-amber-800">Deep OCR Analysis</strong>
              <span className="text-amber-700 ml-1">— inspect file content for 100% accurate OCR detection</span>
            </span>
            <span className="bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 text-xs font-bold">SLOWER</span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer text-sm bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2.5 select-none">
            <input type="checkbox" className="accent-[#1B3A6B] w-3.5 h-3.5 cursor-pointer" checked={includeHidden} onChange={e => setIncludeHidden(e.target.checked)} />
            <span>
              <strong className="text-[#1B3A6B]">Include Hidden Files</strong>
              <span className="text-slate-500 ml-1">— scan files and folders starting with a dot (.)</span>
            </span>
          </label>
        </div>

        {scanning && (
          <div className="mt-1">
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#1B3A6B] to-[#E8702A] transition-all duration-300"
                style={{ width: `${progress}%`, animation: 'pulse 1.5s infinite' }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              {spTargets.length > 0 ? 'Scanning filesystem and Microsoft 365, please wait...' : 'Scanning filesystem, please wait...'}
            </p>
            <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.7} }`}</style>
          </div>
        )}
      </div>
    </div>
  )
}
