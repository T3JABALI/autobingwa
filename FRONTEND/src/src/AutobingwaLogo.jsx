
import React from 'react';

export default function AutobingwaLogo({
  showWordmark = true,
  size = 240,
  className = '',
}) {
  return (
    <svg
      className={className}
      width={size}
      viewBox={showWordmark ? '0 0 360 270' : '0 0 200 190'}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Autobingwa logo"
      style={{ display: 'block', height: 'auto' }}
    >
      <defs>
        <linearGradient
          id="autobingwa-mint"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="45%" stopColor="#F5FFFC" />
          <stop offset="75%" stopColor="#B9F5E8" />
          <stop offset="100%" stopColor="#70DCCB" />
        </linearGradient>

        <linearGradient
          id="autobingwa-shade"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#72DCCB" />
        </linearGradient>

        <filter
          id="autobingwa-shadow"
          x="-30%"
          y="-30%"
          width="160%"
          height="170%"
        >
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="3"
            floodColor="#003F3B"
            floodOpacity="0.3"
          />
        </filter>
      </defs>

      <g
        transform={showWordmark ? 'translate(80 8) scale(1.0)' : 'translate(0 0)'}
        filter="url(#autobingwa-shadow)"
      >
        {/* Rear ribbon of the interlocking A */}
        <path
          d="M 105 137
             L 142 68
             Q 149 55 158 70
             L 205 153
             Q 214 170 198 179
             Q 187 186 175 177
             L 151 160"
          fill="none"
          stroke="#83E5D5"
          strokeWidth="20"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Main rounded triangular ribbon */}
        <path
          d="M 72 151
             L 115 53
             Q 128 25 146 53
             L 184 119
             Q 198 143 175 156
             L 93 184
             Q 69 191 65 170
             Q 63 160 72 151 Z"
          fill="none"
          stroke="url(#autobingwa-mint)"
          strokeWidth="19"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Inner overlap highlight */}
        <path
          d="M 143 59 L 177 119
             Q 183 130 173 137
             L 151 151"
          fill="none"
          stroke="url(#autobingwa-shade)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {showWordmark && (
        <text
          x="180"
          y="238"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="31"
          fontWeight="800"
          letterSpacing="7"
        >
          AUTOBINGWA
        </text>
      )}
    </svg>
  );
}
