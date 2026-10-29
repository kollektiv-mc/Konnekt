interface ColorSwatchProps {
  hex: string
  selected: boolean
  onClick: () => void
  label?: string
}

export function ColorSwatch({ hex, selected, onClick, label }: ColorSwatchProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label ?? hex}
      className="h-7 w-7 shrink-0 rounded-full transition-transform hover:scale-110"
      // eslint-disable-next-line no-restricted-syntax -- hex is an arbitrary runtime color, not a static token
      style={{
        background: hex,
        outline: selected ? `2.5px solid ${hex}` : '2.5px solid transparent',
        outlineOffset: 2,
        boxShadow: selected ? `0 0 8px ${hex}60` : 'none',
      }}
    />
  )
}
