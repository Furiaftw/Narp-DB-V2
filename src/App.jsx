import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { DiscordSDK } from '@discord/embedded-app-sdk';

import {
  supabase,
  isSupabaseConfigured,
  upsertJutsu,
  deleteJutsu,
  upsertBloodline,
  deleteBloodline,
  signInWithDiscord,
  signInWithDevAccess,
  signOut,
  getCurrentSession,
  onAuthChange,
  fetchMyProfile,
  updateMyUsername,
  fetchAllProfiles,
  setUserRole,
  grantWandererTicket,
  removeMember,
  banMember,
  unbanMember,
  fetchPendingJutsus,
  submitPendingJutsu,
  reviewPendingJutsu,
  updatePendingJutsuData,
  subscribeToDatabaseChanges,
  approvePendingJutsu,
  cancelPendingJutsu,
  buildJutsuPayload,
  fromRowJutsu,
  logWorkAction,
  fetchReviewChats,
  claimPendingSubmission,
  fetchWebhookConfig,
  saveWebhookConfig,
  fetchSubmissionControls,
  fetchChatOverview,
  fetchMyParticipatingChatIds,
  savePushSubscription,
  deletePushSubscription,
  saveJutsuReviewHistory,
  fetchCharacterSheetByName,
} from './lib/supabase';
import { isNotifEnabled, setNotifEnabled, requestNotifPermission, getNotifPermission, showChatNotification, subscribeToPush, unsubscribeFromPush } from './lib/notifications';
import {
  LS,
  toArray,
  copyText,
  getSlotStatus,
  getSortKey,
} from './utils/helpers';
import { Icon } from './components/ui/Icon';

import SlotsEditor from './components/ui/SlotsEditor';
import { JutsuCard, JutsuDocRankPicker } from './components/features/JutsuCard';
import SessionListCart from './components/features/SessionListCart';
import { FilterBar, FilterBarPanel } from './components/features/FilterBar';
import AddSubmissionMenu from './components/features/AddSubmissionMenu';
import SlotsViewModal from './components/modals/SlotsViewModal';
import MembersPage from './pages/MembersPage';
import UserMenu from './components/layout/UserMenu';
import { NoAccess, SignedOutNotice } from './components/layout/RouteGates';
import { loadDB } from './utils/loadDb';
import {
  STORAGE,
  SHUTDOWN_AT,
  RANK_COST_NUM,
  MANAGE_TABLES,
} from './constants/catalog';
import { normalizeSheet as normalizeCharacterSheet, sheetHasContent as characterSheetHasContent } from './constants/characterSheet';
const RosterPage = lazy(() => import('./pages/RosterPage'));
// Lazy: this page owns the recharts bundle, and it only renders on /bloodlines.
const BloodlinesRosterTab = lazy(() => import('./pages/BloodlinesPage'));
const JutsuStatsModal = lazy(() => import('./components/modals/JutsuStatsModal'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const GradingPage = lazy(() => import('./pages/GradingPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const CatalogManagementModal = lazy(() => import('./components/modals/CatalogManagement'));
const SystemToolsModal = lazy(() => import('./components/modals/SystemTools'));
const AdminFormModal = lazy(() => import('./components/modals/AdminForm'));
const OCSubmissionModal = lazy(() => import('./components/modals/OCSubmissionModal'));
const StatelessSubmissionModal = lazy(() => import('./components/modals/StatelessSubmission'));
import { JOIN_PREFIX } from './components/features/ReviewChat';
import JutsuSheetModal from './components/features/JutsuSheetModal';
import JutsuHistoryModal from './components/features/JutsuHistoryModal';
import CharacterSheetModal from './components/features/CharacterSheetModal';
import { normalizeJutsuSheet } from './constants/jutsuSheet';

/* ============================================================================
   SARP DATABASE — Clean Unified Build
   ============================================================================ */

const INITIAL_FILTER_STATE = {
  q: '',
  nat: [], rnk: [], typ: [], spc: [], org: [], bl: [], bm: [], jty: [],
  lck: false, lim: false, mul: false,
  hLck: false, hLim: false, hMul: false, hMP: false, hAsk: false,
  showFilters: false,
  sort: 'az',
};

const ARRAY_FILTER_KEYS = ['nat', 'rnk', 'typ', 'spc', 'org', 'bl', 'bm', 'jty'];
const BOOL_FILTER_KEYS  = ['lck', 'lim', 'mul', 'hLck', 'hLim', 'hMul', 'hMP', 'hAsk'];

const getPendingAssignedId = (p) => {
  if (!p?.assigned_to) return null;
  return typeof p.assigned_to === 'object' ? p.assigned_to.id : p.assigned_to;
};

/*
 * Whose turn is it in a review chat, from the viewer's perspective.
 * Submitters: any message not from them means the reviewer spoke last → your turn.
 * Reviewers: turn is role-based (did the player speak last?), so one reviewer's
 * reply also clears the "awaiting you" flag for the rest of the team.
 */
const getChatTurn = (lastMsg, myId, iAmSubmitter) => {
  if (!lastMsg) return null;
  if (iAmSubmitter) return lastMsg.sender_id === myId ? 'them' : 'you';
  return ['reviewer', 'admin', 'owner'].includes(lastMsg.profiles?.role) ? 'them' : 'you';
};

/* ---------------------------------------------------------------------------
   ROUTE HELPERS
   --------------------------------------------------------------------------- */

// HistoryPage takes the sub-view as a prop; useParams keeps that out of App.
function HistoryRoute({ profile, role }) {
  const { view } = useParams();
  if (view !== 'work-log' && view !== 'audit-log') {
    return <Navigate to="/history/work-log" replace />;
  }
  return <HistoryPage view={view} profile={profile} role={role} />;
}

export default function App() {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  const [visibleCount, setVisibleCount] = useState(200);

  const [db, setDb]           = useState({ jutsus: [], bloodlines: [], specializations: [], jutsuTypeTags: [] });
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState(null);
  const [webhookConfig, setWebhookConfig] = useState({});
  const [devRole, setDevRole] = useState(() => LS.get(STORAGE.ROLE, 'user'));
  const [viewAsRole, setViewAsRole] = useState(null);
  const [submissionControls, setSubmissionControls] = useState({ jutsu_paused: false, custom_item_paused: false, summon_paused: false, character_paused: false, discord_notifications_paused: false });
  const supabaseReady = isSupabaseConfigured();

  // Legacy role strings from a session cached before the grader/reviewer
  // migration normalize to the new names; the DB migration renames the rest.
  const rawRole = supabaseReady ? (viewAsRole || profile?.role || 'guest') : devRole;
  const role    = rawRole === 'staff' ? 'reviewer' : rawRole === 'oc_staff' ? 'grader' : rawRole;
  const isReviewer = role === 'reviewer' || role === 'admin' || role === 'owner';
  const isAdmin = role === 'admin' || role === 'owner';
  const isOwner = role === 'owner';
  // 'grader' is the narrower tier: it can claim/review/approve OC (Character)
  // submissions and grade RPs (Gate 1) — everything else in the app treats
  // them like a plain 'user'.
  const isGrader = role === 'grader';

  const [pendingJutsus, setPendingJutsus] = useState([]);
  const pendingJutsusRef = useRef([]);
  const [myOwnSubmissions, setMyOwnSubmissions] = useState([]);
  const myOwnSubmissionsRef = useRef([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [approvingIds, setApprovingIds] = useState(new Set());
  // Inbox tab (merged Messages + Pending + My Submissions): one "new item"
  // dot and one "selected item" state shared across every audience/view.
  const [inboxHasNew, setInboxHasNew] = useState(false);
  const prevPendingCountRef = useRef(0);
  const tabRef = useRef('jutsus');
  const [selectedInboxId, setSelectedInboxId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [chatThreads, setChatThreads] = useState([]);
  const [chatReadMap, setChatReadMap] = useState(() => LS.get(STORAGE.CHAT_READ, {}));
  const [myParticipatingIds, setMyParticipatingIds] = useState(() => new Set());

  const markChatRead = useCallback((pendingId) => {
    if (!pendingId) return;
    setChatReadMap(prev => {
      const prevTs = prev[pendingId] ? new Date(prev[pendingId]).getTime() : 0;
      // Skip no-op updates (called on every chat render) to avoid churn
      if (Date.now() - prevTs < 1000) return prev;
      const next = { ...prev, [pendingId]: new Date().toISOString() };
      LS.set(STORAGE.CHAT_READ, next);
      return next;
    });
  }, []);
  const [appNotifEnabled, setAppNotifEnabled] = useState(() => isNotifEnabled());
  const [appNotifPermission, setAppNotifPermission] = useState(() => getNotifPermission());
  const [appNotifDenied, setAppNotifDenied] = useState(false);

  // Once signed in, make sure this device actually has a push subscription saved.
  // Backfills users who toggled notifications on before VAPID keys existed and
  // refreshes endpoints that the browser may have rotated — no re-toggle needed.
  useEffect(() => {
    if (!profile?.id) return;
    if (!isNotifEnabled()) return;
    if (getNotifPermission() !== 'granted') return;
    (async () => {
      try {
        const pushSub = await subscribeToPush();
        if (pushSub) await savePushSubscription(pushSub);
      } catch (e) {
        console.warn('[NARP] Auto-resubscribe to push failed:', e);
      }
    })();
  }, [profile?.id]);

  const [profilesList, setProfilesList] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  // Navigation is the URL. `tab` is derived, kept as a short name because the
  // catalog's filter/expand logic reads it in a dozen places: 'jutsus' and
  // 'bloodlines' are the two catalog views, everything else is its own page.
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const tab = pathname === '/bloodlines' ? 'bloodlines'
            : pathname === '/'           ? 'jutsus'
            : pathname.split('/')[1] || 'jutsus';
  const isCatalog = tab === 'jutsus' || tab === 'bloodlines' || tab === 'inbox';
  // Roster and History (work log) paint their own full-bleed layouts, so the
  // shell must not add its page padding on top of them.
  const selfLaidOut = pathname === '/roster'
    || (pathname.startsWith('/history') && pathname !== '/history/audit-log');

  const loadProfiles = useCallback(async () => {
    if (!supabaseReady || !isAdmin) return;
    setProfilesLoading(true);
    try {
      const list = await fetchAllProfiles();
      setProfilesList(list);
    } catch (err) {
      console.error('[NARP] Failed to fetch profiles:', err);
      alert('Error loading members: ' + (err.message || err));
    } finally {
      setProfilesLoading(false);
    }
  }, [supabaseReady, isAdmin]);

  const handleRoleChange = async (userId, newRole) => {
    if (!window.confirm(`Are you sure you want to change this member's role to ${newRole}?`)) {
      return;
    }
    try {
      await setUserRole(userId, newRole);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to update user role:', err);
      alert('Failed to update role: ' + (err.message || err));
    }
  };

  const handleGrantWandererTicket = async (userId, username) => {
    if (!window.confirm(`Grant a one-time Wanderer OC ticket to ${username || 'this member'}?`)) return;
    try {
      await grantWandererTicket(userId);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to grant Wanderer ticket:', err);
      alert('Failed to grant ticket: ' + (err.message || err));
    }
  };

  const handleRemoveMember = async (userId, username) => {
    if (!window.confirm(`Permanently remove ${username || 'this member'}? This deletes their login account and profile. This cannot be undone.`)) return;
    try {
      await removeMember(userId);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to remove member:', err);
      alert('Failed to remove member: ' + (err.message || err));
    }
  };

  const handleBanMember = async (userId, username) => {
    if (!window.confirm(`Ban ${username || 'this member'}? They will be unable to sign in until unbanned.`)) return;
    try {
      await banMember(userId);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to ban member:', err);
      alert('Failed to ban member: ' + (err.message || err));
    }
  };

  const handleUnbanMember = async (userId, username) => {
    try {
      await unbanMember(userId);
      await loadProfiles();
    } catch (err) {
      console.error('[NARP] Failed to unban member:', err);
      alert('Failed to unban member: ' + (err.message || err));
    }
  };

  useEffect(() => {
    if (tab === 'members') {
      loadProfiles();
    }
  }, [tab, loadProfiles, refreshTrigger]);

  const [viewMode, setViewMode] = useState(() => LS.get(STORAGE.VIEW_MODE, 'card'));
  const [expRow, setExpRow]     = useState(null);
  const [cart, setCart]         = useState(() => LS.get(STORAGE.CART, []));
  const [pTags, setPTags]       = useState(() => LS.get(STORAGE.TAGS, {}));
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem(STORAGE.SHUTDOWN_BANNER) === '1'; } catch { return false; }
  });
  const dismissShutdownBanner = () => {
    try { sessionStorage.setItem(STORAGE.SHUTDOWN_BANNER, '1'); } catch {}
    setBannerDismissed(true);
  };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const msUntilShutdown = Math.max(0, SHUTDOWN_AT - now);
  const shutdownCountdown = {
    days:  Math.floor(msUntilShutdown / 86400000),
    hours: Math.floor((msUntilShutdown % 86400000) / 3600000),
    mins:  Math.floor((msUntilShutdown % 3600000) / 60000),
    secs:  Math.floor((msUntilShutdown % 60000) / 1000),
  };

  const [f, setF] = useState(INITIAL_FILTER_STATE);
  const [bF, setBF] = useState({ q: '', cat: [], sub: [], srt: 'az' });
  const clearF = useCallback(() => setF(p => {
    const next = { ...p };
    ARRAY_FILTER_KEYS.forEach(k => next[k] = []);
    BOOL_FILTER_KEYS.forEach(k  => next[k] = false);
    next.q = '';
    return next;
  }), []);

  useEffect(() => {
    setVisibleCount(200);
  }, [f, tab]);

  useEffect(() => {
    if (!headerRef.current) return;
    const updateHeight = () => {
      setHeaderHeight(headerRef.current.offsetHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [loading]);

  const [modals, setModals]         = useState({ credits: false, copiedId: null, system: false, manageBL: false, iosInstall: false, stats: false });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [appInstalled, setAppInstalled]   = useState(() => window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setInstallPrompt(null); setAppInstalled(true); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const [statelessType, setStatelessType] = useState(null);
  const [ocEdit, setOcEdit] = useState(null);
  const [adminForm, setAdminForm]   = useState(null);
  const [slotsView, setSlotsView]   = useState(null);
  const [sheetView, setSheetView]   = useState(null);
  const [sheetViewRank, setSheetViewRank] = useState(null);
  const [historyView, setHistoryView] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [askSecondApprovalDelete, setAskSecondApprovalDelete] = useState(false);
  useEffect(() => { LS.set(STORAGE.VIEW_MODE, viewMode); }, [viewMode]);
  useEffect(() => { LS.set(STORAGE.ROLE, devRole); }, [devRole]);
  useEffect(() => { LS.set(STORAGE.CART, cart); }, [cart]);

  useEffect(() => {
    async function initializeDiscordActivity() {
      if (window.parent !== window) {
        const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
        // Add a 3-second timeout safeguard to prevent hanging inside generic iframe previews/environments
        const readyPromise = discordSdk.ready();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Discord activity SDK ready timeout')), 3000)
        );
        await Promise.race([readyPromise, timeoutPromise]);

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ["identify", "guilds", "email", "guilds.members.read"],
        });

        const response = await fetch('/.netlify/functions/discord-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Discord activity login backend call failed: ${errText}`);
        }

        const data = await response.json();
        if (data.email && data.password && supabase) {
          await supabase.auth.signInWithPassword({
            email: data.email,
            password: data.password,
          });
        }
      }
    }

    initializeDiscordActivity().catch(err => {
      console.error("Discord activity SDK login failed:", err);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDB()
      .then(d => {
        if (!cancelled) {
          setDb(d);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('[NARP] loadDB failed with error:', err);
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (!loading) LS.set(STORAGE.CACHE, { ...db, ts: Date.now() }); }, [db, loading]);

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;

    const refreshProfile = async () => {
      try {
        const session = await getCurrentSession();
        if (cancelled) return;
        if (!session) { setProfile(null); return; }
        let p = await fetchMyProfile();
        if (!p) {
          if (!cancelled) setProfile(null);
          return;
        }

        // Automatically assign unique Discord username if profile doesn't have one
        if (!p.username) {
          const meta = session.user?.user_metadata || {};
          const discordUser = meta.preferred_username || meta.user_name || meta.name || '';
          if (discordUser) {
            try {
              p = await updateMyUsername(discordUser);
            } catch (updateErr) {
              console.warn('[NARP] failed to auto-update username:', updateErr);
            }
          }
        }

        if (!cancelled) {
          setProfile(p);
          if (p.role === 'owner' || p.role === 'admin') {
            fetchWebhookConfig().then(setWebhookConfig).catch(() => {});
          }
          fetchSubmissionControls().then(setSubmissionControls).catch(() => {});
        }
      } catch (e) {
        console.warn('[NARP] profile fetch failed:', e);
        if (!cancelled) setProfile(null);
      }
    };

    refreshProfile();
    const unsub = onAuthChange(() => { refreshProfile(); });
    return () => { cancelled = true; unsub(); };
  }, [supabaseReady]);

  const handleSignIn    = async () => { try { await signInWithDiscord(); } catch (e) { alert('Sign-in failed: ' + e.message); } };
  const handleDevSignIn = async () => { await signInWithDevAccess(); };
  const handleSignOut = async () => { try { await signOut(); setProfile(null); setViewAsRole(null); } catch (e) { console.warn('[NARP] sign-out failed:', e); } };

  const refreshPending = useCallback(async () => {
    if (!supabaseReady || (!isReviewer && !profile?.id)) { setPendingJutsus([]); setMyOwnSubmissions([]); setPendingLoaded(false); return; }
    try {
      const list = await fetchPendingJutsus();

      // Own submissions always tracked separately so staff can see them in My Submissions
      const own = list.filter(p => p.submitted_by === profile?.id)
        .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
      setMyOwnSubmissions(own);

      // Staff see all submissions EXCEPT their own in the Pending review tab.
      // OC Staff see the same, narrowed to Character (OC) entries only.
      const filtered = isReviewer
        ? list.filter(p => p.submitted_by !== profile?.id)
        : isGrader
          ? list.filter(p => p.submitted_by !== profile?.id && p.data?.type === 'Character')
          : [];
      
      const sorted = [...filtered].sort((a, b) => {
        const getPriorityWeight = (p) => {
          // Priority 1: status === 'pending_approval' ('Needs 2nd Approval')
          if (p.status === 'pending_approval') {
            return 1;
          }
          
          const isClaimed = p.assigned_to !== null && p.assigned_to !== undefined && 
            (typeof p.assigned_to === 'object' ? p.assigned_to.id !== null : p.assigned_to !== '');
            
          // Priority 2: Unclaimed (status === 'pending_review' ('Awaiting Reviewer'))
          if (p.status === 'pending_review' && !isClaimed) {
            return 2;
          }
          
          const assignedId = typeof p.assigned_to === 'object' ? p.assigned_to?.id : p.assigned_to;
          
          // Priority 3: Claimed by the current reviewer
          if (assignedId === profile?.id) {
            return 3;
          }
          
          // Priority 4: Claimed by other reviewers or other states
          return 4;
        };

        const wA = getPriorityWeight(a);
        const wB = getPriorityWeight(b);
        
        if (wA !== wB) {
          return wA - wB;
        }

        // Sub-sort by submitted_at ascending (oldest first).
        const timeA = new Date(a.submitted_at || 0).getTime();
        const timeB = new Date(b.submitted_at || 0).getTime();
        return timeA - timeB;
      });

      setPendingJutsus(sorted);
      setPendingLoaded(true);
      setRefreshTrigger(prev => prev + 1);
    } catch (e) {
      console.warn('[NARP] fetchPendingJutsus failed:', e);
    }
  }, [supabaseReady, isReviewer, isGrader, profile?.id]);

  useEffect(() => { refreshPending(); }, [refreshPending]);

  useEffect(() => {
    if (!supabaseReady || !profile?.id) return;
    fetchChatOverview().then(setChatThreads).catch(() => {});
    if (isReviewer || isGrader) fetchMyParticipatingChatIds(profile.id).then(setMyParticipatingIds).catch(() => {});
  }, [supabaseReady, isReviewer, isGrader, profile?.id]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshDB = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await loadDB();
      setDb(fresh);
      await refreshPending();
    } catch (e) {
      console.warn('[NARP] refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPending]);

  useEffect(() => { tabRef.current = tab; }, [tab]);
  // react-router does not restore scroll on navigation.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  // Entering the catalog starts from a clean slate, the way switching tabs
  // used to. Leaving it collapses any expanded row.
  useEffect(() => {
    setExpRow(null);
    if (isCatalog) {
      clearF();
      setF(p => ({ ...p, sort: 'az', showFilters: false }));
    }
    if (pathname === '/inbox') setInboxHasNew(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!supabaseReady || !profile) return;
    let channel = null;
    let pendingDebounce = null;
    let catalogDebounce = null;
    try {
      channel = subscribeToDatabaseChanges((payload) => {
        const table = payload?.table;
        const eventType = payload?.eventType;
        if (table === 'pending_jutsus') {
          if (eventType === 'UPDATE' && payload?.new?.id) {
            // Patch only the changed row — avoids a full round-trip on every status change
            setPendingJutsus(prev => prev.map(p =>
              p.id === payload.new.id ? { ...p, ...payload.new } : p
            ));
          } else {
            // INSERT or DELETE: need full refresh (INSERT needs joined profile data)
            clearTimeout(pendingDebounce);
            pendingDebounce = setTimeout(() => refreshPending(), 300);
          }
        } else if (table === 'jutsus' || table === 'bloodlines') {
          clearTimeout(catalogDebounce);
          catalogDebounce = setTimeout(() => refreshDB(), 500);
        }
        // pending_chats: keep the inbox overview fresh on any change (sends,
        // edits, deletes) and fire a browser notification for others' messages
        if (table === 'pending_chats') {
          fetchChatOverview().then(setChatThreads).catch(() => {});
          if (eventType === 'INSERT' && payload?.new?.sender_id !== profile?.id) {
            const submission =
              pendingJutsusRef.current.find(p => p.id === payload.new?.pending_id) ||
              myOwnSubmissionsRef.current.find(p => p.id === payload.new?.pending_id);
            const subName = submission?.data?.name || 'a submission';
            const rawMsg = payload.new?.message || '';
            showChatNotification({
              title: `New message — ${subName}`,
              body: rawMsg.startsWith(JOIN_PREFIX)
                ? `👋 ${rawMsg.replace(JOIN_PREFIX, '').trim()}`.slice(0, 80)
                : rawMsg.slice(0, 80),
              tag: `pending-${payload.new?.pending_id}`,
            });
            if (profile?.id) fetchMyParticipatingChatIds(profile.id).then(setMyParticipatingIds).catch(() => {});
          }
        }
        if (profile && tabRef.current !== 'inbox') setInboxHasNew(true);
      });
    } catch (err) {
      console.warn('[NARP] Failed to subscribe to database changes:', err);
    }
    return () => {
      clearTimeout(pendingDebounce);
      clearTimeout(catalogDebounce);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (err) {
          console.warn('[NARP] Failed to remove database subscription channel:', err);
        }
      }
    };
  }, [supabaseReady, profile, refreshDB, refreshPending, isReviewer]);

  // 30-second polling to catch submissions missed by realtime
  useEffect(() => {
    if (!supabaseReady || !profile) return;
    const interval = setInterval(() => {
      refreshPending();
    }, 30000);
    return () => clearInterval(interval);
  }, [supabaseReady, profile, refreshPending]);

  // Raise pending-tab badge when count grows while user is on another tab
  useEffect(() => {
    if (!pendingLoaded) return;
    if (prevPendingCountRef.current !== null && pendingJutsus.length > prevPendingCountRef.current && tabRef.current !== 'inbox') {
      setInboxHasNew(true);
    }
    prevPendingCountRef.current = pendingJutsus.length;
    pendingJutsusRef.current = pendingJutsus;
    myOwnSubmissionsRef.current = myOwnSubmissions;
  }, [pendingJutsus, pendingLoaded, myOwnSubmissions]);

  const submitChange = useCallback(async ({ tab: t, operation, targetId, entity, askSecondApproval }) => {
    const isJutsus = t === 'jutsus';

    if (adminForm?.isPendingEdit) {
      if (!supabaseReady) return true;
      const payload = entity ? buildJutsuPayload(entity, true) : null;
      await updatePendingJutsuData(adminForm.pendingId, payload);
      await refreshPending();
      return false;
    }

    const shouldGoToPending = isJutsus && (
      ((role === 'user' || role === 'reviewer') && !isAdmin) ||
      (isAdmin && askSecondApproval)
    );

    if (shouldGoToPending) {
      if (!supabaseReady) {
        applyChangeLocally(t, operation, targetId, entity);
        return true;
      }
      const payload = entity ? buildJutsuPayload(entity, operation === 'update') : null;
      const status = 'pending_review';
      await submitPendingJutsu(operation, targetId, payload, status);

      await refreshPending();
      return false;
    }

    if (isAdmin) {
      applyChangeLocally(t, operation, targetId, entity);
      if (supabaseReady) {
        try {
          if (operation === 'delete') {
            if (t === 'jutsus')          await deleteJutsu(targetId);
            else if (t === 'bloodlines') await deleteBloodline(targetId);
          } else {
            if (t === 'jutsus') {
              await upsertJutsu(entity);
            }
            else if (t === 'bloodlines') await upsertBloodline(entity);
          }
        } catch (e) {
          console.warn('[NARP] write failed:', e);
          alert('Save failed: ' + e.message);
        }
      }
      return true;
    }

    throw new Error('Permission denied');
  }, [isAdmin, isReviewer, role, adminForm, supabaseReady, refreshPending, profile]);

  const applyChangeLocally = (t, operation, targetId, entity) => {
    setDb(d => {
      const list = d[t] || [];
      let next;
      if (operation === 'delete')      next = list.filter(x => x._id !== targetId);
      else if (operation === 'update') next = list.map(x => x._id === targetId ? entity : x);
      else                             next = [entity, ...list];
      return { ...d, [t]: next };
    });
  };

  const handleApprovePending = async (id, itemOverride = null) => {
    if (approvingIds.has(id)) return;
    setApprovingIds(prev => new Set([...prev, id]));
    try {
      // Optimistic: remove immediately so the UI doesn't hang
      setPendingJutsus(prev => prev.filter(p => p.id !== id));
      // Log the approval to Discord before committing it. The submitter is the
      // staff member who queued the entry; the current user is the reviewer
      // (the "2nd pair of eyes" in the double-approver workflow). itemOverride
      // lets an admin's own just-submitted OC (never in pendingJutsus, which
      // excludes your own submissions) auto-approve through this same path.
      const item = itemOverride || pendingJutsus.find(p => p.id === id);
      if (item) {
        const isDelete = item.operation === 'delete';
        const rawDisplayData = isDelete
          ? ((db.jutsus || []).find(j => j._id === item.target_id) || { name: 'Unknown' })
          : item.data;
        // Preserve original submission timestamp so Discord log shows correct Creation Date
        const displayData = isDelete ? rawDisplayData : {
          ...rawDisplayData,
          _createdAt: rawDisplayData?._createdAt || item.submitted_at,
        };

        const isCharacter = item.data?.type === 'Character';

        // A character can't be approved until its OC sheet is filled in --
        // players/staff fill it from the pending item (PendingJutsuCard) while
        // it's still awaiting review, same idea as the "final step" gate below.
        if (isCharacter && !isDelete) {
          const characterName = (item.data?.name || '').trim();
          let sheetRow = null;
          try {
            sheetRow = characterName ? await fetchCharacterSheetByName(characterName) : null;
          } catch (sheetErr) {
            console.warn('[NARP] Character sheet lookup failed:', sheetErr);
          }
          const sheetOk = sheetRow && characterSheetHasContent(normalizeCharacterSheet(sheetRow.data));
          if (!sheetOk) {
            throw new Error(`${characterName || 'This character'} needs a completed character sheet before approval. Fill it in from the Inbox, then approve again.`);
          }
        }

        // Auto-insert the approved character into their bloodline's roster
        // slots (name + character-area link). A granted reservation held for
        // this entry is converted into the real slot. If the bloodline is
        // genuinely full, abort the approval so the reviewers can resolve it.
        if (isCharacter && item.data?.bloodline) {
          const slotSess = await getCurrentSession();
          const slotRes = await fetch('/.netlify/functions/manage-bloodline-slot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(slotSess?.access_token ? { Authorization: `Bearer ${slotSess.access_token}` } : {}),
            },
            body: JSON.stringify({
              action: 'fill',
              bloodline: item.data.bloodline,
              pendingId: id,
              name: item.data.name || 'OC',
              link: item.data.myCharactersLink || '',
            }),
          }).catch(() => null);
          if (!slotRes || !slotRes.ok) {
            const out = slotRes ? await slotRes.json().catch(() => ({})) : {};
            throw new Error(out.error || 'Could not add the character to its bloodline roster. Approval aborted.');
          }
        }

        // Automated roster insertion (squads / elite sections / council).
        // Must run while the pending row still exists; a failure here doesn't
        // block the approval — staff can add the entry manually.
        if (isCharacter) {
          try {
            const rosterSess = await getCurrentSession();
            const rosterRes = await fetch('/.netlify/functions/roster-auto-insert', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(rosterSess?.access_token ? { Authorization: `Bearer ${rosterSess.access_token}` } : {}),
              },
              body: JSON.stringify({ pendingId: id }),
            });
            const rosterOut = await rosterRes.json().catch(() => ({}));
            if (!rosterRes.ok) {
              alert('Heads up: the character was approved, but automatic roster insertion failed ('
                + (rosterOut.error || rosterRes.status) + '). Please add them to the roster manually.');
            } else if (rosterOut.warnings?.length) {
              alert('Roster note: ' + rosterOut.warnings.join(' '));
            }
          } catch (rosterErr) {
            console.warn('[NARP] Roster auto-insert failed:', rosterErr);
          }
        }

        // Chat transcript: no longer shipped to Discord as a .txt attachment —
        // it's saved straight to jutsu_review_history instead, attached to the
        // jutsu it belongs to. Reviewer+ only (matches who could see the
        // pending review chat in the first place).
        const isPlainJutsu = !isCharacter && item.data?.type !== 'Summon' && item.data?.type !== 'Custom Item';
        try {
          const chats = await fetchReviewChats(id);
          let chatTranscript = null;
          if (chats && chats.length > 0) {
            chatTranscript = chats.map(c => {
              const time = c.created_at ? new Date(c.created_at).toLocaleString() : 'N/A';
              const name = c.profiles?.site_nickname || c.profiles?.username || 'Unknown';
              if (c.is_deleted) return `[${time}] ${name}:\n[Message deleted by sender]`;
              const msgText = c.message || '';
              const editNote = c.is_edited && c.original_message
                ? `\n  [Edited — original: ${c.original_message}]`
                : c.is_edited ? '\n  [Edited]' : '';
              return `[${time}] ${name}:\n${msgText}${editNote}`;
            }).join('\n\n') + '\n\n';
          }
          if (isPlainJutsu && !isDelete && chatTranscript) {
            const jutsuId = item.operation === 'insert' ? item.data?._id : item.target_id;
            if (jutsuId) {
              try {
                await saveJutsuReviewHistory({
                  jutsuId,
                  itemName: displayData?.name || 'Unknown',
                  operation: item.operation,
                  transcript: chatTranscript,
                  submittedBy: item.submitted_by,
                  reviewedBy: profile?.id,
                });
              } catch (histErr) {
                console.warn('[NARP] Saving jutsu review history failed:', histErr);
              }
            }
          }
        } catch (chatErr) {
          console.warn('[NARP] Fetching review chats failed:', chatErr);
        }

        const approvalItemName = isCharacter
          ? (displayData?.name && displayData.name !== 'OC Submission' ? displayData.name : 'OC Submission')
          : (displayData?.name || 'Unknown');
        const sess = await getCurrentSession();
        const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};

        // Work log stats (the in-app Work Log page) — logged for every
        // approval regardless of Discord config.
        const firstReviewer = item.first_reviewer;
        const hasDifferentFirstReviewer = item.operation === 'insert' && firstReviewer?.id && firstReviewer.id !== profile?.id;
        if (item.operation === 'insert') {
          // "Second Reviewer" when a different person did first check; "Solo Approver" otherwise.
          const actionType = hasDifferentFirstReviewer ? 'Second Reviewer' : 'Solo Approver';
          logWorkAction(actionType).catch(err => console.warn('[NARP] Work log stat failed:', err));
        }
        if (hasDifferentFirstReviewer) {
          logWorkAction('First Reviewer', firstReviewer.id).catch(err => console.warn('[NARP] Work log stat failed:', err));
        }

        const isSummonOrItem = item.data?.type === 'Summon' || item.data?.type === 'Custom Item';

        // DM submitter — approved
        if (item?.submitter?.discord_id) {
          const approvedMsg = (isCharacter || isSummonOrItem)
            ? `🎉 Your submission **${approvalItemName}** has been **approved**!`
            : `🎉 Your submission **${approvalItemName}** has been **approved**! It's now live in the database.`;
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: approvedMsg,
            }),
          }).catch(err => console.warn('[NARP] Approval DM failed:', err));
        }
        if (isCharacter || isSummonOrItem) {
          await cancelPendingJutsu(id); // No DB table write — remove from pending only
        } else {
          await approvePendingJutsu(id); // Standard database merge RPC
        }
      }

      // Optimistic update already removed the card; let realtime subscription sync any
      // stragglers. Fire a background refresh so the list stays consistent without blocking.
      setTimeout(() => refreshPending(), 1500);
    } catch (e) {
      alert('Approve failed: ' + e.message);
      // The optimistic removal already hid the card — restore the real state.
      refreshPending();
    } finally {
      setApprovingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleDirectSummonItemUpload = useCallback(async () => {
    logWorkAction('Direct Upload').catch(err => console.warn('[NARP] Work log stat failed:', err));
  }, []);

  // Frees the bloodline slot held by a granted Réservation Request. Called
  // before an entry is denied/retracted so reserved slots never leak.
  const releaseReservedSlot = async (item) => {
    if (item?.data?.subType !== 'reservation_request') return;
    if (item.data?.reservationStatus !== 'granted' || !item.data?.bloodline) return;
    try {
      const sess = await getCurrentSession();
      await fetch('/.netlify/functions/manage-bloodline-slot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
        },
        body: JSON.stringify({ action: 'release', bloodline: item.data.bloodline, pendingId: item.id }),
      });
    } catch (err) {
      console.warn('[NARP] Failed to release reserved bloodline slot:', err);
    }
  };

  const handleCancelPending = async (id) => {
    try {
      // Optimistic: remove immediately so the UI doesn't hang
      setPendingJutsus(prev => prev.filter(p => p.id !== id));
      // Log the denial to Discord before removing the pending entry.
      const item = pendingJutsus.find(p => p.id === id);
      if (item) {
        await releaseReservedSlot(item);
        const isDelete = item.operation === 'delete';
        const displayData = isDelete
          ? ((db.jutsus || []).find(j => j._id === item.target_id) || { name: 'Unknown' })
          : item.data;

        // Detect whether this submission was ever claimed
        const wasEverClaimed = !!(item.assigned_to && (
          typeof item.assigned_to === 'object'
            ? item.assigned_to.id
            : (typeof item.assigned_to === 'string' && item.assigned_to.trim() !== '')
        ));

        let chats = [];
        try {
          chats = (await fetchReviewChats(id)) || [];
        } catch (chatErr) {
          console.warn('[NARP] Fetching review chats failed:', chatErr);
        }

        const denialItemName = displayData?.name || 'Unknown';
        const sess = await getCurrentSession();
        const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};

        if (item.operation === 'insert') {
          logWorkAction('Denied').catch(err => console.warn('[NARP] Work log stat failed:', err));
        }

        // DM submitter — only when there was real engagement (claimed or chat happened)
        const hasChatActivity = chats.length > 0;
        if ((wasEverClaimed || hasChatActivity) && item?.submitter?.discord_id) {
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: `❌ Your submission **${denialItemName}** has been **denied** by the review team. Please check the Review Chat for feedback.`,
            }),
          }).catch(err => console.warn('[NARP] Denial DM failed:', err));
        }
      }

      await cancelPendingJutsu(id);
      setTimeout(() => refreshPending(), 1500);
    } catch (e) {
      alert('Cancel failed: ' + e.message);
    }
  };

  const handleReviewPending = async (id) => {
    try {
      if (!profile?.id) return;

      const item = pendingJutsus.find(p => p.id === id);
      const op = item?.operation;
      const display = op === 'delete' ? ((db.jutsus || []).find(j => j._id === item?.target_id) || {}) : (item?.data || {});
      const itemName = display.name || 'Unknown Jutsu';

      // Optimistic: update status immediately so re-ordering happens at once
      setPendingJutsus(prev => prev.map(p =>
        p.id === id ? { ...p, status: 'pending_approval', first_reviewer_id: profile.id, first_reviewer: profile } : p
      ));

      await reviewPendingJutsu(id, profile.id);

      // DM submitter — their entry passed first check
      if (item?.submitter?.discord_id) {
        getCurrentSession().then(sess => {
          const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: `✅ Your submission **${itemName}** passed its first review check! It's now awaiting final approval from a second reviewer.`,
            }),
          }).catch(err => console.warn('[NARP] First check DM failed:', err));
        });
      }

      await refreshPending();
    } catch (e) {
      alert('Review failed: ' + e.message);
    }
  };

  const handleClaimPending = async (id) => {
    try {
      if (!profile?.id) return;
      // Optimistic: show as claimed immediately
      setPendingJutsus(prev => prev.map(p =>
        p.id === id ? { ...p, assigned_to: profile.id, assignee: profile } : p
      ));
      await claimPendingSubmission(id, profile.id);

      // DM the submitter to let them know their entry was claimed
      const item = pendingJutsus.find(p => p.id === id);
      if (item?.submitter?.discord_id) {
        const itemName = (item.data || {}).name || 'your submission';
        getCurrentSession().then(sess => {
          const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};
          fetch('/.netlify/functions/discord-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHdr },
            body: JSON.stringify({
              discordUserId: item.submitter.discord_id,
              message: `📋 **${profile.username || 'A reviewer'}** has claimed your submission **${itemName}** for review. You can now open the Review Chat to discuss it!`,
            }),
          }).catch(err => console.warn('[NARP] Claim DM failed:', err));
        });
      }

      await refreshPending();
    } catch (e) {
      alert('Claim failed: ' + e.message);
    }
  };

  const handleSubmitterCancelPending = async (id) => {
    try {
      const item = pendingJutsus.find(p => p.id === id) || myOwnSubmissions.find(p => p.id === id);
      await releaseReservedSlot(item);
      await cancelPendingJutsu(id);
      await refreshPending();
    } catch (e) {
      alert('Cancel failed: ' + e.message);
    }
  };

  const handleEditPending = (pendingItem) => {
    // OC submissions get their own form; everything else uses the jutsu form.
    if (pendingItem.data?.type === 'Character') {
      setOcEdit(pendingItem);
      return;
    }
    setAdminForm({
      r: fromRowJutsu(pendingItem.data),
      tab: 'jutsus',
      isPendingEdit: true,
      pendingId: pendingItem.id
    });
  };

  const setPersonalTagsForJutsu = useCallback((jid, list) => {
    setPTags(prev => {
      const next = { ...prev };
      if (!list || list.length === 0) delete next[jid];
      else next[jid] = list;
      LS.set(STORAGE.TAGS, next);
      return next;
    });
  }, []);

  const handleCopy = (j) => {
    copyText(j.link, () => {
      setModals(m => ({ ...m, copiedId: j._id }));
      setTimeout(() => setModals(m => ({ ...m, copiedId: null })), 1500);
    });
    setCart(prev => prev.some(i => i._id === j._id) ? prev : [...prev, j]);
  };

  const fCount = useMemo(() => {
    let n = 0;
    ARRAY_FILTER_KEYS.forEach(k => n += f[k].length);
    BOOL_FILTER_KEYS.forEach(k  => n += f[k] ? 1 : 0);
    return n;
  }, [f]);

  const sortByCommon = useCallback((a, b) => {
    if (f.sort === 'az')      return a.name.localeCompare(b.name);
    if (f.sort === 'za')      return b.name.localeCompare(a.name);
    if (f.sort === 'oldest')  return getSortKey(a) - getSortKey(b);
    return getSortKey(b) - getSortKey(a); 
  }, [f.sort]);

  const sortByJutsu = useCallback((a, b) => {
    if (f.sort === 'rank_desc') return Math.max(0, ...toArray(b.rank).map(r => RANK_COST_NUM[r] || 0)) - Math.max(0, ...toArray(a.rank).map(r => RANK_COST_NUM[r] || 0));
    if (f.sort === 'rank_asc')  return Math.max(0, ...toArray(a.rank).map(r => RANK_COST_NUM[r] || 0)) - Math.max(0, ...toArray(b.rank).map(r => RANK_COST_NUM[r] || 0));
    return sortByCommon(a, b);
  }, [f.sort, sortByCommon]);

  const sortedBloodlines = useMemo(() => {
    return [...(db.bloodlines || [])].sort((a, b) => {
      if (f.sort === 'za')     return b.name.localeCompare(a.name);
      if (f.sort === 'oldest') return getSortKey(a) - getSortKey(b);
      if (f.sort === 'newest') return getSortKey(b) - getSortKey(a);
      return a.name.localeCompare(b.name);
    });
  }, [db.bloodlines, f.sort]);

  const sortedSpecs = useMemo(() => {
    const specs = db.specializations || [];
    if (f.sort === 'za')     return [...specs].sort((a, b) => b.localeCompare(a));
    if (f.sort === 'oldest') return [...specs];
    if (f.sort === 'newest') return [...specs].reverse();
    return [...specs].sort((a, b) => a.localeCompare(b));
  }, [db.specializations, f.sort]);

  const sortedJutsuTypeTags = useMemo(() => {
    const tags = db.jutsuTypeTags || [];
    if (f.sort === 'za')     return [...tags].sort((a, b) => b.localeCompare(a));
    if (f.sort === 'oldest') return [...tags];
    if (f.sort === 'newest') return [...tags].reverse();
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [db.jutsuTypeTags, f.sort]);

  const filtJ = useMemo(() => {
    const lowerQ = f.q.toLowerCase();
    return (db.jutsus || []).filter(j =>
      (!f.q || j.name.toLowerCase().includes(lowerQ)
            || toArray(j.custom_tags).some(t => t.toLowerCase().includes(lowerQ))
            || (j.bloodline || '').toLowerCase().includes(lowerQ)) &&
      (!f.nat.length || f.nat.some(n => toArray(j.nature).includes(n))) &&
      (!f.org.length || f.org.includes(j.origin)) &&
      (!f.spc.length || f.spc.some(s => toArray(j.spec).includes(s))) &&
      (!f.typ.length || f.typ.some(t => toArray(j.types).includes(t))) &&
      (!f.jty.length || f.jty.some(t => toArray(j.jutsu_type).includes(t))) &&
      (!f.rnk.length || f.rnk.some(r => toArray(j.rank).includes(r))) &&
      (!f.bm.length  || f.bm.includes(j.bm_tier)) &&
      (!f.bl.length  || f.bl.includes(j.bloodline)) &&
      (!f.lck || j.locked)    && (!f.lim || j.limited)    && (!f.mul || j.multiRank) &&
      (!f.hLck || !j.locked)  && (!f.hLim || !j.limited)  && (!f.hMul || !j.multiRank) &&
      (!f.hMP  || !toArray(j.types).includes('Multi-Post')) &&
      (!f.hAsk || !getSlotStatus(j.slots).showAskStaff)
    ).sort(sortByJutsu);
  }, [db.jutsus, f, sortByJutsu]);

  /* ---- Messages inbox: join chat threads with their pending submissions ---- */
  const chatThreadById = useMemo(
    () => new Map(chatThreads.map(t => [t.pending_id, t])),
    [chatThreads]
  );

  // Most recent public message per submission (feeds Recent Chat Activity)
  const recentChats = useMemo(
    () => chatThreads
      .map(t => t.lastMessage)
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20),
    [chatThreads]
  );

  /*
   * Inbox tab data (merged Messages + Pending + My Submissions). Every
   * pending item relevant to the viewer gets an entry here, including ones
   * with zero chat messages yet — a freshly-submitted, unclaimed item is
   * exactly what the old Pending tab existed to surface, so it must not
   * disappear just because nobody has said anything about it yet. Items
   * with no thread but no claimant get status 'unclaimed'; once a reviewer
   * claims it, it moves to 'awaiting_you'/'awaiting_them' even with zero
   * messages — claiming without chatting yet is not the same as unclaimed.
   *
   * Post-merge, staff see every pending item here — unclaimed and
   * claimed-by-others included — not just ones they've personally claimed
   * or messaged in. That's intentional: folding the old Pending tab's
   * full-queue discovery function into Inbox requires the same visibility
   * here; restricting it back down would silently kill that function.
   */
  const inboxItems = useMemo(() => {
    if (!profile?.id) return [];
    const seen = new Set();
    const source = [];
    for (const p of [...myOwnSubmissions, ...((isReviewer || isGrader) ? pendingJutsus : [])]) {
      if (!seen.has(p.id)) { seen.add(p.id); source.push(p); }
    }
    return source.map(p => {
      const thread = chatThreadById.get(p.id);
      if (!thread?.lastMessage) {
        const assignedId = getPendingAssignedId(p);
        const status = !assignedId ? 'unclaimed' : (assignedId === profile.id ? 'awaiting_you' : 'awaiting_them');
        return { pending: p, messages: [], lastMessage: null, turn: null, unreadCount: 0, status };
      }
      const iAmSubmitter = p.submitted_by === profile.id;
      const turn = getChatTurn(thread.lastMessage, profile.id, iAmSubmitter);
      const readAt = chatReadMap[p.id] ? new Date(chatReadMap[p.id]).getTime() : 0;
      const unreadCount = thread.messages.filter(m =>
        m.sender_id !== profile.id && new Date(m.created_at).getTime() > readAt
      ).length;
      const status = p.status === 'pending_approval'
        ? 'ready'
        : (turn === 'you' ? 'awaiting_you' : 'awaiting_them');
      return { pending: p, messages: thread.messages, lastMessage: thread.lastMessage, turn, unreadCount, status };
    });
  }, [chatThreadById, pendingJutsus, myOwnSubmissions, profile?.id, isReviewer, isGrader, chatReadMap]);

  const inboxItemById = useMemo(
    () => new Map(inboxItems.map(it => [it.pending.id, it])),
    [inboxItems]
  );

  const inboxUnreadCount = useMemo(
    () => inboxItems.filter(c => c.unreadCount > 0).length,
    [inboxItems]
  );

  const resolvePendingName = useCallback((p) => {
    if (p.operation === 'delete') {
      const original = (db.jutsus || []).find(j => j._id === p.target_id);
      return original?.name ? `Delete: ${original.name}` : '(deletion request)';
    }
    return p.data?.name || '(no name)';
  }, [db.jutsus]);

  // Turn + unread metadata for a pending item, from the current user's view
  const getPendingChatMeta = useCallback((p) => {
    const thread = chatThreadById.get(p.id);
    const last = thread?.lastMessage;
    if (!last) return null;
    const iAmSubmitter = p.submitted_by === profile?.id;
    const turn = getChatTurn(last, profile?.id, iAmSubmitter);
    const readAt = chatReadMap[p.id] ? new Date(chatReadMap[p.id]).getTime() : 0;
    const hasUnread = last.sender_id !== profile?.id && new Date(last.created_at).getTime() > readAt;
    return { turn, hasUnread, lastMessage: last };
  }, [chatThreadById, profile?.id, chatReadMap]);

  if (loading) {
    return (
      <div className="w-full h-screen bg-black flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
        <p className="text-slate-400 text-sm font-semibold">Loading...</p>
      </div>
    );
  }

  // The catalog's own two views — the only thing left in the tab bar.
  const CATALOG_TABS = [
    { to: '/',           label: 'Jutsus',     count: (db.jutsus || []).length },
    { to: '/bloodlines', label: 'Bloodlines', count: (db.bloodlines || []).length },
    ...(profile ? [{ to: '/inbox', label: 'Inbox', count: inboxItems.length, unread: inboxUnreadCount, hasNew: inboxHasNew }] : []),
  ];

  // Everything else is its own page, reachable from the header switcher.
  const SECTIONS = [
    { to: '/', label: 'Database', match: (p) => p === '/' || p === '/bloodlines' || p === '/inbox' },
    { to: '/roster', label: 'Roster' },
    ...(profile || !supabaseReady ? [{ to: '/grading', label: 'Grading/Upgrade Requests' }] : []),
    ...(isReviewer ? [{ to: '/history/work-log', label: 'History', match: (p) => p.startsWith('/history') }] : []),
    ...(isAdmin ? [{ to: '/members', label: 'Member Board' }] : []),
  ];

  const activeSection = SECTIONS.find(sec => sec.match ? sec.match(pathname) : pathname.startsWith(sec.to));
  const headerTitle = `SARP ${activeSection ? activeSection.label : 'Database'}`;

  // Pending's four review-queue groups (drawn only from OTHER people's
  // submissions), plus a fifth bucket for the viewer's own — folding My
  // Submissions in. For non-staff players, pendingJutsus is always empty
  // (see refreshPending), so only "My Submissions" ever renders for them.
  const pendingGroupClaimedByMe = pendingJutsus.filter(p => getPendingAssignedId(p) === profile?.id);
  const pendingGroupRest = pendingJutsus.filter(p => getPendingAssignedId(p) !== profile?.id);
  const pendingGroupApproval = pendingGroupRest.filter(p => p.status === 'pending_approval');
  const pendingGroupNeeds = pendingGroupRest.filter(p => p.status === 'pending_review' && !getPendingAssignedId(p));
  const pendingGroupOthers = pendingGroupRest.filter(p => !(p.status === 'pending_approval') && !(p.status === 'pending_review' && !getPendingAssignedId(p)));
  const pendingGroups = [
    { key: 'mine',       label: 'Claimed by Me',     emoji: '⭐', items: pendingGroupClaimedByMe },
    { key: 'approval',   label: 'Pending Approval',   emoji: '🔵', items: pendingGroupApproval },
    { key: 'needs',      label: 'Needs Reviewer',     emoji: '🟡', items: pendingGroupNeeds },
    { key: 'others',     label: 'Claimed by Others',  emoji: '⬜', items: pendingGroupOthers },
    { key: 'my_submissions', label: 'My Submissions', emoji: '📝', items: myOwnSubmissions },
  ].filter(g => g.items.length > 0);
  const selectedInboxItem = pendingJutsus.find(p => p.id === selectedInboxId)
    || myOwnSubmissions.find(p => p.id === selectedInboxId)
    || null;
  // For staff, only surface recent chats for submissions they claimed or messaged in.
  // Admins and owners see all.
  const visibleRecentChats = ['admin', 'owner'].includes(role)
    ? recentChats
    : recentChats.filter(c => {
        const claimed = getPendingAssignedId(pendingJutsus.find(p => p.id === c.pending_id)) === profile?.id;
        return claimed || myParticipatingIds.has(c.pending_id);
      });

  return (
    <div className="w-full min-h-screen bg-slate-200 flex flex-col font-sans text-slate-900">

      {/* HEADER AND FILTER BAR STICKY WRAPPER */}
      <div ref={headerRef} className="sticky top-0 z-40 shrink-0 flex flex-col shadow-lg">
        {!bannerDismissed && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-3 flex items-start gap-3">
            <Icon n="Alert" size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-bold mb-1">SARP DB is shutting down on August 20th.</p>
              <p>
                Running this site costs money to keep online, and that cost isn't sustainable long-term. Please
                save or export anything you need before then.
              </p>
              <p className="mt-1.5 font-mono text-xs sm:text-sm font-semibold tracking-wide">
                {msUntilShutdown > 0
                  ? `${shutdownCountdown.days}d ${String(shutdownCountdown.hours).padStart(2, '0')}h ${String(shutdownCountdown.mins).padStart(2, '0')}m ${String(shutdownCountdown.secs).padStart(2, '0')}s remaining`
                  : 'SARP DB has shut down.'}
              </p>
            </div>
            <button
              onClick={dismissShutdownBanner}
              className="text-amber-600 hover:text-amber-900 shrink-0"
              title="Dismiss"
            >
              <Icon n="X" size={18} />
            </button>
          </div>
        )}
        {/* HEADER */}
        <div className="bg-black text-white p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <h1 className="text-lg font-bold tracking-widest uppercase flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
            <Icon n="Book" size={18} className="text-blue-600" />
            <button onClick={() => setModals(m => ({ ...m, credits: true }))} className="hover:text-indigo-300">{headerTitle}</button>
          </h1>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-center sm:justify-end pb-1 sm:pb-0">
            <div className="flex items-center gap-2">
              {isReviewer && (
                <button
                  onClick={refreshDB}
                  disabled={refreshing}
                  title="Refresh Data"
                  className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition-colors shrink-0">
                  <Icon n="Refresh" size={15} className={refreshing ? 'animate-spin' : ''} />
                </button>
              )}
              {isReviewer && (
                <button onClick={() => setModals(m => ({ ...m, system: true }))}
                        className="text-xs px-3 py-1.5 font-bold rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 shrink-0">
                  <Icon n="Settings" size={14}/>
                  <span className="hidden sm:inline">System Tools</span>
                </button>
              )}
              {'Notification' in window && profile && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    title={appNotifEnabled && appNotifPermission === 'granted' ? 'Chat notifications ON — click to disable' : appNotifPermission === 'denied' ? 'Notifications blocked in browser settings' : 'Enable chat notifications'}
                    onClick={async () => {
                      if (appNotifEnabled) {
                        setNotifEnabled(false);
                        setAppNotifEnabled(false);
                        setAppNotifDenied(false);
                        try {
                          const endpoint = await unsubscribeFromPush();
                          if (endpoint) await deletePushSubscription(endpoint);
                        } catch (e) {
                          console.warn('[NARP] Failed to unsubscribe from push:', e);
                        }
                      } else {
                        const perm = await requestNotifPermission();
                        setAppNotifPermission(perm);
                        if (perm === 'granted') {
                          setNotifEnabled(true);
                          setAppNotifEnabled(true);
                          setAppNotifDenied(false);
                          try {
                            const pushSub = await subscribeToPush();
                            if (pushSub) {
                              await savePushSubscription(pushSub);
                              // Immediately send a confirmation push so the user can
                              // verify the full server-side pipeline from one device.
                              try {
                                const { data: { session } } = await supabase.auth.getSession();
                                if (session?.access_token) {
                                  const res = await fetch('/.netlify/functions/send-test-push', {
                                    method: 'POST',
                                    headers: { Authorization: `Bearer ${session.access_token}` },
                                  });
                                  const out = await res.json().catch(() => ({}));
                                  if (!res.ok || !out.sent) {
                                    console.warn('[NARP] Test push not delivered:', res.status, out);
                                    alert(
                                      'Notifications are enabled, but the confirmation push could not be sent' +
                                      (out.error ? ` (${out.error})` : '') +
                                      '. Double-check the VAPID_* keys in the Netlify environment variables.'
                                    );
                                  }
                                }
                              } catch (e) {
                                console.warn('[NARP] Test push request failed:', e);
                              }
                            } else {
                              console.warn('[NARP] Notifications enabled but no push subscription was created (check VAPID config / service worker).');
                            }
                          } catch (e) {
                            console.warn('[NARP] Failed to subscribe to push:', e);
                          }
                        } else {
                          setAppNotifDenied(true);
                        }
                      }
                    }}
                    className={`p-2 rounded-lg border transition-colors shrink-0 ${appNotifEnabled && appNotifPermission === 'granted' ? 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500' : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill={appNotifEnabled && appNotifPermission === 'granted' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </button>
                  {appNotifDenied && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-rose-600 text-white text-[10px] font-semibold px-2.5 py-1.5 rounded-lg shadow-lg z-50 whitespace-normal">
                      Notifications blocked. Enable in your browser settings.
                    </div>
                  )}
                </div>
              )}
              {tab === 'jutsus' && (
                <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700 mr-2 shrink-0">
                  <button onClick={() => setViewMode('card')} className={`p-1.5 rounded-md ${viewMode === 'card' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}><Icon n="Grid" size={14}/></button>
                  <button onClick={() => setViewMode('row')}  className={`p-1.5 rounded-md ${viewMode === 'row'  ? 'bg-slate-700 text-white' : 'text-slate-400'}`}><Icon n="List" size={14}/></button>
                </div>
              )}
            </div>
            {viewAsRole && (
              <span className="text-[10px] font-bold px-2 py-1 bg-amber-500 text-white rounded-full shrink-0">
                Previewing as {viewAsRole === 'owner' ? 'Operator' : viewAsRole}
              </span>
            )}
            {isCatalog && (
              <AddSubmissionMenu
                canSubmit={role !== 'guest'}
                onAdd={() => setAdminForm({ r: {}, tab: 'jutsus' })}
                onOpenStatelessSubmission={setStatelessType}
                submissionControls={submissionControls}
              />
            )}
            <UserMenu
              profile={profile}
              supabaseReady={supabaseReady}
              devRole={devRole}
              onToggleDevRole={setDevRole}
              onSignIn={handleSignIn}
              onDevSignIn={handleDevSignIn}
              onSignOut={handleSignOut}
              onProfileUpdate={setProfile}
              viewAsRole={viewAsRole}
              onSetViewAsRole={setViewAsRole}
            />
          </div>
        </div>

        {/* SECTION SWITCHER — the one nav that spans every page */}
        <div className="bg-slate-900 border-t border-slate-800">
          <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto scrollbar-hide">
            {SECTIONS.map(sec => {
              const active = sec.match ? sec.match(pathname) : pathname.startsWith(sec.to);
              return (
                <NavLink key={sec.to} to={sec.to}
                  className={`relative px-3.5 py-2.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${
                    active ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-100'
                  }`}>
                  <span className="relative">
                    {sec.label}
                    {sec.hasNew && !active && (
                      <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-red-500 shadow-sm" />
                    )}
                  </span>
                  {sec.count !== undefined && (
                    <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${active ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-slate-400'}`}>{sec.count}</span>
                  )}
                  {sec.unread > 0 && (
                    <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-red-500 text-white shadow-sm"
                          title={`${sec.unread} conversation${sec.unread === 1 ? '' : 's'} with unread messages`}>
                      {sec.unread}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>

        {/* FILTER BAR — jutsu catalog only */}
        {pathname === '/' && (
          <FilterBar
            tab={tab} f={f} setF={setF}
            activeFilterCount={fCount}
            clearF={clearF}
            onOpenStats={() => setModals(m => ({ ...m, stats: true }))} />
        )}
      </div>

      {/* FILTER PANEL — outside sticky header, in normal document flow */}
      {pathname === '/' && (
        <FilterBarPanel
          tab={tab} f={f} setF={setF}
          bloodlinesDb={sortedBloodlines}
          specOptions={sortedSpecs}
          jutsuTypeTagOptions={sortedJutsuTypeTags} />
      )}

      {/* CATALOG TAB BAR — Database section only */}
      {isCatalog && (
        <div className="bg-white border-b border-slate-300 shadow-sm shrink-0 sticky z-20" style={{ top: `${headerHeight}px` }}>
          <div className="max-w-6xl mx-auto px-4 flex gap-1 pt-2 overflow-x-auto scrollbar-hide">
            {CATALOG_TABS.map(t => (
              <NavLink key={t.to} to={t.to} end
                className={({ isActive }) => `px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${isActive ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      {t.label}
                      {t.hasNew && !isActive && (
                        <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-red-500 shadow-sm" />
                      )}
                    </span>
                    <span className={`text-[10px] tabular-nums px-2 py-0.5 rounded-full ${isActive ? 'bg-indigo-100' : 'bg-slate-100'}`}>{t.count}</span>
                    {t.unread > 0 && (
                      <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-red-500 text-white shadow-sm"
                            title={`${t.unread} conversation${t.unread === 1 ? '' : 's'} with unread messages`}>
                        {t.unread}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* MAIN CONTENT — one route per page. Pages that paint their own
          full-bleed layout (Roster, History) opt out of the shell padding. */}
      <div className={`flex-1 overflow-y-auto ${selfLaidOut ? '' : 'p-4 md:p-6 pb-20'}`}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={
          <div className="max-w-6xl mx-auto h-full">
            {filtJ.length === 0 ? (
              <div className="text-center py-16">
                <Icon n="Alert" size={40} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-semibold mb-4">No jutsus match your filters.</p>
                <button onClick={clearF} className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg font-bold">Clear All Filters</button>
              </div>
            ) : (
              <>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">{filtJ.length} Results</div>
                <div className={viewMode === 'card' ? 'grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-stretch' : 'flex flex-col gap-2'}>
                  {filtJ.slice(0, visibleCount).map(j => (
                    <JutsuCard key={j._id} j={j}
                               viewMode={viewMode} expRow={expRow} setExpRow={setExpRow}
                               pTags={pTags} setPersonalTagsForJutsu={setPersonalTagsForJutsu}
                               handleCopy={handleCopy} cart={cart} copiedId={modals.copiedId}
                               isAdmin={isReviewer}
                               isActualAdmin={isAdmin}
                               onEdit={() => setAdminForm({ r: j, tab: 'jutsus' })}
                               onDelete={() => setConfirmDel({ id: j._id, name: j.name })}
                               onViewSlots={(jutsu) => setSlotsView(jutsu)}
                               onViewSheet={(jutsu) => { setSheetView(jutsu); setSheetViewRank(null); }}
                               onViewHistory={isReviewer ? (jutsu) => setHistoryView(jutsu) : null} />
                  ))}
                </div>
                {filtJ.length > visibleCount && (
                  <div className="mt-8 flex flex-col items-center gap-3">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Showing {visibleCount} of {filtJ.length} jutsus
                    </p>
                    <button
                      onClick={() => setVisibleCount(prev => prev + 200)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-2"
                    >
                      <Icon n="Plus" size={16} /> Load More
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
            } />

            <Route path="/bloodlines" element={
          <BloodlinesRosterTab
            bloodlines={db.bloodlines || []}
            isAdmin={isAdmin}
            onEdit={(bl) => setAdminForm({ r: bl, tab: 'bloodlines' })}
            bF={bF}
            setBF={setBF}
          />
            } />

            <Route path="/inbox" element={profile ? (
          <Suspense fallback={null}>
          <InboxPage
            inboxItems={inboxItems}
            pendingGroups={pendingGroups}
            profile={profile}
            role={role}
            isAdmin={isAdmin}
            isStaff={isReviewer || isGrader}
            selectedId={selectedInboxId}
            onSelect={setSelectedInboxId}
            onMarkRead={markChatRead}
            resolveName={resolvePendingName}
            getPendingChatMeta={getPendingChatMeta}
            refreshTrigger={refreshTrigger}
            refreshPending={refreshPending}
            dbJutsus={db.jutsus || []}
            onApprove={handleApprovePending}
            onCancel={handleCancelPending}
            onSubmitterCancel={handleSubmitterCancelPending}
            onReview={handleReviewPending}
            onEdit={handleEditPending}
            onClaim={handleClaimPending}
            approvingIds={approvingIds}
            collapsedGroups={collapsedGroups}
            setCollapsedGroups={setCollapsedGroups}
            visibleRecentChats={visibleRecentChats}
            pendingLoaded={pendingLoaded}
          />
          </Suspense>
            ) : <SignedOutNotice what="your inbox" />} />

            <Route path="/members" element={isAdmin ? (
              <MembersPage
                profilesList={profilesList}
                profilesLoading={profilesLoading}
                loadProfiles={loadProfiles}
                profile={profile}
                isAdmin={isAdmin}
                isOwner={isOwner}
                handleRoleChange={handleRoleChange}
                handleGrantWandererTicket={handleGrantWandererTicket}
                handleRemoveMember={handleRemoveMember}
                handleBanMember={handleBanMember}
                handleUnbanMember={handleUnbanMember}
              />
            ) : <NoAccess what="The member board is admin-only." />} />

            <Route path="/grading" element={<GradingPage profile={profile} role={role} jutsus={db.jutsus || []} />} />
            <Route path="/roster"  element={<RosterPage userRole={role} userId={profile?.id} jutsus={db.jutsus || []} />} />

            <Route path="/history" element={<Navigate to="/history/work-log" replace />} />
            <Route path="/history/:view" element={<HistoryRoute profile={profile} role={role} />} />

            <Route path="/submissions" element={<Navigate to="/inbox" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>

      {/* FOOTER */}
      <div className="bg-black text-center py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest shrink-0 flex items-center justify-center gap-2 relative z-30">
        <button onClick={() => setModals(m => ({ ...m, credits: true }))} className="hover:text-indigo-300 flex items-center gap-1.5">
          <Icon n="Info" size={11} /> Hexagon &amp; A Road Sign
        </button>
      </div>

      {/* MODALS */}
      {modals.stats && (
        <Suspense fallback={null}>
          <JutsuStatsModal db={db} onClose={() => setModals(m => ({ ...m, stats: false }))} />
        </Suspense>
      )}
      {slotsView && (
        <SlotsViewModal jutsu={slotsView} onClose={() => setSlotsView(null)} />
      )}
      {sheetView && sheetView.multiRank && !sheetViewRank && (
        <JutsuDocRankPicker
          jutsu={sheetView}
          onPick={(rank) => setSheetViewRank(rank)}
          onClose={() => setSheetView(null)}
        />
      )}
      {sheetView && (!sheetView.multiRank || sheetViewRank) && (
        <JutsuSheetModal
          sheet={normalizeJutsuSheet(sheetView.multiRank ? sheetView.sheet?.[sheetViewRank] : sheetView.sheet)}
          onChange={() => {}}
          readOnly
          jutsuName={sheetView.multiRank ? `${sheetView.name} (${sheetViewRank}-Rank)` : sheetView.name}
          onClose={() => { setSheetView(null); setSheetViewRank(null); }}
        />
      )}
      {historyView && (
        <JutsuHistoryModal jutsuId={historyView._id} jutsuName={historyView.name} onClose={() => setHistoryView(null)} />
      )}
      {adminForm     && (() => {
        const formTab = adminForm.tab || (MANAGE_TABLES[tab] ? tab : 'jutsus');
        return (
          <Suspense fallback={null}>
            <AdminFormModal
              tab={formTab}
              eRow={adminForm.r}
              onClose={() => setAdminForm(null)}
              db={db}
              onSubmit={submitChange}
              willGoToPending={formTab === 'jutsus' && (role === 'user' || role === 'reviewer') && !isAdmin && !adminForm.isPendingEdit}
              isAdmin={isAdmin}
              isPendingEdit={adminForm.isPendingEdit}
            />
          </Suspense>
        );
      })()}
      {modals.system && (
        <Suspense fallback={null}>
          <SystemToolsModal
            db={db} setDb={setDb}
            onClose={() => setModals(m => ({ ...m, system: false }))}
            onRefresh={refreshDB}
            refreshing={refreshing}
            isOwner={isOwner}
            isAdmin={isAdmin}
            isReviewer={isReviewer}
            webhookConfig={webhookConfig}
            onWebhookConfigSave={(key, value) => {
              saveWebhookConfig(key, value).then(() => {
                setWebhookConfig(prev => ({ ...prev, [key]: value }));
              }).catch(e => console.warn('[NARP] webhook config save failed:', e));
            }}
            onManageBL={() => setModals(m => ({ ...m, manageBL: true }))}
            submissionControls={submissionControls}
            onToggleSubmission={(key, value) => setSubmissionControls(prev => ({ ...prev, [key]: value }))}
            currentUserId={profile?.id}
            profile={profile}
            onProfileUpdate={setProfile} />
        </Suspense>
      )}
      {modals.manageBL && isAdmin && (
        <Suspense fallback={null}>
          <CatalogManagementModal
            which="bloodlines"
            db={db}
            onClose={() => setModals(m => ({ ...m, manageBL: false }))}
            onAdd={() => setAdminForm({ r: {}, tab: 'bloodlines' })}
            onEdit={(item) => setAdminForm({ r: item, tab: 'bloodlines' })}
            onDelete={(item) => setConfirmDel({ id: item._id, name: item.name, tab: 'bloodlines' })} />
        </Suspense>
      )}

      {confirmDel && (() => {
        const effectiveTab = confirmDel.tab || tab;
        const isPendingDelete = effectiveTab === 'jutsus' && (
          (isReviewer && !isAdmin) || (isAdmin && askSecondApprovalDelete)
        );
        return (
          <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={() => { setConfirmDel(null); setAskSecondApprovalDelete(false); }}>
            <div className="bg-white p-6 rounded-3xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-xl mb-2 text-slate-900">
                {isPendingDelete ? 'Submit deletion for approval?' : 'Confirm Deletion'}
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                {isPendingDelete
                  ? `Your request to delete '${confirmDel.name || 'this entry'}' will need a second approval before it's removed.`
                  : `Are you sure you want to delete '${confirmDel.name || 'this entry'}'? This action cannot be undone.`}
              </p>

              {isAdmin && effectiveTab === 'jutsus' && (
                <div className="flex items-center justify-between mb-6 bg-slate-50 p-3 rounded-xl border">
                  <div>
                    <p className="text-xs font-bold text-slate-800">Ask second approval</p>
                    <p className="text-[10px] text-slate-500">Require review before deletion</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={askSecondApprovalDelete}
                      onChange={(e) => setAskSecondApprovalDelete(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setConfirmDel(null); setAskSecondApprovalDelete(false); }} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button onClick={async () => {
                          try {
                            await submitChange({
                              tab: effectiveTab,
                              operation: 'delete',
                              targetId: confirmDel.id,
                              entity: { name: confirmDel.name },
                              askSecondApproval: askSecondApprovalDelete
                            });
                          } catch (e) {
                            alert('Delete failed: ' + e.message);
                          }
                          setConfirmDel(null);
                          setAskSecondApprovalDelete(false);
                        }}
                        className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md">
                  {isPendingDelete ? 'Submit' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {modals.credits && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" onClick={() => setModals(m => ({ ...m, credits: false }))}>
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 text-white p-5 flex justify-between">
              <div className="flex items-center gap-2">
                <Icon n="Info" size={20} className="text-indigo-400" />
                <h3 className="font-bold text-lg">About</h3>
              </div>
              <button onClick={() => setModals(m => ({ ...m, credits: false }))}><Icon n="X" size={18} /></button>
            </div>
            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p>Conceptualized by A Road Sign; Developed by Hexagon.</p>
              <div className="border-t pt-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">Credits</p>
                <p className="font-semibold">Hexagon &amp; A Road Sign</p>
              </div>
              {!appInstalled && (installPrompt || /iphone|ipad|ipod/i.test(navigator.userAgent)) && (
                <div className="border-t pt-4">
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-3">Install App</p>
                  {installPrompt ? (
                    <button
                      onClick={async () => {
                        installPrompt.prompt();
                        const { outcome } = await installPrompt.userChoice;
                        if (outcome === 'accepted') { setInstallPrompt(null); setAppInstalled(true); setModals(m => ({ ...m, credits: false })); }
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                      <Icon n="Download" size={14} /> Install SARP Database
                    </button>
                  ) : (
                    <button
                      onClick={() => { setModals(m => ({ ...m, credits: false, iosInstall: true })); }}
                      className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                      <Icon n="Download" size={14} /> Install on iPhone / iPad
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {modals.iosInstall && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4 animate-in fade-in" onClick={() => setModals(m => ({ ...m, iosInstall: false }))}>
          <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Icon n="Download" size={18} className="text-indigo-400" />
                <h3 className="font-bold text-base">Install on iPhone / iPad</h3>
              </div>
              <button onClick={() => setModals(m => ({ ...m, iosInstall: false }))} className="text-slate-400 hover:text-white"><Icon n="X" size={18} /></button>
            </div>
            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">Add SARP Database to your home screen in 3 steps:</p>
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">1</span>
                  <span>Tap the <strong>Share</strong> button at the bottom of Safari (the square with an arrow pointing up).</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">2</span>
                  <span>Scroll down and tap <strong>"Add to Home Screen"</strong>.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">3</span>
                  <span>Tap <strong>"Add"</strong> in the top-right corner. The app will appear on your home screen.</span>
                </li>
              </ol>
              <p className="text-xs text-slate-400 pt-1">Note: This feature requires Safari on iOS 16.4 or later.</p>
            </div>
            <div className="px-6 pb-6">
              <button onClick={() => setModals(m => ({ ...m, iosInstall: false }))}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {statelessType === 'Character' && (
        <Suspense fallback={null}>
        <OCSubmissionModal
          profile={profile}
          bloodlines={db.bloodlines || []}
          jutsus={db.jutsus || []}
          onClose={() => setStatelessType(null)}
          onAfterSubmit={refreshPending}
          isAdmin={isAdmin}
          onSubmitAndApprove={handleApprovePending}
        />
        </Suspense>
      )}
      {statelessType && statelessType !== 'Character' && (
        <Suspense fallback={null}>
        <StatelessSubmissionModal
          type={statelessType}
          profile={profile}
          onClose={() => setStatelessType(null)}
          isAdmin={isAdmin}
          onDirectUpload={handleDirectSummonItemUpload}
          onAfterSubmit={refreshPending}
        />
        </Suspense>
      )}
      {ocEdit && (
        <Suspense fallback={null}>
        <OCSubmissionModal
          profile={profile}
          bloodlines={db.bloodlines || []}
          editPending={ocEdit}
          onClose={() => setOcEdit(null)}
          onSavedEdit={async (newData) => {
            await updatePendingJutsuData(ocEdit.id, newData);
            await refreshPending();
          }}
        />
        </Suspense>
      )}

      <SessionListCart list={cart}
                       onClear={() => setCart([])}
                       onRemove={(id) => setCart(prev => prev.filter(x => x._id !== id))} />
    </div>
  );
}
