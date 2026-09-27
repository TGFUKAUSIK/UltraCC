import React from 'react';

interface UltraCCLogoProps {
  size?: number;
  className?: string;
  title?: string;
}

/** Native, theme-aware UltraCC mark: a focused U/orbit symbol for the student OS. */
export const UltraCCLogo: React.FC<UltraCCLogoProps> = ({ size = 40, className = '', title = 'UltraCC' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    role="img"
    aria-label={title}
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="1" y="1" width="46" height="46" rx="15" fill="var(--acc-600)" />
    <path d="M14 14V26.5C14 33.4 18.5 37 24 37C29.5 37 34 33.4 34 26.5V14" stroke="white" strokeWidth="4" strokeLinecap="round" />
    <path d="M18 14V26C18 29.7 20.2 31.5 24 31.5C27.8 31.5 30 29.7 30 26V14" stroke="var(--acc-400)" strokeWidth="1.8" strokeLinecap="round" opacity=".95" />
    <circle cx="35.5" cy="12.5" r="2.5" fill="white" />
    <circle cx="39.5" cy="8.5" r="1.25" fill="var(--acc-400)" />
    <path d="M35.5 8.5V12.5M33.5 10.5H37.5" stroke="white" strokeWidth="1.1" strokeLinecap="round" opacity=".8" />
  </svg>
);
