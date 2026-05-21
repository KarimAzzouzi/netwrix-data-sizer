export default function Header({ darkMode, onToggleDark }) {
  return (
    <header className="bg-white dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800 transition-colors">
      <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Left: logo + title */}
        <div className="flex items-center gap-4">
          <img src="/218769606.png" alt="Netwrix" className="h-9 w-auto object-contain dark:brightness-90" />
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-gray-800 dark:text-zinc-100 font-semibold text-xl">Data Sizer</span>
            </div>
            <p className="text-gray-400 dark:text-zinc-500 text-xs mt-0.5">
              Storage Sizing &amp; Hardware Recommendations
            </p>
          </div>
        </div>

        {/* Right: product label + dark toggle */}
        <div className="flex items-center gap-4">
          <div className="hidden md:block text-right">
            <p className="text-gray-600 dark:text-zinc-300 text-xs leading-relaxed">
              Netwrix Data Classification
            </p>
            <p className="text-gray-400 dark:text-zinc-500 text-xs">
              NDC Deployment Sizing Tool
            </p>
          </div>

          <button
            onClick={onToggleDark}
            aria-label="Toggle dark mode"
            className="w-9 h-9 rounded-lg flex items-center justify-center
                       text-gray-500 hover:text-gray-800 hover:bg-gray-100
                       dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800
                       transition-colors"
          >
            {darkMode ? (
              /* Sun icon — shown when dark mode is on */
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              /* Moon icon — shown when light mode is on */
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
