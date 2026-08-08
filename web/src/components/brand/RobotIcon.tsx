import type { SVGProps } from 'react'

/**
 * The flat-design robot, rebuilt as inline SVG.
 *
 * The reference was a raster illustration, so there was nothing to import —
 * this redraws it in vector form: crisp at any size, themeable, and no
 * dependency. Colours are fixed rather than `currentColor`, because the mark
 * is multi-colour by design; it reads on both light and dark surfaces.
 */
export function RobotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Ears */}
      <rect x="38" y="72" width="62" height="92" rx="18" fill="#aeb6bf" />
      <rect x="38" y="72" width="26" height="92" rx="18" fill="#98a1ab" />
      <rect x="412" y="72" width="62" height="92" rx="18" fill="#aeb6bf" />
      <rect x="448" y="72" width="26" height="92" rx="18" fill="#98a1ab" />

      {/* Head */}
      <rect x="88" y="8" width="336" height="222" rx="106" fill="#e6e7e8" />
      <path
        d="M194 8h-0C135 8 88 55 88 114v10c0 59 47 106 106 106h-6c-59 0-72-47-72-106v-10c0-59 13-106 72-106z"
        fill="#d3d5d7"
      />

      {/* Visor */}
      <rect x="136" y="34" width="240" height="170" rx="82" fill="#57596b" />
      <path
        d="M218 34c-45 0-82 37-82 82v6c0 45 37 82 82 82h-14c-45 0-38-37-38-82v-6c0-45-7-82 38-82z"
        fill="#43455a"
      />

      {/* Eyes */}
      <circle cx="206" cy="119" r="33" fill="#71dcef" />
      <path d="M206 86a33 33 0 0 0 0 66 33 33 0 0 1 0-66z" fill="#5ccbe0" />
      <circle cx="310" cy="119" r="33" fill="#71dcef" />
      <path d="M310 86a33 33 0 0 0 0 66 33 33 0 0 1 0-66z" fill="#5ccbe0" />

      {/* Body */}
      <path
        d="M256 262c-72 0-131 47-131 116 0 69 59 116 131 116s131-47 131-116c0-69-59-116-131-116z"
        fill="#e6e7e8"
      />
      <path
        d="M196 262c-42 15-71 56-71 116 0 60 29 101 71 116-24-25-38-68-38-116s14-91 38-116z"
        fill="#d3d5d7"
      />

      {/* Shoulder band */}
      <path d="M256 262c-58 0-108 30-125 74h250c-17-44-67-74-125-74z" fill="#aeb6bf" />
      <path d="M196 262c-31 11-56 39-65 74h34c8-35 15-63 31-74z" fill="#98a1ab" />

      {/* Chest marker */}
      <path d="M212 328h88l-44 56z" fill="#fbb540" />
      <path d="M256 384l44-56h-26z" fill="#f09819" />
    </svg>
  )
}
