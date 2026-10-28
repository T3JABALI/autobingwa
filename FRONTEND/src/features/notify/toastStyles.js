export const CSS = `
.tt-wrap {
  position: fixed; left: 0; right: 0; top: 0; z-index: 200;
  display: grid; gap: 10px; padding: 12px; pointer-events: none;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
}
.tt {
  pointer-events: auto; max-width: 440px; width: 100%; margin: 0 auto;
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border-radius: 16px; background: var(--card-bg, #FBF8EF); color: var(--text, #12302C);
  border: 1px solid var(--border-color, #D9CFB8);
  border-left: 5px solid var(--primary, #0E7C6B);
  box-shadow: 0 8px 24px rgb(0 0 0 / 22%);
  animation: tt-in 0.3s ease-out;
}
.tt.success { border-left-color: var(--success, #1B8A5A); }
.tt.error { border-left-color: var(--danger, #B3402F); }
.tt.processing { border-left-color: var(--warning, #B7791F); }
.tt.motivation { border-left-color: var(--warning, #B7791F); font-style: italic; }
.tt-body { flex: 1; min-width: 0; }
.tt-title { font-weight: 700; font-size: 14px; }
.tt-msg { font-size: 14px; overflow-wrap: anywhere; }
.tt-x { border: 0; background: transparent; color: inherit; font-size: 20px; cursor: pointer; padding: 4px 8px; }
.tt-spin {
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
  border: 3px solid var(--border-color, #D9CFB8); border-top-color: var(--warning, #B7791F);
  animation: tt-rot 0.8s linear infinite;
}
@keyframes tt-in { from { transform: translateY(-16px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tt-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tt, .tt-spin { animation-duration: 3s; } }
`