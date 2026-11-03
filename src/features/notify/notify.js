export const TOAST_EVENT = 'autobingwa-toast'

export function notify(message, type = 'info', title = '') {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, type, title } }))
}