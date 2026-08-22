import { Icon } from '../ui/Icon';

/* ============================================================================
   ROUTE GATE PANELS
   A gated route renders one of these rather than redirecting, so a link
   shared between staff explains itself instead of silently bouncing someone
   back to the catalog.
   ============================================================================ */

// Gate panels: a shared link should explain itself rather than silently
// bouncing someone to the catalog.
export function NoAccess({ what }) {
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center">
      <Icon n="Lock" size={28} className="text-slate-300 mx-auto mb-3" />
      <p className="text-sm font-semibold text-slate-600">{what}</p>
      <p className="text-xs text-slate-400 mt-1">Ask an admin if you think you should have access.</p>
    </div>
  );
}

export function SignedOutNotice({ what }) {
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 text-center">
      <Icon n="User" size={28} className="text-slate-300 mx-auto mb-3" />
      <p className="text-sm font-semibold text-slate-600">Sign in with Discord to see {what}.</p>
    </div>
  );
}
