import PortalSync from './features/connect/PortalSync.jsx'
import TokenGate from './features/tokens/TokenGate.jsx'
import { tokensActive } from './engine/tokens.js'
import SmartPlans from './features/smartplans/SmartPlans.jsx'
import Signature from './Signature.jsx'
import Offers from './Offers.jsx'
import { useEffect, useState } from 'react'
import './App.css'
import QuickDialPage from './features/quickdial/QuickDialPage.jsx'
import AutoRenewalPage from './features/autorenewal/AutoRenewalPage.jsx'
import TokensPage from './features/tokens/TokensPage.jsx'
import ClientsPage from './features/clients/ClientsPage.jsx'
import ContactsPage from './features/contacts/ContactsPage.jsx'
import AutoRepliesPage from './features/autoreplies/AutoRepliesPage.jsx'
import ConnectPage from './features/connect/ConnectPage.jsx'
import FallbackPage from './features/fallback/FallbackPage.jsx'
import SettingsPage, { loadProfile, loadMode, greetingFor, firstNameOf } from './features/settings/SettingsPage.jsx'
import HomePage from './features/home/HomePage.jsx'
import ModeDialog from './features/home/ModeDialog.jsx'
import Toaster from './features/notify/Toaster.jsx'
import UpdatesPage from './features/updates/UpdatesPage.jsx'
import UpdatePrompt from './features/updates/UpdatePrompt.jsx'
import PhoneSetupPage from './features/setup/PhoneSetupPage.jsx'
import DialogHost from './features/ui/DialogHost.jsx'
import { askChoice } from './features/ui/dialog.js'
import Sitelink from './features/sitelink/sitelink.jsx'

import { saveMode } from './features/home/dataStore.js'
import { engine } from './engine/index.js'
import { isNative, ussdServiceEnabled, setKeepAlive } from './engine/native.js'
import { loadConfig } from './engine/config.js'
import { useSmartSync } from './features/smartplans/smartSync.js'
const navigation = [
  'Home', 'Offers', 'Smart Data Plans', 'QuickDial', 'Autorenewal', 'Sitelink',
  'Tokens', 'Client Management', 'Contacts', 'Bulk SMS',
  'Auto Replies', 'Autobingwa Connect', 'Fallback Plans',
  'Settings', 'Updates', 'Phone Setup',
]

const navIcons = ['⌂', '◇', '✦', '☎', '↻', '◎', '▤', '♙', '♧', '✉', '↩', '⌁', '⇄', '⚙', '◷', '✓']

// Converts an offer from the new Offers page into the shape older pages expect
const toOldShape = (o) => ({
  id: o.id,
  enabled: o.enabled,
  category: o.category,
  name: o.name,
  ussd: o.ussd,
  sellingPrice: o.price,
  safaricomPrice: o.safPrice,
  paymentMode: o.payment,
  executionSim: o.execSim,
  notificationSim: o.notifSim,
  ussdType: o.type,
  autoRetry: o.autoRetry ? 'Failed or pending' : 'Off',
  retryCount: o.retryCount || 0,
  signatureApproved: Boolean(o.signature),
  verified: Boolean(o.signature),
  updatedAt: o.updated || 'Not recorded',
  alternativeId: '',
  useWindow: false,
  availableFrom: '08:00',
  availableUntil: '18:00',
  notifyCustomer: true,
})

function App() {
  const [myOffers, setMyOffers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myOffers')) || [] } catch { return [] }
  })
  useEffect(() => { localStorage.setItem('myOffers', JSON.stringify(myOffers)) }, [myOffers])
  const saveOffer = o => setMyOffers(p => p.some(x => x.id === o.id) ? p.map(x => x.id === o.id ? o : x) : [...p, o])
  const deleteOffer = id => setMyOffers(p => p.filter(x => x.id !== id))
  const [light, setLight] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activePage, setActivePage] = useState('Home')
  const [automationRunning, setAutomationRunning] = useState(false)
  const offers = myOffers.map(toOldShape)
  const [profile, setProfile] = useState(loadProfile)
  const [mode, setMode] = useState(loadMode)
  const [clock, setClock] = useState(new Date())
  const [modeOpen, setModeOpen] = useState(false)

  // The one big Start / Stop button
  async function toggleAutomation() {
    if (automationRunning) {
      engine.stop()
      setAutomationRunning(false)
      setKeepAlive(false)
      return
    }
    // No token, no automation: show the "buy tokens" pop-up instead of starting.
    if (!tokensActive()) {
      window.dispatchEvent(new Event('ab-need-tokens'))
      return
    }
    // Advanced mode needs the accessibility service. Show the setup guide instead of starting.
    if (isNative() && loadConfig().mode === 'Advanced' && !(await ussdServiceEnabled())) {
      window.dispatchEvent(new Event('ab-need-setup'))
      return
    }
    const waiting = engine.pausedCount()
    let choice = 'process'
    if (waiting > 0) {
      choice = await askChoice({
        title: 'Before we start',
        message: `${waiting} payment${waiting === 1 ? '' : 's'} arrived while automation was off. Handle ${waiting === 1 ? 'it' : 'them'} now, or leave ${waiting === 1 ? 'it' : 'them'} out and only take new payments from here?`,
        choices: [
          { id: 'cancel', label: "Don't start", kind: 'text' },
          { id: 'skip', label: 'Leave them out', kind: 'text' },
          { id: 'process', label: 'Handle them now', kind: 'primary' },
        ],
      })
      if (choice !== 'process' && choice !== 'skip') return // closed or "Don't start": nothing starts
    }
    setKeepAlive(true)
    engine.start()
    setAutomationRunning(true)
    if (waiting > 0) engine.releasePaused(choice)
  }

  // A successful purchase teaches its menu path (see engine/index.js). Saved here so the offers list stays in sync.
  useEffect(() => {
    const learned = (e) => {
      const d = e.detail || {}
      setMyOffers(p => p.map(o =>
        String(o.id) === String(d.offerId) && !(o.sig && o.sig.complete)
          ? { ...o, sig: d.sig, sigLearned: true, sigEnabled: true, sigAuto: true, updated: new Date().toLocaleString() }
          : o))
    }
    window.addEventListener('ab-offer-learned', learned)
    return () => window.removeEventListener('ab-offer-learned', learned)
  }, [])
  // Offer changes sent from the AutoBingwa Portal (see PortalSync.jsx)
  useEffect(() => {
    const onCmd = (e) => {
      const d = e.detail || {}
      if (d.op === 'save' && d.offer) saveOffer(d.offer)
      if (d.op === 'delete') deleteOffer(d.id)
    }
    window.addEventListener('ab-offer-cmd', onCmd)
    return () => window.removeEventListener('ab-offer-cmd', onCmd)
  }, [])
  // Start / Stop sent from the AutoBingwa Portal. Same checks and pop-ups as the button on this phone.
  useEffect(() => {
    const remote = (e) => {
      const type = e.detail && e.detail.type
      if (type === 'start' && !automationRunning) toggleAutomation()
      if (type === 'stop' && automationRunning) toggleAutomation()
    }
    window.addEventListener('ab-remote', remote)
    return () => window.removeEventListener('ab-remote', remote)
  })

  // The app always opens stopped. Automation only starts when you hold the button.
  useEffect(() => {
    engine.stop()
    setKeepAlive(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function changeMode(id) {
    setMode(id)
    saveMode(id)
    setModeOpen(false)
  }

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={`app ${light ? 'light' : 'dark'}`}>
      {menuOpen && (
        <button
          className="menu-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>AUTOBINGWA</strong>
            <small>USSD Automation</small>
          </div>
          <button className="close-menu" onClick={() => setMenuOpen(false)}>×</button>
        </div>

        <nav className="navigation">
          {navigation.map((item, index) => (
            <button
              key={item}
              className={`nav-item ${activePage === item ? 'active' : ''}`}
              onClick={() => {
                setActivePage(item)
                setMenuOpen(false)
              }}
            >
              <span className="icon">{navIcons[index]}</span>
              <span>{item}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className={`status-light ${automationRunning ? 'running' : ''}`} />
          <div>
            <strong>{automationRunning ? 'Automation Running' : 'Automation Stopped'}</strong>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            ☰
          </button>

          <div className="greeting">
            <span>{greetingFor(clock)},</span>
            <strong>{firstNameOf(profile.fullName) || 'User'}</strong>
          </div>

          <div className="topbar-actions">
            <span className="profile-icon">
              {profile.photo ? <img className="profile-photo" src={profile.photo} alt="" /> : '♙'}
            </span>
            <div className="mode-stack">
              <button className="theme-toggle" onClick={() => setLight(!light)}>
                {light ? '☾ Dark' : '☼ Light'}
              </button>
              <button className="mode-chip" onClick={() => setModeOpen(true)} aria-label="Change processing mode">
                {mode} Mode ▾
              </button>
            </div>
          </div>
        </header>

        {activePage === 'Home' ? (
          <HomePage
            automationRunning={automationRunning}
            onToggleAutomation={toggleAutomation}
            offers={offers}
            onOpenTokens={() => setActivePage('Tokens')}
          />
        ) : activePage === 'Smart Data Plans' ? (
          <SmartPlans owned={myOffers} onDownload={saveOffer} />
        ) : activePage === 'Signature' ? (
          <Signature owned={myOffers} onDownload={saveOffer} />
        ) : activePage === 'Offers' ? (
          <Offers offers={myOffers} onSave={saveOffer} onDelete={deleteOffer} />
        ) : activePage === 'QuickDial' ? (
          <section className="panel">
            <QuickDialPage
              offers={offers}
              onBack={() => setActivePage('Home')}
              onOpenOffers={() => setActivePage('Offers')}
            />
          </section>
        ) : activePage === 'Autorenewal' ? (
          <section className="panel fit fit-md">
            <AutoRenewalPage
              offers={offers.filter(offer => offer.enabled)}
              onBack={() => setActivePage('Home')}
            />
          </section>
        ) : activePage === 'Tokens' ? (
          <section className="panel">
            <TokensPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Client Management' ? (
          <section className="panel">
            <ClientsPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Contacts' ? (
          <section className="panel">
            <ContactsPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Auto Replies' ? (
          <section className="panel fit fit-replies">
            <AutoRepliesPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Autobingwa Connect' ? (
          <section className="panel fit fit-md">
            <ConnectPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Fallback Plans' ? (
          <section className="panel fit fit-fallback">
            <FallbackPage offers={offers} onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Sitelink' ? (
          <section className="panel">
            <Sitelink onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Phone Setup' ? (
          <section className="panel">
            <PhoneSetupPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Updates' ? (
          <section className="panel">
            <UpdatesPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Settings' ? (
          <section className="panel">
            <SettingsPage
              onBack={() => setActivePage('Home')}
              onProfileChange={setProfile}
              onModeChange={setMode}
            />
          </section>
        ) : (
          <section className="panel placeholder-page">
            <div className="placeholder-icon">◇</div>
            <h1>{activePage}</h1>
            <p>This dashboard section will be built in a later stage.</p>
            <button className="primary-button" onClick={() => setActivePage('Home')}>
              ← Back to Home
            </button>
          </section>
        )}
      </main>
      <Toaster />
      <PortalSync />
      <DialogHost />
      {activePage === 'Home' && <UpdatePrompt />}
      <TokenGate hidden={activePage === 'Tokens'} onBuy={() => setActivePage('Tokens')} />
      {modeOpen && (
        <ModeDialog mode={mode} onSelect={changeMode} onClose={() => setModeOpen(false)} />
      )}
    </div>
  )
}

export default App