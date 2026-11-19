/** The providers.dev mark ("p" and "d" sharing one bowl), bare: ink in currentColor, the dot in the brand colour. */
export function ProvidersDevMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="pmx-pdev-mark"
      viewBox="8 4 16 24"
      width={(size * 2) / 3}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="4">
        <circle cx="16" cy="16" r="6" />
        <path d="M10 16v12M22 16V4" />
      </g>
      <circle cx="16" cy="16" r="1.9" fill="#a5b4fc" />
    </svg>
  );
}
