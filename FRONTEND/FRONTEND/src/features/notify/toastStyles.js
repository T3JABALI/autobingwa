export const CSS = `
.tt-wrap {
  position: fixed; left: 0; right: 0; top: 0; z-index: 200;
  display: grid; gap: 6px; padding: 8px; pointer-events: none;
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
}
.tt {
  pointer-events: auto; max-width: 300px; width: auto; margin: 0 auto;
  display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  border-radius: 999px; background: var(--card-bg, #FBF8EF); color: var(--text, #12302C);
  border: 1px solid var(--border-color, #D9CFB8);
  border-left: 4px solid var(--primary, #0E7C6B);
  box-shadow: 0 4px 12px rgb(0 0 0 / 20%);
  animation: tt-in 0.25s ease-out;
}
.tt.success { border-left-color: var(--success, #1B8A5A); }
.tt.error, .tt.failed { border-left-color: var(--danger, #B3402F); }
.tt.processing { border-left-color: var(--warning, #B7791F); }
.tt.motivation { border-left-color: var(--warning, #B7791F); font-style: italic; }
.tt-body { flex: 1; min-width: 0; }
.tt-title { font-weight: 700; font-size: 12px; line-height: 1.2; }
.tt-msg {
  font-size: 12px; line-height: 1.3; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.tt-x { border: 0; background: transparent; color: inherit; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.tt-spin {
  width: 13px; height: 13px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid var(--border-color, #D9CFB8); border-top-color: var(--warning, #B7791F);
  animation: tt-rot 0.8s linear infinite;
}
@keyframes tt-in { from { transform: translateY(-10px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tt-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tt, .tt-spin { animation-duration: 3s; } }
`