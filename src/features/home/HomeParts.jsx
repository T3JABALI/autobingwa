const ICONS = {
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  ),
  refresh: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  retry: <path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
}

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="hm-ico">
      {ICONS[name]}
    </svg>
  )
}

export function InfoCard({ title, text, lines = 3, open, onToggle, onCopy }) {
  const long = text.length > 110 || text.split('\n').length > lines
  return (
    <div className="hm-info">
      <div className="hm-info-head">
        <span className="hm-info-title">{title}</span>
        <button className="hm-icon" onClick={onCopy} aria-label={`Copy ${title}`}>
          <Icon name="copy" />
        </button>
      </div>
      <button
        type="button"
        className="hm-info-body"
        onClick={onToggle}
        aria-expanded={open}
        disabled={!long}
      >
        <span className={`hm-info-text ${open ? '' : 'clamp'}`} style={{ '--lines': lines }}>
          {text}
        </span>
        {long && (
          <span className="hm-info-hint">{open ? '(tap to collapse)' : '(tap to expand)'}</span>
        )}
      </button>
    </div>
  )
}