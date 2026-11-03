
import AutobingwaLogo from './AutobingwaLogo.jsx';

export default function LogoPreview() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        background: '#003D39',
        color: '#FFFFFF',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <AutobingwaLogo size={320} />

      <p style={{ color: '#B9F5E8', marginBottom: 0 }}>
        SYMBOL ONLY
      </p>

      <AutobingwaLogo size={150} showWordmark={false} />
    </main>
  );
}
