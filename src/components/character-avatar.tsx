'use client';

import React, { useState } from 'react';

interface CharacterAvatarProps {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  accentColor?: string | null;
}

/**
 * Monochrome engraved monogram fallback.
 * A dark plate with a serif initial and a single hairline ring.
 * `accentColor` is honoured only as a low-opacity tint on the
 * ring and initial — never as a saturated fill or gradient.
 */
export function CharacterAvatar({
  name,
  avatarUrl,
  className = 'w-full h-full',
  accentColor,
}: CharacterAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const initial = (name || 'C').trim().charAt(0).toUpperCase();

  // The only colour on this plate: the author's accent folded
  // into the metadata ink at low opacity. Falls back to plain ink-2.
  const tint = accentColor
    ? `color-mix(in oklab, ${accentColor} 30%, var(--ink-3))`
    : 'var(--ink-2)';

  // If valid image provided and not errored, render it
  if (avatarUrl && !imgError && !avatarUrl.includes('images.unsplash.com/photo-1534528741775')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        width={96}
        height={96}
        loading="lazy"
        onError={() => setImgError(true)}
        className={`object-cover object-center ${className}`}
        style={{ aspectRatio: '1 / 1' }}
      />
    );
  }

  // Otherwise render the engraved monogram plate
  return (
    <div
      className={`bg-sunken relative flex items-center justify-center overflow-hidden select-none ${className}`}
      role="img"
      aria-label={name}
    >
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Concentric hairline ring */}
        <circle cx="50" cy="50" r="40" stroke="var(--line)" strokeWidth="1" />
        <circle cx="50" cy="50" r="32" stroke={tint} strokeOpacity="0.45" strokeWidth="1" />

        {/* Serif initial */}
        <text
          x="50"
          y="61"
          textAnchor="middle"
          fill={tint}
          fontSize="32"
          fontWeight="500"
          letterSpacing="-0.01em"
          style={{ fontFamily: 'var(--font-newsreader), serif' }}
        >
          {initial}
        </text>
      </svg>
    </div>
  );
}
