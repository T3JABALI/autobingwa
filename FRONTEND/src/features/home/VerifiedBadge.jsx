export default function VerifiedBadge({ size = 17 }) {
  return (
    <svg className="vb" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Verified"
      style={{ verticalAlign: '-3px', marginLeft: 5, flexShrink: 0 }}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="#1faa59" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="#1faa59" transform="rotate(45 12 12)" />
      <path d="M7.9 12.4l2.7 2.7 5.5-5.9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}