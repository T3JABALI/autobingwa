// Supabase needs 6+ characters, so the 5-digit PIN is expanded into a longer password.
export const pinToPassword = (pin) => `ab-${pin}-bingwa-2026`;