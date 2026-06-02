import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const BellIcon = ({ className = "w-5 h-5" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export default function NotificationBell({ userId }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!supabase || !userId) {
      setUnreadCount(0);
      return;
    }

    const fetchUnreadCount = async () => {
      try {
        const { count, error } = await supabase
          .from('pending_jutsus')
          .select('id', { count: 'exact', head: true })
          .eq('submitted_by', userId)
          .eq('has_user_unread', true);

        if (!error) {
          setUnreadCount(count || 0);
        }
      } catch (err) {
        console.warn('[NARP] Error fetching unread count:', err);
      }
    };

    fetchUnreadCount();

    const channel = supabase
      .channel(`pending-unread-bell-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pending_jutsus',
          filter: `submitted_by=eq.${userId}`
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  if (!userId) return null;

  return (
    <div className="relative p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0 flex items-center justify-center cursor-pointer" title="Unread staff replies">
      <BellIcon className="w-5 h-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-[10px] font-extrabold w-4 h-4 flex items-center justify-center animate-pulse shadow-md border border-slate-900">
          {unreadCount}
        </span>
      )}
    </div>
  );
}
