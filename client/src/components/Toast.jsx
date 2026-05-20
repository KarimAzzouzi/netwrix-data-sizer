import { useState, useEffect, useCallback } from 'react'
import { CheckIcon, AlertIcon, XIcon } from './Icons'

export function useToast() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

function Toast({ toast, onRemove }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  const styles = {
    success: 'bg-emerald-600 text-white border-emerald-700',
    error: 'bg-red-600 text-white border-red-700',
    warning: 'bg-[#E8702A] text-white border-orange-600',
    info: 'bg-[#1B3A6B] text-white border-[#2A5298]',
  }

  const icons = {
    success: <CheckIcon className="w-4 h-4 flex-shrink-0" />,
    error: <XIcon className="w-4 h-4 flex-shrink-0" />,
    warning: <AlertIcon className="w-4 h-4 flex-shrink-0" />,
    info: <AlertIcon className="w-4 h-4 flex-shrink-0" />,
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm font-medium max-w-sm animate-slide-in ${styles[toast.type] || styles.info}`}
      style={{ animation: 'slideIn 0.2s ease-out' }}
    >
      {icons[toast.type] || icons.info}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-1 opacity-70 hover:opacity-100 transition-opacity flex-shrink-0"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer({ toasts, removeToast }) {
  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast toast={toast} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </>
  )
}
