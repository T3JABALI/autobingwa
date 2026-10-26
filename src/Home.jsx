import { useState } from 'react'
import logoMark from './assets/logo-mark-teal.png'
function Home({ name = 'CYPRIAN', stats = {ok:0, failed:0, sub:'Expired'}, airtime = 0, balance = 0, week = [0,0,0,0,0,0,0], txs = [], onViewAll }) {
useState(true)
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const max = Math.max(...week, 1);
  const today = new Date().getDay();
  const mask = v => hide ? '••••' : `Ksh ${v}`;
  const hour = new Date().getHours()
const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening'
  return (
    <div className="home">
      <div className="home-head">
        <img src={logoMark} alt="" />
<div><small>{greeting}</small><h2>{name}</h2></div>
      </div>

      <div className="home-stats">
        <div className="stat ok"><b>{stats.ok}</b><span>Successful</span></div>
        <div className="stat bad"><b>{stats.failed}</b><span>Failed</span></div>
        <div className="stat sub"><b>{stats.sub}</b><span>Subscription</span></div>
      </div>

      <div className="home-card balance-row">
        <div><small>Airtime today</small><strong>{mask(airtime)}</strong></div>
        <div><small>Balance</small><strong>{mask(balance)}</strong></div>
        <button className="icon-btn" onClick={() => setHide(!hide)}>{hide ? '🙈' : '👁'}</button>
      </div>

      <div className="home-card">
        <div className="week-head"><b>Weekly Commission</b><span className="total">Ksh {week.reduce((a,b)=>a+b,0)}</span></div>
        <div className="bars">
          {week.map((v,i) => <div key={i} className={`bar ${i===today?'today':''}`} style={{height: `${(v/max)*100}%`}} />)}
        </div>
        <div className="days">{days.map(d => <span key={d}>{d}</span>)}</div>
      </div>

      <div className="recent-head"><b>Recent Transactions</b><a onClick={onViewAll}>View all →</a></div>
      {txs.length === 0
        ? <div className="empty"><b>No transactions yet</b><br/>Your recent activity will appear here</div>
        : txs.slice(0,5).map((t,i) => <div key={i} className="home-card">{t.phone} · Ksh {t.amount}</div>)}
    </div>
  );
}
export default Home