import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { pinToPassword } from './pin';
import './auth.css';

const isPin = (p) => /^\d{5}$/.test(p);
const TITLES = {
  login: 'Welcome back',
  signup: 'Create account',
  verify: 'Verify your email',
  forgot: 'Forgot PIN',
  reset: 'Set a new PIN',
};

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // login | signup | verify | forgot | reset
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const go = (m) => { setMode(m); setError(''); setInfo(''); };
  const digits = (set, max) => (e) => set(e.target.value.replace(/\D/g, '').slice(0, max));

  const run = async (fn) => {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); } catch (e) { setError(e.message || 'Something went wrong.'); }
    setBusy(false);
  };

  const checkNewPin = () => {
    if (!isPin(pin)) throw new Error('PIN must be exactly 5 digits.');
    if (pin !== pin2) throw new Error('The two PINs do not match.');
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'signup') {
        checkNewPin();
        const { data, error } = await supabase.auth.signUp({ email, password: pinToPassword(pin) });
        if (error) throw error;
        if (data.user && data.user.identities?.length === 0)
          throw new Error('An account with this email already exists. Please log in.');
        setMode('verify');
        setInfo('We sent a code to ' + email);
      } else if (mode === 'login') {
        if (!isPin(pin)) throw new Error('Enter your 5-digit PIN.');
        const { error } = await supabase.auth.signInWithPassword({ email, password: pinToPassword(pin) });
        if (error) {
          if (/not confirmed/i.test(error.message)) {
            await supabase.auth.resend({ type: 'signup', email });
            setMode('verify');
            setInfo('Your email is not verified. We sent a new code to ' + email);
            return;
          }
          throw new Error('Wrong email or PIN.');
        }
      } else if (mode === 'verify') {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw new Error('Wrong or expired code. Try again.');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (error) throw new Error('Could not send a code. Check the email and try again.');
        setMode('reset');
        setInfo('We sent a code to ' + email);
      } else if (mode === 'reset') {
        checkNewPin();
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw new Error('Wrong or expired code. Try again.');
        const { error: e2 } = await supabase.auth.updateUser({ password: pinToPassword(pin) });
        if (e2) throw e2;
      }
    });
  };

  const resend = () => run(async () => {
    const { error } = mode === 'verify'
      ? await supabase.auth.resend({ type: 'signup', email })
      : await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw error;
    setInfo('A new code was sent.');
  });

  const showEmail = mode === 'login' || mode === 'signup' || mode === 'forgot';
  const showPin = mode === 'login' || mode === 'signup' || mode === 'reset';
  const showPin2 = mode === 'signup' || mode === 'reset';
  const showCode = mode === 'verify' || mode === 'reset';

  return (
    <div className="au-wrap">
      <form className="au-card" onSubmit={submit}>
        <h1 className="au-title">{TITLES[mode]}</h1>

        {showEmail && (
          <input className="au-input" type="email" placeholder="Email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        )}
        {showCode && (
          <input className="au-input au-code" inputMode="numeric" maxLength={6} placeholder="Code from email"
            value={code} onChange={digits(setCode, 6)} required />
        )}
{showPin && (
  <>
    <div className="au-row">
      <input className="au-input au-code" type="password" inputMode="numeric" maxLength={5}
        placeholder={mode === 'reset' ? 'New PIN' : 'PIN'}
        value={pin} onChange={digits(setPin, 5)} required />
      {showPin2 && (
        <input className="au-input au-code" type="password" inputMode="numeric" maxLength={5}
          placeholder="Confirm PIN" value={pin2} onChange={digits(setPin2, 5)} required />
      )}
    </div>
    {showPin2 && <p className="au-hint">Choose a 5-digit PIN you will remember</p>}
  </>
)}

        {info && <div className="au-info">{info}</div>}
        {error && <div className="au-error">{error}</div>}

        <button className="au-btn" disabled={busy}>
          {busy ? 'Please wait…' : { login: 'Log in', signup: 'Sign up', verify: 'Verify', forgot: 'Send code', reset: 'Save new PIN' }[mode]}
        </button>

        {(mode === 'verify' || mode === 'reset') && (
          <button type="button" className="au-link" onClick={resend} disabled={busy}>Resend code</button>
        )}
        {mode === 'login' && (
          <>
            <button type="button" className="au-link" onClick={() => go('forgot')}>Forgot PIN?</button>
            <button type="button" className="au-link" onClick={() => go('signup')}>New here? Create an account</button>
          </>
        )}
        {mode !== 'login' && (
          <button type="button" className="au-link" onClick={() => go('login')}>Back to log in</button>
        )}
      </form>
    </div>
  );
}