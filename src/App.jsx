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
import { saveMode } from './features/home/dataStore.js'
const initialTransactions = [
  { id: 1, name: 'IMRAN ABDULLAHI MOHAMED AHMED', phone: '018 072 3954', status: 'Completed', time: 'Just now', initials: 'IA' },
  { id: 2, name: 'FAITH KHASOA SIMIYU', phone: '070 459 0730', status: 'Completed', time: '7m ago', initials: 'FS' },
  { id: 3, name: 'Ruth Bosibori Mogaka', phone: '075 946 1380', status: 'Completed', time: '12m ago', initials: 'RB' },
  { id: 4, name: 'PURITY CHEPNGETICH BOWEN', phone: '076 901 0855', status: 'Completed', time: '15m ago', initials: 'PB' },
  { id: 5, name: 'SYDNEY WANGWE', phone: '079 760 9585', status: 'Completed', time: '18m ago', initials: 'SW' },
]

const navigation = [
  'Home', 'Offers', 'QuickDial', 'Autorenewal', 'Sitelink',
  'Tokens', 'Client Management', 'Contacts', 'Bulk SMS',
  'Auto Replies', 'Autobingwa Connect', 'Fallback Plans',
  'Settings', 'Updates',
]

const navIcons = ['⌂', '◇', '☎', '↻', '◎', '▤', '♙', '♧', '✉', '↩', '⌁', '⇄', '⚙', '◷']

const chartValues = [120, 190, 290, 280, 460, 490, 820]

const startingOffers = [
  {
    id: 1, enabled: true, category: 'Data',
    name: '1GB — 1 hour',
    ussd: '*180*5*2*ab*5*1#',
    sellingPrice: 19, safaricomPrice: 20,
    paymentMode: 'Till SIM',
    executionSim: 'SIM 2', notificationSim: 'SIM 1',
    ussdType: 'Simple', autoRetry: 'Off', retryCount: 0,
    useWindow: false, availableFrom: '08:00',
    availableUntil: '18:00', alternativeId: '',
    notifyCustomer: true, signatureApproved: false,
    updatedAt: 'Not recorded',
  },
  {
    id: 2, enabled: true, category: 'Data',
    name: '2GB — 24 hours',
    ussd: '*180*5*2*ab*5*2#',
    sellingPrice: 39, safaricomPrice: 40,
    paymentMode: 'Till SIM',
    executionSim: 'SIM 2', notificationSim: 'SIM 1',
    ussdType: 'Simple', autoRetry: 'Off', retryCount: 0,
    useWindow: false, availableFrom: '08:00',
    availableUntil: '18:00', alternativeId: '',
    notifyCustomer: true, signatureApproved: false,
    updatedAt: 'Not recorded',
  },
]

const emptyForm = {
  enabled: true,
  category: 'Data',
  name: '',
  ussd: '*180*5*2*ab*5*1#',
  sellingPrice: '19',
  safaricomPrice: '20',
  paymentMode: 'Till SIM',
  executionSim: 'SIM 2',
  notificationSim: 'SIM 1',
  ussdType: 'Simple',
  autoRetry: 'Off',
  retryCount: '0',
  useWindow: false,
  availableFrom: '08:00',
  availableUntil: '18:00',
  alternativeId: '',
  notifyCustomer: true,
  signatureApproved: false,
}

function CommissionChart() {
  const points = chartValues
    .map((value, index) => `${30 + index * 56},${150 - value * 0.15}`)
    .join(' ')

  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 400 175" role="img" aria-label="Daily commissions over seven days">
        {[30, 60, 90, 120, 150].map(y => (
          <line key={y} x1="30" y1={y} x2="366" y2={y} className="chart-grid" />
        ))}
        <polygon points={`30,150 ${points} 366,150`} className="chart-area" />
        <polyline points={points} className="chart-line" />
        {chartValues.map((value, index) => (
          <circle key={index} cx={30 + index * 56} cy={150 - value * 0.15} r="3.5" className="chart-dot" />
        ))}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
          <text key={day} x={30 + i * 56} y="169" textAnchor="middle" className="chart-label">
            {day}
          </text>
        ))}
      </svg>
      <div className="chart-caption">Illustrative commission data · Last 7 days</div>
    </div>
  )
}

function OffersPage({ offers, setOffers, setActivePage }) {
  const [categories, setCategories] = useState(['Data', 'Minutes', 'SMS', 'Tunukiwa', 'Patamore'])
  const [editingId, setEditingId] = useState(null)
  const [screen, setScreen] = useState('list')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [openMenuId, setOpenMenuId] = useState(null)
  const [notice, setNotice] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [learned, setLearned] = useState(false)
  const [learningStep, setLearningStep] = useState(0)
  const [demoApproved, setDemoApproved] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })

  const selectedOffer = offers.find(offer => offer.id === editingId)

  const filteredOffers = categoryFilter === 'All'
    ? offers
    : offers.filter(offer => offer.category === categoryFilter)

  function updateField(field, value) {
    setForm(previous => ({ ...previous, [field]: value }))
  }

  function startAdd() {
    setEditingId(null)
    setForm({ ...emptyForm })
    setScreen('form')
    setOpenMenuId(null)
    setNotice('')
  }

  function startEdit(offer) {
    setEditingId(offer.id)
    setForm({ ...emptyForm, ...offer })
    setScreen('form')
    setOpenMenuId(null)
    setNotice('')
  }

  function saveOffer(event) {
    event.preventDefault()

    if (!form.name.trim()) {
      setNotice('Please enter a plan name.')
      return
    }

    if (!form.ussd.includes('ab')) {
      setNotice('The USSD template must contain ab as the phone-number placeholder.')
      return
    }

    if (form.useWindow && !form.alternativeId) {
      setNotice('Please select an alternative offer for outside the availability window.')
      return
    }

    if (form.useWindow && String(form.alternativeId) === String(editingId)) {
      setNotice('An offer cannot be its own alternative.')
      return
    }

    const savedOffer = {
      ...form,
      id: editingId ?? Date.now(),
      name: form.name.trim(),
      sellingPrice: Number(form.sellingPrice),
      safaricomPrice: Number(form.safaricomPrice),
      retryCount: Math.max(0, Number(form.retryCount) || 0),
      alternativeId: form.alternativeId ? Number(form.alternativeId) : '',
      signatureApproved: editingId ? Boolean(form.signatureApproved) : false,
      updatedAt: new Date().toLocaleString(),
    }

    setOffers(previous => editingId
      ? previous.map(offer => offer.id === editingId ? savedOffer : offer)
      : [...previous, savedOffer])

    setScreen('list')
    setNotice('Offer saved successfully.')
  }

  function deleteOffer(id) {
    if (!window.confirm('Delete this offer? This action cannot be undone.')) return

    setOffers(previous => previous
      .filter(offer => offer.id !== id)
      .map(offer => String(offer.alternativeId) === String(id)
        ? { ...offer, alternativeId: '' }
        : offer))

    setOpenMenuId(null)
    setNotice('Offer deleted.')
  }

  function copyOffer(offer) {
    const duplicate = {
      ...offer,
      id: Date.now(),
      name: `${offer.name} (Copy)`,
      signatureApproved: false,
      updatedAt: new Date().toLocaleString(),
    }

    setOffers(previous => [...previous, duplicate])
    setOpenMenuId(null)
    setNotice(`"${duplicate.name}" created successfully.`)
  }

  function openAvailability(offer) {
    setEditingId(offer.id)
    setForm({ ...emptyForm, ...offer })
    setScreen('availability')
    setOpenMenuId(null)
    setNotice('')
  }

  function saveAvailability(event) {
    event.preventDefault()

    if (form.useWindow && !form.alternativeId) {
      setNotice('Choose an alternative offer for outside the availability window.')
      return
    }

    if (form.useWindow && String(form.alternativeId) === String(editingId)) {
      setNotice('An offer cannot be its own alternative.')
      return
    }

    setOffers(previous => previous.map(offer =>
      offer.id === editingId
        ? {
            ...offer,
            useWindow: form.useWindow,
            availableFrom: form.availableFrom,
            availableUntil: form.availableUntil,
            alternativeId: form.alternativeId ? Number(form.alternativeId) : '',
            notifyCustomer: form.notifyCustomer,
            updatedAt: new Date().toLocaleString(),
          }
        : offer
    ))

    setScreen('list')
    setNotice('Availability settings saved.')
  }

  function openSignature(offer) {
    setEditingId(offer.id)
    setLearned(false)
    setLearningStep(0)
    setDemoApproved(false)
    setScreen('signature')
    setOpenMenuId(null)
    setNotice('')
  }

  function addCategory() {
    const category = newCategory.trim()
    if (!category) return

    if (categories.some(item => item.toLowerCase() === category.toLowerCase())) {
      setNotice('That category already exists.')
      return
    }

    setCategories(previous => [...previous, category])
    updateField('category', category)
    setNewCategory('')
    setNotice(`Category "${category}" added.`)
  }

  const learningSteps = [
    'Prepare the sample phone number: 0700000000.',
    'Review the saved USSD template and replace ab with the sample number.',
    'The Android version will run the USSD flow and capture its responses.',
    'Inspect the final response and confirm that it matches the intended offer.',
  ]

  return (
    <div className="offers-page">
      <style>{`
        .offers-page {
          width: 100%;
          min-width: 0;
          --offer-border: var(--border-color, #E1E4E8);
          --offer-card-bg: var(--card-bg, #FFFFFF);
          --offer-muted-bg: var(--muted-bg, #EDF0F4);
          --offer-muted-text: var(--muted-text, #626B78);
          --offer-accent: var(--accent-color, #526581);
        }

        .offers-page button {
          font: inherit;
          cursor: pointer;
        }

        .offers-page button:focus-visible {
          outline: 2px solid var(--offer-accent);
          outline-offset: 3px;
        }

        .offers-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 16px 0;
        }

        .offers-toolbar h2 { margin: 0; }

        .offers-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          width: 100%;
          align-items: start;
        }

        .offer-card {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 13px;
          min-width: 0;
          padding: 16px;
          border: 1px solid var(--offer-border);
          border-radius: 14px;
          background: var(--offer-card-bg);
          box-shadow: 0 3px 12px rgb(20 30 45 / 4%);
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .offer-card:hover {
          border-color: var(--offer-accent);
          box-shadow: 0 5px 18px rgb(20 30 45 / 7%);
        }

        .offer-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          min-width: 0;
        }

        .offer-title-group {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 7px;
          min-width: 0;
          padding-top: 2px;
        }

        .offer-title-group h3 {
          margin: 0;
          font-size: 16px;
          line-height: 1.4;
          font-weight: 700;
          overflow-wrap: anywhere;
        }

        .offer-category {
          display: inline-flex;
          align-items: center;
          padding: 4px 9px;
          border-radius: 20px;
          background: var(--offer-muted-bg);
          color: var(--offer-accent);
          font-size: 11px;
          font-weight: 700;
        }

        .offer-card-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 5px;
          flex-shrink: 0;
        }

        .offer-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          border: 1px solid var(--offer-border);
          border-radius: 9px;
          background: transparent;
          color: inherit;
          font-size: 19px;
          line-height: 1;
        }

        .offer-icon-button:hover {
          background: var(--offer-muted-bg);
          border-color: var(--offer-accent);
        }

        .offer-menu-wrap {
          position: relative;
          display: inline-flex;
        }

        .offer-dropdown {
          position: absolute;
          z-index: 100;
          top: calc(100% + 7px);
          right: 0;
          width: 175px;
          padding: 6px;
          border: 1px solid var(--offer-border);
          border-radius: 11px;
          background: var(--offer-card-bg);
          box-shadow: 0 10px 30px rgb(0 0 0 / 12%);
        }

        .offer-dropdown button {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: inherit;
          text-align: left;
          font-size: 13px;
        }

        .offer-dropdown button:hover {
          background: var(--offer-muted-bg);
        }

        .offer-dropdown .delete-menu-item { color: #B54747; }

        .offer-signature-strip {
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr);
          gap: 0;
          padding: 10px;
          border-radius: 10px;
          background: var(--offer-muted-bg);
        }

        .offer-ussd {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          min-width: 0;
          padding-right: 9px;
        }

        .offer-ussd code {
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .offer-detail-action {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          padding: 5px 8px;
          border: 0;
          border-left: 1px solid var(--offer-border);
          border-radius: 0;
          background: transparent;
          color: inherit;
          text-align: left;
        }

        .offer-detail-action > span:last-child {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .offer-detail-action strong {
          font-size: 12px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .offer-detail-action:hover {
          background: var(--offer-muted-bg);
          border-radius: 7px;
        }

        .detail-icon {
          color: var(--offer-accent);
          font-size: 19px;
          flex-shrink: 0;
        }

        .detail-label {
          color: var(--offer-muted-text);
          font-size: 11px;
          line-height: 1.4;
        }

        .offer-price-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 2px 0 5px;
        }

        .offer-price {
          margin-top: 3px;
          font-size: 26px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: -0.5px;
          color: var(--offer-accent);
          overflow-wrap: anywhere;
        }

        .offer-price-caption {
          margin-top: 5px;
          color: var(--offer-muted-text);
          font-size: 12px;
        }

        .offer-compact-details {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
          padding-top: 10px;
          border-top: 1px solid var(--offer-border);
        }

        .offer-meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          max-width: 100%;
          padding: 5px 8px;
          border: 1px solid var(--offer-border);
          border-radius: 7px;
          color: inherit;
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .offer-alternative {
          margin: 0;
          padding: 10px;
          border-radius: 8px;
          background: var(--offer-muted-bg);
          font-size: 12px;
          line-height: 1.5;
        }

        .offer-card-footer {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 10px;
          border-top: 1px solid var(--offer-border);
          color: var(--offer-muted-text);
          font-size: 11px;
        }

        .offer-card-footer span { overflow-wrap: anywhere; }

        .offer-form-wrap {
          padding: 20px;
          border: 1px solid var(--offer-border);
          border-radius: 14px;
          background: var(--offer-card-bg);
        }

        .offer-form {
          display: grid;
          gap: 15px;
        }

        .offer-form label {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .offer-form input:not([type=checkbox]),
        .offer-form select {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          padding: 11px;
          border: 1px solid var(--offer-border);
          border-radius: 8px;
          background: var(--offer-card-bg);
          color: inherit;
        }

        .offer-form input:focus,
        .offer-form select:focus {
          outline: 2px solid var(--offer-accent);
          outline-offset: 1px;
        }

        .offer-form .form-check {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 9px;
        }

        .offer-form .form-check input { width: auto; }

        .offer-form .inline-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .offer-form .inline-fields > label { min-width: 0; }

        .offer-form .offer-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 8px;
        }

        .offer-form h3 { margin: 8px 0 0; }

        .offer-form hr {
          width: 100%;
          border: 0;
          border-top: 1px solid var(--offer-border);
        }

        .signature-steps {
          padding-left: 22px;
          line-height: 1.8;
        }

        @media (max-width: 1050px) {
          .offers-list { grid-template-columns: minmax(0, 1fr); }
        }

        @media (max-width: 600px) {
          .offer-card { padding: 13px; gap: 11px; }

          .offer-card-header {
            flex-direction: column;
            align-items: stretch;
          }

          .offer-card-controls {
            justify-content: flex-start;
          }

          .offer-signature-strip {
            grid-template-columns: minmax(0, 1fr);
            gap: 4px;
          }

          .offer-ussd { padding: 5px 0 10px; }

          .offer-detail-action {
            border-left: 0;
            border-top: 1px solid var(--offer-border);
            padding: 9px 2px;
          }

          .offer-price { font-size: 24px; }

          .offer-form-wrap { padding: 14px; }

          .offer-form .inline-fields {
            grid-template-columns: minmax(0, 1fr);
          }

          .offers-toolbar { align-items: flex-start; }
        }
      `}</style>

      <p className="page-description">
        Manage your data plans and offers
      </p>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Total offers</span>
          <h2>{offers.length}</h2>
        </div>
        <div className="stat-card">
          <span>Enabled plans</span>
          <h2>{offers.filter(o => o.enabled).length}</h2>
        </div>
        <div className="stat-card">
          <span>Approved signatures</span>
          <h2>{offers.filter(o => o.signatureApproved).length}</h2>
        </div>
      </div>

      {notice && <p role="status" className="page-note">{notice}</p>}

      {screen === 'list' && (
        <>
          <div className="section-heading offers-toolbar">
            <h2>Offers</h2>
            <button className="primary-button" onClick={startAdd}>+ Add Offer</button>
          </div>

          <div className="offer-filters">
            {['All', ...new Set([...categories, ...offers.map(o => o.category).filter(Boolean)])].map(category => (
              <button
                key={category}
                type="button"
                className={`filter-chip ${categoryFilter === category ? 'selected' : ''}`}
                onClick={() => setCategoryFilter(category)}
              >
                {category}{category === 'All' ? ` (${offers.length})` : ''}
              </button>
            ))}
          </div>

          {filteredOffers.length === 0 ? (
            <p className="empty-state">No offers in this category. Select Add Offer to create one.</p>
          ) : (
            <div className="offers-list">
              {filteredOffers.map(offer => {
                const alternative = offers.find(item => String(item.id) === String(offer.alternativeId))

                return (
                  <article className="offer-card" key={offer.id}>
                    <div className="offer-card-header">
                      <div className="offer-title-group">
                        <h3>{offer.name}</h3>
                        <span className="offer-category">{offer.category}</span>
                      </div>

                      <div className="offer-card-controls">
                        <button
                          type="button"
                          className={`status-badge ${offer.enabled ? 'completed' : 'pending'}`}
                          onClick={() => setOffers(previous => previous.map(item =>
                            item.id === offer.id
                              ? { ...item, enabled: !item.enabled }
                              : item
                          ))}
                          title="Toggle enabled status"
                          aria-label={`Turn ${offer.name} ${offer.enabled ? 'off' : 'on'}`}
                        >
                          {offer.enabled ? 'Enabled' : 'Disabled'}
                        </button>

                        <button
                          type="button"
                          className="offer-icon-button"
                          title="Availability window"
                          aria-label="Availability window"
                          onClick={() => openAvailability(offer)}
                        >
                          ◷
                        </button>

                        <button
                          type="button"
                          className="offer-icon-button"
                          title="Signature settings"
                          aria-label="Signature settings"
                          onClick={() => openSignature(offer)}
                        >
                          ✧
                        </button>

                        <div className="offer-menu-wrap">
                          <button
                            type="button"
                            className="offer-icon-button"
                            aria-label={`More actions for ${offer.name}`}
                            aria-expanded={openMenuId === offer.id}
                            onClick={() => setOpenMenuId(openMenuId === offer.id ? null : offer.id)}
                          >
                            ⋮
                          </button>

                          {openMenuId === offer.id && (
                            <div className="offer-dropdown">
                              <button type="button" onClick={() => startEdit(offer)}>
                                <span>✎</span> Edit offer
                              </button>
                              <button type="button" onClick={() => copyOffer(offer)}>
                                <span>▢</span> Copy offer
                              </button>
                              <button
                                type="button"
                                className="delete-menu-item"
                                onClick={() => deleteOffer(offer.id)}
                              >
                                <span>♲</span> Delete offer
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="offer-signature-strip">
                      <div className="offer-ussd">
                        <span className="detail-label">USSD template</span>
                        <code>{offer.ussd}</code>
                      </div>

                      <button
                        type="button"
                        className="offer-detail-action"
                        onClick={() => openAvailability(offer)}
                      >
                        <span className="detail-icon">◷</span>
                        <span>
                          <span className="detail-label">Availability</span>
                          <strong>
                            {offer.useWindow
                              ? `${offer.availableFrom}–${offer.availableUntil}`
                              : 'All day'}
                          </strong>
                        </span>
                      </button>

                      <button
                        type="button"
                        className="offer-detail-action"
                        onClick={() => openSignature(offer)}
                      >
                        <span className="detail-icon">✧</span>
                        <span>
                          <span className="detail-label">Signature</span>
                          <strong>{offer.signatureApproved ? 'Approved' : 'Not approved'}</strong>
                        </span>
                      </button>
                    </div>

                    <div className="offer-price-row">
                      <div>
                        <div className="detail-label">Selling price</div>
                        <div className="offer-price">
                          KES {Number(offer.sellingPrice).toLocaleString('en-KE')}
                        </div>
                        <div className="offer-price-caption">
                          Safaricom price: KES {Number(offer.safaricomPrice).toLocaleString('en-KE')}
                        </div>
                      </div>
                    </div>

                    <div className="offer-compact-details">
                      <span className="offer-meta-chip">
                        Payment: <strong>{offer.paymentMode}</strong>
                      </span>
                      <span className="offer-meta-chip">
                        Execute: <strong>{offer.executionSim}</strong>
                      </span>
                      <span className="offer-meta-chip">
                        Notify SIM: <strong>{offer.notificationSim}</strong>
                      </span>
                      <span className="offer-meta-chip">
                        Type: <strong>{offer.ussdType}</strong>
                      </span>
                      <span className="offer-meta-chip">
                        Retry: <strong>{offer.autoRetry === 'Off' ? 'Off' : `${offer.autoRetry} (${offer.retryCount})`}</strong>
                      </span>
                    </div>

                    {offer.useWindow && (
                      <div className="offer-alternative">
                        Alternative offer: <strong>{alternative?.name || 'Not configured'}</strong>
                        {' · '}Customer notification: {offer.notifyCustomer ? 'On' : 'Off'}
                      </div>
                    )}

                    <div className="offer-card-footer">
                      <span>{offer.enabled ? '● Enabled' : '○ Disabled'}</span>
                      <span>Updated: {offer.updatedAt || 'Not recorded'}</span>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <p className="page-note">
            Demo mode: offers are stored in app memory and reset when the page is refreshed.
            Real USSD execution, signature detection and purchases are not connected.
          </p>

          <button type="button" className="primary-button" onClick={() => setActivePage('Home')}>
            ← Back to Home
          </button>
        </>
      )}

      {screen === 'form' && (
        <div className="offer-form-wrap">
          <div className="section-heading">
            <h2>{editingId ? 'Edit Offer' : 'Add Offer'}</h2>
            <button type="button" className="text-button" onClick={() => setScreen('list')}>Cancel</button>
          </div>

          <form className="offer-form" onSubmit={saveOffer}>
            <label className="form-check">
              <input
                type="checkbox"
                checked={Boolean(form.enabled)}
                onChange={e => updateField('enabled', e.target.checked)}
              />
              Enable plan
            </label>

            <label>Category
              <select value={form.category} onChange={e => updateField('category', e.target.value)}>
                {[...new Set([...categories, form.category])].map(category => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>

            <div className="inline-fields">
              <input
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                placeholder="Add your own category"
                aria-label="New category name"
              />
              <button type="button" className="text-button" onClick={addCategory}>Add category</button>
            </div>

            <label>Plan name
              <input
                required
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
                placeholder="e.g. 1GB — 1 hour"
              />
            </label>

            <label>USSD template (use ab for customer's phone number)
              <input
                required
                value={form.ussd}
                onChange={e => updateField('ussd', e.target.value)}
                placeholder="*180*5*2*ab*5*1#"
              />
            </label>

            <div className="inline-fields">
              <label>Selling price (KES)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.sellingPrice}
                  onChange={e => updateField('sellingPrice', e.target.value)}
                />
              </label>
              <label>Safaricom price (KES)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.safaricomPrice}
                  onChange={e => updateField('safaricomPrice', e.target.value)}
                />
              </label>
            </div>

            <label>Payment mode
              <select value={form.paymentMode} onChange={e => updateField('paymentMode', e.target.value)}>
                {['Personal SIM', 'Till SIM', 'Paybill SIM', 'All'].map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>

            <div className="inline-fields">
              <label>Execute SIM
                <select value={form.executionSim} onChange={e => updateField('executionSim', e.target.value)}>
                  {['SIM 1', 'SIM 2'].map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>Notification SIM
                <select value={form.notificationSim} onChange={e => updateField('notificationSim', e.target.value)}>
                  {['SIM 1', 'SIM 2'].map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
            </div>

            <label>Type
              <select value={form.ussdType} onChange={e => updateField('ussdType', e.target.value)}>
                {['Simple', 'Advanced', 'Express'].map(item => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>Auto retry
              <select value={form.autoRetry} onChange={e => updateField('autoRetry', e.target.value)}>
                {['Off', 'Pending only', 'Failed only', 'Failed or pending'].map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>

            {form.autoRetry !== 'Off' && (
              <label>Retry count
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={form.retryCount}
                  onChange={e => updateField('retryCount', e.target.value)}
                />
              </label>
            )}

            <hr />
            <h3>Availability Window</h3>

            <label className="form-check">
              <input
                type="checkbox"
                checked={Boolean(form.useWindow)}
                onChange={e => updateField('useWindow', e.target.checked)}
              />
              Limit this offer to certain hours
            </label>

            {form.useWindow && (
              <>
                <div className="inline-fields">
                  <label>Available from
                    <input
                      type="time"
                      required
                      value={form.availableFrom}
                      onChange={e => updateField('availableFrom', e.target.value)}
                    />
                  </label>
                  <label>Available until
                    <input
                      type="time"
                      required
                      value={form.availableUntil}
                      onChange={e => updateField('availableUntil', e.target.value)}
                    />
                  </label>
                </div>

                <label>Alternative offer outside this window
                  <select
                    required
                    value={form.alternativeId}
                    onChange={e => updateField('alternativeId', e.target.value)}
                  >
                    <option value="">Choose an alternative offer</option>
                    {offers.filter(item => item.id !== editingId && item.enabled).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name} — KES {item.sellingPrice}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-check">
                  <input
                    type="checkbox"
                    checked={Boolean(form.notifyCustomer)}
                    onChange={e => updateField('notifyCustomer', e.target.checked)}
                  />
                  Notify customer when alternative offer is used
                </label>
              </>
            )}

            <div className="offer-actions">
              <button type="submit" className="primary-button">
                {editingId ? 'Save Changes' : 'Add Offer'}
              </button>
              <button type="button" className="text-button" onClick={() => setScreen('list')}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {screen === 'availability' && selectedOffer && (
        <div className="offer-form-wrap">
          <div className="section-heading">
            <h2>◷ Availability Window</h2>
            <button type="button" className="text-button" onClick={() => setScreen('list')}>Close</button>
          </div>

          <p>Configure availability for <strong>{selectedOffer.name}</strong>.</p>

          <form className="offer-form" onSubmit={saveAvailability}>
            <label className="form-check">
              <input
                type="checkbox"
                checked={Boolean(form.useWindow)}
                onChange={e => updateField('useWindow', e.target.checked)}
              />
              Enable availability window
            </label>

            {form.useWindow && (
              <>
                <div className="inline-fields">
                  <label>Available from
                    <input
                      type="time"
                      required
                      value={form.availableFrom}
                      onChange={e => updateField('availableFrom', e.target.value)}
                    />
                  </label>
                  <label>Available until
                    <input
                      type="time"
                      required
                      value={form.availableUntil}
                      onChange={e => updateField('availableUntil', e.target.value)}
                    />
                  </label>
                </div>

                <label>Alternative offer outside this window
                  <select
                    required
                    value={form.alternativeId}
                    onChange={e => updateField('alternativeId', e.target.value)}
                  >
                    <option value="">Choose an alternative offer</option>
                    {offers.filter(item => item.id !== editingId && item.enabled).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name} — KES {item.sellingPrice}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-check">
                  <input
                    type="checkbox"
                    checked={Boolean(form.notifyCustomer)}
                    onChange={e => updateField('notifyCustomer', e.target.checked)}
                  />
                  Notify customer when alternative offer is used
                </label>
              </>
            )}

            <p className="page-note">
              This saves the settings in app state. Automatic time checks and offer switching are not connected.
            </p>
            <button type="submit" className="primary-button">Save Availability</button>
          </form>
        </div>
      )}

      {screen === 'signature' && selectedOffer && (
        <div className="offer-form-wrap">
          <div className="section-heading">
            <h2>✧ Signature Dashboard</h2>
            <button type="button" className="text-button" onClick={() => setScreen('list')}>Close</button>
          </div>

          <p>Offer: <strong>{selectedOffer.name}</strong></p>
          <p>Sample phone number: <strong>0700000000</strong></p>
          <p>USSD template: <code>{selectedOffer.ussd}</code></p>
          <p>Current status: <strong>{selectedOffer.signatureApproved ? 'Approved' : 'Not approved'}</strong></p>

          <h3>Signature learning steps</h3>
          <ol className="signature-steps">
            {learningSteps.slice(0, learningStep + 1).map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          {!learned ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (learningStep < learningSteps.length - 1) {
                  setLearningStep(step => step + 1)
                } else {
                  setLearned(true)
                }
              }}
            >
              {learningStep < learningSteps.length - 1
                ? 'Next learning step'
                : 'Finish demo learning'}
            </button>
          ) : (
            <>
              <p className="page-note">
                Demo only: no real USSD session was run and no offer was verified.
              </p>

              <label className="form-check">
                <input
                  type="checkbox"
                  checked={demoApproved}
                  onChange={e => setDemoApproved(e.target.checked)}
                />
                I have reviewed this demo result
              </label>

              <button
                type="button"
                className="primary-button"
                disabled={!demoApproved}
                onClick={() => {
                  setOffers(previous => previous.map(item =>
                    item.id === selectedOffer.id
                      ? { ...item, signatureApproved: true, updatedAt: new Date().toLocaleString() }
                      : item
                  ))
                  setScreen('list')
                  setNotice('Demo signature marked as approved.')
                }}
              >
                Approve demo signature
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setLearned(false)
                  setDemoApproved(false)
                  setLearningStep(0)
                }}
              >
                Relearn signature
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function App() {
    const [myOffers, setMyOffers] = useState(() => {
  try { return JSON.parse(localStorage.getItem('myOffers')) || [] } catch { return [] }
})
useEffect(() => { localStorage.setItem('myOffers', JSON.stringify(myOffers)) }, [myOffers])
const saveOffer = o => setMyOffers(p => p.some(x => x.id === o.id) ? p.map(x => x.id === o.id ? o : x) : [...p, o])
  const [light, setLight] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activePage, setActivePage] = useState('Home')
  const [automationRunning, setAutomationRunning] = useState(true)
  const [filter, setFilter] = useState('All')
  const [showBalances, setShowBalances] = useState(true)
  const [offers, setOffers] = useState(startingOffers)
    const [profile, setProfile] = useState(loadProfile)
  const [mode, setMode] = useState(loadMode)
  const [clock, setClock] = useState(new Date())
    const [modeOpen, setModeOpen] = useState(false)

  function changeMode(id) {
    setMode(id)
    saveMode(id)
    setModeOpen(false)
  }

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const transactions = initialTransactions.filter(transaction =>
    filter === 'All' || transaction.status === filter
  )

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
            <small>Demo mode</small>
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
          <>
            <HomePage
              offers={offers}
              onOpenTokens={() => setActivePage('Tokens')}
            />

            <div className="automation-actions">
              <button
                className="stop-button"
                onClick={() => setAutomationRunning(false)}
                disabled={!automationRunning}
              >
                ■ Stop automation
              </button>
              <button
                className="start-button"
                onClick={() => setAutomationRunning(true)}
                disabled={automationRunning}
              >
                ▶ Start automation
              </button>
            </div>
          </>
        ) : activePage === 'OldHome' ? (
          <>
            <section className="balances-section">
              <div className="section-heading">
                <h2>Balances</h2>
                <button className="text-button" onClick={() => setShowBalances(!showBalances)}>
                  {showBalances ? 'Hide values' : 'Show values'}
                </button>
              </div>

              <div className="balance-grid">
                <article className="balance-card airtime">
                  <span className="card-symbol">▯</span>
                  <strong>{showBalances ? 'KES 11,274.24' : 'KES ••••••'}</strong>
                  <span>Balance</span>
                </article>

                <article className="balance-card used">
                  <span className="card-symbol">◷</span>
                  <strong>{showBalances ? 'KES 286.00' : 'KES ••••••'}</strong>
                  <span>Used</span>
                </article>

                <article className="balance-card tokens">
                  <span className="card-symbol">▤</span>
                  <strong>2w 6d</strong>
                  <span>Tokens</span>
                </article>
              </div>
            </section>

            <section className="panel overview">
              <div className="section-heading"><h2>Overview</h2></div>
              <div className="stats-grid">
                <div className="stat completed"><strong>155</strong><span>Successful</span></div>
                <div className="stat pending"><strong>0</strong><span>Pending</span></div>
                <div className="stat scheduled"><strong>0</strong><span>Scheduled</span></div>
                <div className="stat failed"><strong>0</strong><span>Failed</span></div>
              </div>
            </section>

            <section className="panel commissions">
              <div className="section-heading">
                <h2>Daily commissions</h2>
                <span className="muted">Last 7 days</span>
              </div>
              <CommissionChart />
            </section>

            <section className="panel recent">
<div className="section-heading">
  <h2>Recent transactions</h2>
  <button className="text-button" onClick={() => setActivePage('Transactions')}>View all</button>
</div>

              <div className="filters">
                {['All', 'Completed', 'Pending', 'Failed', 'Scheduled', 'Unmatched', 'Sitelink'].map(item => (
                  <button
                    key={item}
                    className={`filter-chip ${filter === item ? 'selected' : ''}`}
                    onClick={() => setFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="transactions">
                {transactions.length ? transactions.slice(0, 3).map(transaction => (
                  <article className="transaction" key={transaction.id}>
                    <div className="avatar">{transaction.initials}</div>
                    <div className="transaction-info">
                      <strong>{transaction.name}</strong>
                      <span>{transaction.phone}</span>
                    </div>
                    <div className="transaction-result">
                      <strong className="completed-text">{transaction.status}</strong>
                      <span>{transaction.time}</span>
                    </div>
                  </article>
                )) : (
                  <p className="empty-state">No {filter.toLowerCase()} transactions in this demo.</p>
                )}
              </div>
            </section>

            <div className="automation-actions">
              <button
                className="stop-button"
                onClick={() => setAutomationRunning(false)}
                disabled={!automationRunning}
              >
                ■ Stop automation
              </button>
              <button
                className="start-button"
                onClick={() => setAutomationRunning(true)}
                disabled={automationRunning}
              >
                ▶ Start automation
              </button>
            </div>

            <p className="demo-note">
              Prototype only: these controls do not dial USSD or process real M-Pesa messages.
            </p>
          </>
          ) : activePage === 'Signature' ? (
  <Signature owned={myOffers} onDownload={saveOffer} />
) : activePage === 'Offers' ? (
          <Offers offers={myOffers} onSave={saveOffer} />
                ) : activePage === 'Offers' ? (
          <section className="panel placeholder-page">
            <OffersPage
              offers={offers}
              setOffers={setOffers}
              setActivePage={setActivePage}
            />
          </section>
        ) : activePage === 'QuickDial' ? (
          <section className="panel">
            <QuickDialPage
              offers={offers}
              onBack={() => setActivePage('Home')}
              onOpenOffers={() => setActivePage('Offers')}
            />
          </section>
        ) : activePage === 'Autorenewal' ? (
          <section className="panel">
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
          <section className="panel">
            <AutoRepliesPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Autobingwa Connect' ? (
          <section className="panel">
            <ConnectPage onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Fallback Plans' ? (
          <section className="panel">
            <FallbackPage offers={offers} onBack={() => setActivePage('Home')} />
          </section>
        ) : activePage === 'Settings' ? (
          <section className="panel">
            <SettingsPage
              onBack={() => setActivePage('Home')}
              onProfileChange={setProfile}
              onModeChange={setMode}
            />
          </section>
        ) : (    <section className="panel placeholder-page">
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
      {modeOpen && (
        <ModeDialog mode={mode} onSelect={changeMode} onClose={() => setModeOpen(false)} />
      )}
    </div>
  )
}

export default App
