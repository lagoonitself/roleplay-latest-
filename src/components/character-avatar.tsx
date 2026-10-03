'use client';

import React, { useState } from 'react';

interface CharacterAvatarProps {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  accentColor?: string | null;
}

/**
 * Procedural minimalist color palette for avatar gradients
 */
const PALETTES = [
  { from: '#3b82f6', to: '#1d4ed8', glyph: '#93c5fd' }, // Blue
  { from: '#8b5cf6', to: '#6d28d9', glyph: '#c4b5fd' }, // Violet
  { from: '#ec4899', to: '#be185d', glyph: '#fbcfe8' }, // Rose
  { from: '#f59e0b', to: '#b45309', glyph: '#fde68a' }, // Amber
  { from: '#10b981', to: '#047857', glyph: '#a7f3d0' }, // Emerald
  { from: '#6366f1', to: '#4338ca', glyph: '#c7d2fe' }, // Indigo
  { from: '#14b8a6', to: '#0f766e', glyph: '#99f6e4' }, // Teal
];

function getPalette(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PALETTES.length;
  return PALETTES[index];
}

export function CharacterAvatar({
  name,
  avatarUrl,
  className = 'w-full h-full',
  accentColor,
}: CharacterAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const palette = getPalette(name || 'Character');
  const initial = (name || 'C').trim().charAt(0).toUpperCase();

  // If valid image provided and not errored, render it
  if (avatarUrl && !imgError && !avatarUrl.includes('images.unsplash.com/photo-1534528741775')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        onError={() => setImgError(true)}
        className={`object-cover object-center ${className}`}
      />
    );
  }

  // Otherwise render a sleek, minimalist SVG avatar with monogram & ambient glow
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden select-none ${className}`}
      style={{
        background: `radial-gradient(120% 120% at 30% 20%, #27272a 0%, #18181b 60%, #09090b 100%)`,
      }}
    >
      {/* Subtle ambient lighting arc */}
      <div
        className="absolute -top-1/4 -right-1/4 w-3/4 h-3/4 rounded-full opacity-30 blur-xl pointer-events-none"
        style={{
          background: accentColor || palette.from,
        }}
      />

      <svg
        viewBox="0 0 100 100"
        className="w-full h-full p-2"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={`grad-${initial}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accentColor || palette.glyph} stopOpacity="0.9" />
            <stop offset="100%" stopColor={palette.from} stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Minimal geometric background halo */}
        <circle cx="50" cy="50" r="38" stroke="white" strokeOpacity="0.08" strokeWidth="1.5" />
        <circle
          cx="50"
          cy="50"
          r="30"
          stroke={`url(#grad-${initial})`}
          strokeOpacity="0.25"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {/* Sleek initial monogram */}
        <text
          x="50"
          y="58"
          textAnchor="middle"
          fill={`url(#grad-${initial})`}
          fontSize="30"
          fontWeight="600"
          letterSpacing="-0.03em"
          style={{ fontFamily: 'var(--font-geist-sans), sans-serif' }}
        >
          {initial}
        </text>
      </svg>
    </div>
  );
}
