
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
        gap: '36px',
        background: '#003D39',
        color: '#FFFFFF',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <AutobingwaLogo size={320} />

      <div style={{ textAlign: 'center' }}>
        <p style={{ color: '#B9F5E8' }}>SYMBOL ONLY</p>
        <AutobingwaLogo size={150} showWordmark={false} />
      </div>
    </main>
  );
}
