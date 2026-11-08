import './abExtras.css'

const ICONS = {
  home: (
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  offers: (
    <>
      <path d="M12 3 2 8l10 5 10-5-10-5z" />
      <path d="m2 13 10 5 10-5" />
    </>
  ),
  analytics: <path d="M5 20v-8M12 20V5M19 20v-5" />,
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
}

export default function BottomNav({ active = 'home', onHome, onOffers, onAnalytics, onSettings }) {
  const items = [
    ['home', 'Home', onHome],
    ['offers', 'Offers', onOffers],
    ['analytics', 'Analytics', onAnalytics],
    ['settings', 'Settings', onSettings],
  ]
  return (
    <nav className="ab-nav" aria-label="Main">
      {items.map(([key, label, fn]) => (
        <button
          key={key}
          className={`ab-nav-item ${active === key ? 'on' : ''}`}
          onClick={fn}
          aria-current={active === key ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[key]}</svg>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}