const BASE = ''

export const getDrives = () => fetch(`${BASE}/api/drives`).then(r => r.json())

export const listShares = (server) =>
  fetch(`${BASE}/api/list-shares?server=${encodeURIComponent(server)}`).then(async r => {
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed') }
    return r.json()
  })

export const openFolder = (folderPath) =>
  fetch(`${BASE}/api/open-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  })

export const scan = (scanPaths, deepScan, includeHidden) =>
  fetch(`${BASE}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanPaths, deepScan, includeHidden })
  }).then(async r => {
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Scan failed') }
    return r.json()
  })

export const exportExcel = async (data) => {
  const r = await fetch(`${BASE}/api/export/excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'NDC_Sizing_Report.xlsx'; a.click()
  URL.revokeObjectURL(url)
}

export const exportPDF = async (data) => {
  const r = await fetch(`${BASE}/api/export/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'NDC_Sizing_Report.pdf'; a.click()
  URL.revokeObjectURL(url)
}
