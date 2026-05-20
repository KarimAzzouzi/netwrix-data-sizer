import { DatabaseIcon } from './Icons'

export default function Header() {
  return (
    <header className="bg-gradient-to-r from-[#1B3A6B] to-[#2A5298] shadow-lg">
      <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
            <DatabaseIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-white font-bold text-xl tracking-tight">Netwrix</span>
              <span className="text-blue-200 font-light text-xl">Data Sizer</span>
            </div>
            <p className="text-blue-300 text-xs mt-0.5">Storage Sizing &amp; Hardware Recommendations</p>
          </div>
        </div>
        <div className="hidden md:block text-right">
          <p className="text-blue-200 text-xs leading-relaxed">
            Netwrix Data Classification
          </p>
          <p className="text-blue-300/70 text-xs">
            NDC Deployment Sizing Tool
          </p>
        </div>
      </div>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-[#E8702A]/60 to-transparent" />
    </header>
  )
}
