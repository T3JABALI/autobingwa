
import React from 'react';

export default function AutobingwaLogo({
  showWordmark = true,
  size = 240,
}) {
  return (
    <svg
      width={size}
      viewBox="0 0 360 270"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Autobingwa logo"
      style={{ display: 'block', height: 'auto' }}
    >
      <defs>
        <linearGradient id="mint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#E9FFF9" />
          <stop offset="100%" stopColor="#70DCCB" />
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="3"
            floodColor="#001F1D"
            floodOpacity="0.35"
          />
        </filter>
      </defs>

      <g
        transform="translate(55 5)"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#shadow)"
      >
        <path
          d="M65 151 L111 51 Q124 24 141 53 L187 132"
          stroke="#7CE2D1"
          strokeWidth="20"
        />
        <path
          d="M111 51 L141 53 L187 132 Q198 151 179 160 L91 187 Q68 193 65 174 Q63 163 75 151"
          stroke="url(#mint)"
          strokeWidth="19"
        />
        <path
          d="M141 53 L173 110 Q184 129 169 139 L145 151"
          stroke="url(#mint)"
          strokeWidth="11"
        />
      </g>

      {showWordmark && (
        <text
          x="180"
          y="238"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="27"
          fontWeight="700"
          letterSpacing="6"
        >
          AUTOBINGWA
        </text>
      )}
    </svg>
  );
}
