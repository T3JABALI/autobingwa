export const CSS = `
.hm-page {
  --hm-accent: var(--accent-color, #1F5EFF);
  --hm-card: var(--card-bg, #FFFFFF);
  --hm-border: var(--border-color, #D5DDF0);
  --hm-soft: var(--muted-text, #4A5568);
  --hm-hover: var(--muted-bg, #E6EDFF);
  --hm-on: var(--on-primary, #FFFFFF);
  --hm-ok: var(--success, #0A7D4B);
  --hm-warn: var(--warning, #B45309);
  --hm-bad: var(--danger, #D32F2F);
  width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 22px;
}
.hm-ico {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.hm-icon {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.hm-icon:hover { background: var(--hm-hover); }
.hm-icon:focus-visible,
.hm-bal:focus-visible,
.hm-chip:focus-visible,
.hm-row:focus-visible,
.hm-act:focus-visible,
.hm-info-body:focus-visible,
.hm-btn:focus-visible {
  outline: 2px solid var(--hm-accent);
  outline-offset: 3px;
}
.hm-note {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--hm-hover);
  font-size: 14px;
}
.hm-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.hm-sec-head h2 { margin: 0; font-size: 19px; }
.hm-total { color: var(--hm-soft); font-size: 14px; }
.hm-total b { color: var(--hm-accent); font-size: 17px; }

.hm-bals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}
.hm-bal {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 18px;
  border: 0;
  border-radius: 18px;
  text-align: left;
  font: inherit;
  color: var(--hm-on);
  min-height: 104px;
}
button.hm-bal { cursor: pointer; }
.hm-bal.air { background: var(--hm-accent); }
.hm-bal.used { background: var(--hm-warn); }
.hm-bal.tok { background: var(--hm-ok); }
.hm-bal-val {
  font-size: 24px;
  font-weight: 800;
  overflow-wrap: anywhere;
  padding-right: 36px;
}
.hm-bal-label { font-size: 14px; font-weight: 600; }
.hm-bal-sub { font-size: 13px; }
.hm-bal .hm-icon {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 40px;
  height: 40px;
}
.hm-bal .hm-icon:hover { background: rgb(0 0 0 / 14%); }
.hm-spin .hm-ico { animation: hm-rot 0.7s linear infinite; }
@keyframes hm-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .hm-spin .hm-ico { animation-duration: 3s; }
}

.hm-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (min-width: 640px) {
  .hm-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.hm-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border: 1px solid var(--hm-border);
  border-radius: 16px;
  background: var(--hm-card);
}
.hm-stat-n { font-size: 30px; font-weight: 800; }
.hm-stat-l { color: var(--hm-soft); font-size: 14px; }
.hm-ok { color: var(--hm-ok); }
.hm-warn { color: var(--hm-warn); }
.hm-info-c { color: var(--hm-accent); }
.hm-bad { color: var(--hm-bad); }

.hm-card {
  padding: 18px;
  border: 1px solid var(--hm-border);
  border-radius: 18px;
  background: var(--hm-card);
}
.hm-chart svg { width: 100%; height: auto; display: block; }
.hm-grid { stroke: var(--hm-border); stroke-width: 1; }
.hm-axis { fill: var(--hm-soft); font-size: 11px; }
.hm-axis.today { fill: var(--hm-accent); font-weight: 700; }
.hm-line {
  fill: none;
  stroke: var(--hm-accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.hm-area { fill: var(--hm-accent); opacity: 0.14; }
.hm-dot { fill: var(--hm-card); stroke: var(--hm-accent); stroke-width: 3; }

.hm-chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 8px;
}
.hm-chip {
  flex: 0 0 auto;
  padding: 10px 16px;
  border: 1px solid var(--hm-border);
  border-radius: 999px;
  background: var(--hm-card);
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.hm-chip.on {
  background: var(--hm-accent);
  color: var(--hm-on);
  border-color: var(--hm-accent);
}
.hm-list { display: grid; gap: 10px; }
.hm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border: 1px solid var(--hm-border);
  border-radius: 14px;
  background: var(--hm-card);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hm-row:hover { background: var(--hm-hover); }
.hm-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--hm-accent);
  color: var(--hm-on);
  display: grid;
  place-items: center;
  font-weight: 700;
  flex-shrink: 0;
}
.hm-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hm-row-name { font-weight: 700; overflow-wrap: anywhere; }
.hm-row-sub { color: var(--hm-soft); font-size: 13px; overflow-wrap: anywhere; }
.hm-row-end {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
  font-size: 13px;
}
.hm-row-end .st { font-weight: 700; }
.hm-row-end .when { color: var(--hm-soft); }
.hm-empty { text-align: center; color: var(--hm-soft); padding: 26px 12px; }
.hm-empty p { margin: 0 0 14px; }

.hm-head { display: flex; align-items: center; gap: 8px; }
.hm-head h2 { margin: 0; font-size: 21px; }
.hm-status {
  display: inline-block;
  padding: 8px 16px;
  border-radius: 999px;
  color: var(--hm-on);
  font-weight: 700;
  font-size: 15px;
}
.hm-status.ok { background: var(--hm-ok); }
.hm-status.warn { background: var(--hm-warn); }
.hm-status.info { background: var(--hm-accent); }
.hm-status.bad { background: var(--hm-bad); }
.hm-money { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.hm-amount { font-size: 28px; font-weight: 800; color: var(--hm-accent); }
.hm-offer {
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--hm-hover);
  color: var(--hm-accent);
  font-weight: 700;
  font-size: 14px;
}
.hm-when {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px;
  color: var(--hm-soft);
  font-size: 15px;
}
.hm-when span { display: inline-flex; align-items: center; gap: 8px; }
.hm-when .hm-ico { width: 20px; height: 20px; }
.hm-info {
  padding: 14px 16px;
  border: 1px solid var(--hm-border);
  border-radius: 16px;
  background: var(--hm-card);
}
.hm-info-head { display: flex; align-items: center; justify-content: space-between; }
.hm-info-title { font-weight: 600; font-size: 14px; color: var(--hm-soft); }
.hm-info-body {
  display: block;
  width: 100%;
  padding: 4px 0 2px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
}
.hm-info-body:disabled { color: inherit; cursor: default; }
.hm-info-text {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.6;
}
.hm-info-text.clamp {
  display: -webkit-box;
  -webkit-line-clamp: var(--lines);
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hm-info-hint { display: block; margin-top: 6px; color: var(--hm-soft); font-size: 13px; }
.hm-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.hm-act {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 20px;
  border: 2px solid var(--hm-border);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.hm-act:hover:not(:disabled) { background: var(--hm-hover); }
.hm-act.del { color: var(--hm-bad); border-color: var(--hm-bad); }
.hm-act:disabled { opacity: 0.45; cursor: not-allowed; }
.hm-hint { margin: -8px 0 0; color: var(--hm-soft); font-size: 13px; }
.hm-field {
  width: 100%;
  box-sizing: border-box;
  padding: 15px;
  border: 2px solid var(--hm-border);
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 16px;
  outline: none;
}
.hm-field:focus { border-color: var(--hm-accent); }
.hm-lab { display: block; margin: 0 0 8px; font-weight: 600; font-size: 14px; }
.hm-err { margin: 0; color: var(--hm-bad); font-weight: 600; font-size: 14px; }
.hm-btn {
  display: block;
  width: 100%;
  padding: 18px 0;
  border: 0;
  border-radius: 999px;
  background: var(--hm-accent);
  color: var(--hm-on);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}
.hm-btn.ghost {
  background: transparent;
  color: inherit;
  border: 2px solid var(--hm-border);
}
`