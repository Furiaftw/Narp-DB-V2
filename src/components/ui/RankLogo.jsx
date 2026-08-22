import React from 'react';
import { getNetlifyImageUrl, getNetlifyImageSrcSet } from '../../utils/helpers';

/* ---------------------------------------------------------------------------
   UNIVERSAL RANK PROFILE LOGO
   Knows the post-migration tiers (reviewer/grader) and still renders the
   legacy 'staff'/'oc_staff' strings that historical rows carry.
   --------------------------------------------------------------------------- */
export function RankLogo({ role, className = "w-10 h-10 rounded-lg" }) {
  // Legacy DB values from before the grader/reviewer migration still render.
  const mapped = role === 'staff' ? 'reviewer' : role === 'oc_staff' ? 'grader' : role;
  const cleanRole = ['owner', 'admin', 'reviewer', 'grader', 'user'].includes(mapped) ? mapped : 'user';

  const config = {
    owner: {
      gradient: "from-amber-400 to-amber-600 text-amber-50 shadow-amber-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Elegant Crown */}
          <path d="M5 16h14a1 1 0 0 0 1-1V7.5a.5.5 0 0 0-.85-.35L15 11l-3-4.5L9 11 4.85 7.15a.5.5 0 0 0-.85.35V15a1 1 0 0 0 1 1zM12 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 6.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm16 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z" />
        </svg>
      )
    },
    admin: {
      gradient: "from-indigo-400 to-indigo-600 text-indigo-50 shadow-indigo-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Sleek Shield */}
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 4.2v15.3c5.5-3.1 6.5-7.3 6.5-8.5V6.3l-6.5-2.1z" opacity="0.15" />
        </svg>
      )
    },
    reviewer: {
      gradient: "from-emerald-400 to-emerald-600 text-emerald-50 shadow-emerald-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Star Badge */}
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      )
    },
    grader: {
      gradient: "from-teal-400 to-teal-600 text-teal-50 shadow-teal-500/20",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* Quill Check */}
          <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
      )
    },
    user: {
      gradient: "from-slate-400 to-slate-600 text-slate-50 shadow-slate-500/10",
      svg: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          {/* User Silhouette */}
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      )
    }
  };

  const current = config[cleanRole];

  return (
    <div className={`bg-gradient-to-tr ${current.gradient} flex items-center justify-center shadow ${className} shrink-0`}>
      {current.svg}
    </div>
  );
}

export default RankLogo;
