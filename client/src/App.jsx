import { useState } from 'react'
import Header from './components/Header'
import ScanConfig from './components/ScanConfig'
import Results from './components/Results'
import { ToastContainer, useToast } from './components/Toast'
import { DatabaseIcon } from './components/Icons'

export default function App() {
  const [result, setResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  return (
    <div className="min-h-screen bg-slate-100">
      <Header />
      <div className="max-w-screen-xl mx-auto px-6 py-7 space-y-5">
        <ScanConfig
          onScanComplete={setResult}
          scanning={scanning}
          setScanning={setScanning}
          addToast={addToast}
        />
        {!result && !scanning && (
          <div className="text-center py-16 text-slate-400">
            <DatabaseIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-base">
              Add paths to scan and click <strong className="text-slate-500">Scan All</strong> to begin.
            </p>
          </div>
        )}
        {result && <Results data={result} addToast={addToast} />}
      </div>
      <footer className="text-center py-5 text-xs text-slate-400 border-t border-slate-200 mt-8">
        &copy; {new Date().getFullYear()} Netwrix Corporation. All rights reserved.
        &nbsp;&bull;&nbsp; Developed by Karim Azzouzi &amp; Russell McDermott
      </footer>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}
