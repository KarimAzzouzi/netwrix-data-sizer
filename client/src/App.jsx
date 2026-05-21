import { useState, useEffect } from 'react'
import Header from './components/Header'
import ScanConfig from './components/ScanConfig'
import Results from './components/Results'
import { ToastContainer, useToast } from './components/Toast'
import { DatabaseIcon } from './components/Icons'

function getInitialDarkMode() {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark') return true
  if (stored === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function App() {
  const [result, setResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [darkMode, setDarkMode] = useState(getInitialDarkMode)
  const { toasts, addToast, removeToast } = useToast()

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [darkMode])

  function toggleDark() {
    setDarkMode(prev => !prev)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 transition-colors">
      <Header darkMode={darkMode} onToggleDark={toggleDark} />
      <div className="max-w-screen-xl mx-auto px-6 py-7 space-y-5">
        <ScanConfig
          onScanComplete={setResult}
          scanning={scanning}
          setScanning={setScanning}
          addToast={addToast}
        />
        {!result && !scanning && (
          <div className="text-center py-16 text-gray-400 dark:text-zinc-500">
            <DatabaseIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-base">
              Add paths to scan and click{' '}
              <strong className="text-gray-500 dark:text-zinc-400">Scan All</strong> to begin.
            </p>
          </div>
        )}
        {result && <Results data={result} addToast={addToast} />}
      </div>
      <footer className="text-center py-5 text-xs text-gray-400 dark:text-zinc-500 border-t border-gray-100 dark:border-zinc-800 mt-8">
        &copy; {new Date().getFullYear()} Netwrix Corporation. All rights reserved.
        &nbsp;&bull;&nbsp; Developed by Karim Azzouzi &amp; Russell McDermott
      </footer>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}
