export default function OfferGrid({ offers, selectedId, onSelect }) {
  return (
    <div className="offers">
      {offers.map((offer) => (
        <button
          key={offer.id}
          type="button"
          className="offer"
          aria-pressed={offer.id === selectedId}
          onClick={() => onSelect(offer.id)}
        >
          {offer.label}
        </button>
      ))}
    </div>
  )
}