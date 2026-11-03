export default function PhoneField({ value, onChange, onDial }) {
  return (
    <div className="phone">
      <textarea
        className="phone__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Customer Phone"
        aria-label="Customer phone number"
        inputMode="tel"
        autoComplete="off"
        spellCheck={false}
        rows={3}
      />
      <button type="button" className="phone__call" onClick={onDial} aria-label="Dial">
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
          />
        </svg>
      </button>
    </div>
  )
}