import { useState } from 'react'
import { CheckIcon, XIcon, PlusIcon, AlertIcon, ServerIcon } from './Icons'

const STEPS = [
  {
    number: 1,
    title: 'Open Azure Portal',
    description: 'Go to the Azure Portal and navigate to App Registrations.',
    instructions: [
      'Open your browser and go to portal.azure.com',
      'Sign in with a Global Administrator or Application Administrator account',
      'In the search bar at the top, type "App registrations" and select it',
      'Click "+ New registration" in the top menu',
    ],
    tip: 'You need at least Application Administrator permissions to create an App Registration.',
  },
  {
    number: 2,
    title: 'Register the Application',
    description: 'Fill in the app registration details.',
    instructions: [
      'Name: Enter "Netwrix Data Sizer" (or any name you prefer)',
      'Supported account types: Select "Accounts in this organizational directory only (Single tenant)"',
      'Redirect URI: Leave blank',
      'Click "Register" at the bottom',
      'IMPORTANT: Copy your Application (client) ID and Directory (tenant) ID from the Overview page',
    ],
    tip: 'Save the Application (client) ID and Directory (tenant) ID — you will need them in Step 4.',
    highlight: true,
  },
  {
    number: 3,
    title: 'Add API Permissions',
    description: 'Grant the permissions needed to read SharePoint and OneDrive data.',
    instructions: [
      'In your new app, click "API permissions" in the left menu',
      'Click "+ Add a permission" → select "Microsoft Graph"',
      'Select "Application permissions" (NOT delegated)',
      'Search and add these permissions:',
      '  • Sites.Read.All — Read items in all site collections',
      '  • Files.Read.All — Read all files the user can access',
      '  • User.Read.All — Read all users\' full profiles (for OneDrive)',
      'Click "Add permissions"',
      'Click "Grant admin consent for [Your Org]" and confirm',
    ],
    tip: 'Admin consent is required. A green checkmark must appear next to each permission.',
  },
  {
    number: 4,
    title: 'Create a Client Secret',
    description: 'Generate the client secret used for authentication.',
    instructions: [
      'Click "Certificates & secrets" in the left menu',
      'Click "+ New client secret"',
      'Description: "NDC Sizer" — Expires: 24 months (recommended)',
      'Click "Add"',
      'IMPORTANT: Copy the secret Value immediately — it will be hidden after you leave this page',
    ],
    tip: 'The secret is only shown once. If you lose it, you must create a new one.',
    highlight: true,
  },
]

function WizardStep({ step, isActive, isDone, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 w-full text-left p-3 rounded-lg transition-all ${
        isActive ? 'bg-blue-50 border border-blue-200' : isDone ? 'bg-green-50' : 'hover:bg-slate-50'
      }`}
    >
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold mt-0.5 ${
        isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-[#1B3A6B] text-white' : 'bg-slate-200 text-slate-600'
      }`}>
        {isDone ? <CheckIcon className="w-4 h-4" /> : step.number}
      </div>
      <div>
        <div className={`text-sm font-semibold ${isActive ? 'text-[#1B3A6B]' : 'text-slate-700'}`}>{step.title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{step.description}</div>
      </div>
    </button>
  )
}

function StepContent({ step }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
          {step.number}
        </div>
        <h3 className="font-bold text-[#1B3A6B] text-base">{step.title}</h3>
      </div>

      <ul className="space-y-2 mb-4">
        {step.instructions.map((inst, i) => (
          <li key={i} className={`flex gap-2 text-sm ${inst.startsWith('  ') ? 'ml-5' : ''}`}>
            {!inst.startsWith('  ') && (
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold mt-0.5">
                {i + 1}
              </span>
            )}
            <span className={`${inst.startsWith('  •') ? 'text-[#1B3A6B] font-medium' : 'text-slate-700'}`}>
              {inst.startsWith('  •') ? inst.trim() : inst}
            </span>
          </li>
        ))}
      </ul>

      {step.tip && (
        <div className={`flex gap-2 p-3 rounded-lg text-sm ${
          step.highlight ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'
        }`}>
          <AlertIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{step.tip}</span>
        </div>
      )}
    </div>
  )
}

export default function SharePointPanel({ onAddTargets, addToast }) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [doneSteps, setDoneSteps] = useState(new Set())

  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [orgName, setOrgName] = useState('')

  const [sites, setSites] = useState([])
  const [users, setUsers] = useState([])
  const [loadingTargets, setLoadingTargets] = useState(false)

  const [selectedSites, setSelectedSites] = useState(new Set())
  const [selectedUsers, setSelectedUsers] = useState(new Set())

  const [targetTab, setTargetTab] = useState('sharepoint')

  function markStepDone(n) {
    setDoneSteps(prev => new Set([...prev, n]))
  }

  async function handleConnect() {
    if (!tenantId.trim() || !clientId.trim() || !clientSecret.trim()) {
      addToast('Please fill in Tenant ID, Application ID, and Client Secret.', 'warning')
      return
    }
    setConnecting(true)
    try {
      const resp = await fetch('/api/sharepoint/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Connection failed')
      setConnected(true)
      setOrgName(data.orgName)
      addToast(`Connected to ${data.orgName}`, 'success')
      loadTargets()
    } catch (e) {
      addToast('Connection failed: ' + e.message, 'error')
    } finally {
      setConnecting(false)
    }
  }

  async function loadTargets() {
    setLoadingTargets(true)
    try {
      const resp = await fetch('/api/sharepoint/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Failed to load sites')
      setSites(data.sites || [])
      setUsers(data.users || [])
    } catch (e) {
      addToast('Could not load sites: ' + e.message, 'error')
    } finally {
      setLoadingTargets(false)
    }
  }

  function toggleSite(id) {
    setSelectedSites(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleUser(id) {
    setSelectedUsers(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleAddTargets() {
    const targets = [
      ...sites.filter(s => selectedSites.has(s.id)).map(s => ({ ...s, type: 'sharepoint' })),
      ...users.filter(u => selectedUsers.has(u.id)).map(u => ({ ...u, type: 'onedrive' })),
    ]
    if (targets.length === 0) { addToast('Select at least one site or OneDrive.', 'warning'); return }
    onAddTargets(targets, { tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() })
    setSelectedSites(new Set())
    setSelectedUsers(new Set())
    addToast(`${targets.length} target(s) added to scan queue.`, 'success')
  }

  return (
    <div className="mb-4">
      {/* App Registration Wizard toggle */}
      <div className="mb-4">
        <button
          onClick={() => setWizardOpen(!wizardOpen)}
          className="flex items-center gap-2 text-sm font-semibold text-[#1B3A6B] bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 hover:bg-blue-100 transition-all w-full"
        >
          <ServerIcon className="w-4 h-4" />
          <span>{wizardOpen ? 'Hide' : 'Show'} App Registration Guide</span>
          <span className="ml-auto text-xs bg-[#1B3A6B] text-white rounded-full px-2.5 py-0.5">Step-by-Step</span>
        </button>
      </div>

      {wizardOpen && (
        <div className="border border-slate-200 rounded-xl overflow-hidden mb-5 bg-slate-50">
          <div className="bg-[#1B3A6B] px-5 py-3 flex items-center gap-3">
            <div>
              <div className="text-white font-bold text-sm">Azure App Registration Guide</div>
              <div className="text-blue-200 text-xs mt-0.5">Follow these steps to connect Netwrix Data Sizer to your Microsoft 365 tenant</div>
            </div>
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step list */}
            <div className="space-y-2">
              {STEPS.map((step, i) => (
                <WizardStep
                  key={step.number}
                  step={step}
                  isActive={activeStep === i}
                  isDone={doneSteps.has(i)}
                  onClick={() => setActiveStep(i)}
                />
              ))}

              <div className="pt-2 flex gap-2">
                <button
                  onClick={() => { if (activeStep > 0) setActiveStep(activeStep - 1) }}
                  disabled={activeStep === 0}
                  className="flex-1 btn btn-secondary text-xs py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    markStepDone(activeStep)
                    if (activeStep < STEPS.length - 1) setActiveStep(activeStep + 1)
                    else setWizardOpen(false)
                  }}
                  className="flex-1 btn btn-primary text-xs py-1.5"
                >
                  {activeStep < STEPS.length - 1 ? 'Next Step' : 'Done'}
                </button>
              </div>
            </div>

            {/* Step content */}
            <div className="md:col-span-2">
              <StepContent step={STEPS[activeStep]} />
            </div>
          </div>
        </div>
      )}

      {/* Credentials form */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          {connected ? `Connected — ${orgName}` : 'Microsoft 365 Credentials'}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Directory (Tenant) ID</label>
            <input
              type="text"
              className="input-field w-full font-mono text-xs"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={tenantId}
              onChange={e => { setTenantId(e.target.value); setConnected(false) }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Application (Client) ID</label>
            <input
              type="text"
              className="input-field w-full font-mono text-xs"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={clientId}
              onChange={e => { setClientId(e.target.value); setConnected(false) }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Client Secret Value</label>
            <input
              type="password"
              className="input-field w-full font-mono text-xs"
              placeholder="••••••••••••••••••••••••"
              value={clientSecret}
              onChange={e => { setClientSecret(e.target.value); setConnected(false) }}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="btn btn-primary text-sm"
          >
            {connecting ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Connecting...
              </>
            ) : connected ? (
              <><CheckIcon className="w-4 h-4" /> Reconnect</>
            ) : (
              'Connect'
            )}
          </button>
          {connected && (
            <button onClick={loadTargets} disabled={loadingTargets} className="btn btn-secondary text-sm">
              {loadingTargets ? 'Refreshing...' : 'Refresh Sites'}
            </button>
          )}
        </div>
      </div>

      {/* Sites / OneDrive selector */}
      {connected && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex gap-1 border-b border-slate-200 mb-4">
            <button
              onClick={() => setTargetTab('sharepoint')}
              className={`tab-btn flex items-center gap-2 ${targetTab === 'sharepoint' ? 'active' : ''}`}
            >
              SharePoint Sites
              {sites.length > 0 && (
                <span className="bg-slate-200 text-slate-700 text-xs rounded-full px-2 py-0.5">{sites.length}</span>
              )}
            </button>
            <button
              onClick={() => setTargetTab('onedrive')}
              className={`tab-btn flex items-center gap-2 ${targetTab === 'onedrive' ? 'active' : ''}`}
            >
              OneDrive Users
              {users.length > 0 && (
                <span className="bg-slate-200 text-slate-700 text-xs rounded-full px-2 py-0.5">{users.length}</span>
              )}
            </button>
          </div>

          {loadingTargets ? (
            <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>
          ) : targetTab === 'sharepoint' ? (
            <div>
              {sites.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">No SharePoint sites found.</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">{selectedSites.size} selected</span>
                    <button
                      onClick={() => setSelectedSites(new Set(sites.map(s => s.id)))}
                      className="text-xs text-[#1B3A6B] hover:underline"
                    >
                      Select all
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto">
                    {sites.map(site => (
                      <label
                        key={site.id}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <input
                          type="checkbox"
                          className="accent-[#1B3A6B] w-4 h-4 cursor-pointer flex-shrink-0"
                          checked={selectedSites.has(site.id)}
                          onChange={() => toggleSite(site.id)}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{site.name}</div>
                          <div className="text-xs text-slate-400 truncate">{site.url}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div>
              {users.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">No OneDrive users found.</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">{selectedUsers.size} selected</span>
                    <button
                      onClick={() => setSelectedUsers(new Set(users.map(u => u.id)))}
                      className="text-xs text-[#1B3A6B] hover:underline"
                    >
                      Select all
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto">
                    {users.map(user => (
                      <label
                        key={user.id}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <input
                          type="checkbox"
                          className="accent-[#1B3A6B] w-4 h-4 cursor-pointer flex-shrink-0"
                          checked={selectedUsers.has(user.id)}
                          onChange={() => toggleUser(user.id)}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{user.name}</div>
                          <div className="text-xs text-slate-400 truncate">{user.upn}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {(selectedSites.size > 0 || selectedUsers.size > 0) && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button onClick={handleAddTargets} className="btn btn-primary">
                <PlusIcon className="w-4 h-4" />
                Add {selectedSites.size + selectedUsers.size} Target(s) to Scan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
