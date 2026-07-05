// Card "titolo": intestazione testuale per organizzare la dashboard in sezioni.
export function TitleCard({ text, subtitle }: { text?: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', padding: '2px 4px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--on-wallpaper)', letterSpacing: '-0.02em' }}>
        {text || 'Titolo'}
      </div>
      {subtitle && (
        <div style={{ fontSize: 13, color: 'var(--on-wallpaper-dim)', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  )
}
