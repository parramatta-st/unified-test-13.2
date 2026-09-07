import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import TimeClockButton from './TimeClockButton';
import { clearTimeClockStatus } from '../lib/timeClockClientState';

export default function Header(){
  const router = useRouter();
  const [tutor,setTutor] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnread = useCallback(async () => {
    try {
      const response = await fetch('/api/inbox-unread', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (response.ok && json?.ok) {
        setUnreadCount(Math.max(0, Number(json.unreadTotal || 0)));
      }
      // Keep the last known count on transient Sheets/API failures. A failed
      // poll must never erase a real unread badge by pretending the count is 0.
    } catch {
      // Preserve the previous unread count and retry on the next interval.
    }
  }, []);

  useEffect(()=>{
    let cancelled = false;
    let interval = 0;
    try {
      setTutor(localStorage.getItem('st_tutor') || '');
    } catch {}

    const refreshFromEvent = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (detail && Number.isFinite(Number(detail.unreadTotal))) {
        setUnreadCount(Math.max(0, Number(detail.unreadTotal)));
      } else if (router.pathname !== '/sent-feedback') {
        loadUnread();
      }
    };

    // Do not trust the cached admin flag for rendering. Waiting for the signed
    // server session prevents non-admin tutors from briefly inheriting hidden
    // admin navigation slots from a previous browser session.
    fetch('/api/admin-status', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const admin = !!j?.isAdmin;
        setIsAdmin(admin);
        try { localStorage.setItem('st_is_admin', admin ? '1' : '0'); } catch {}
        if (admin) {
          // The Inbox page already polls /api/sent-feedback and dispatches its
          // unread total to the header. Running a second 30-second poll here
          // doubled Google Sheets reads for no benefit and contributed to quota
          // failures, so only poll independently on other portal pages.
          if (router.pathname !== '/sent-feedback') {
            loadUnread();
            interval = window.setInterval(loadUnread, 30000);
          }
        } else {
          setUnreadCount(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setUnreadCount(0);
        }
      });

    window.addEventListener('st-inbox-refresh', refreshFromEvent);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      window.removeEventListener('st-inbox-refresh', refreshFromEvent);
    };
  },[loadUnread, router.pathname]);

  const hideNav = router.pathname === '/login';

  function navClass(path: string) {
    const active = router.pathname === path || (path !== '/' && router.pathname.startsWith(path));
    return `btn nav-pill${active ? ' active' : ''}`;
  }

  async function doLogout(e: React.MouseEvent){
    e.preventDefault();
    await fetch('/api/logout', { method:'POST' });
    try {
      clearTimeClockStatus(localStorage);
      localStorage.removeItem('st_tutor');
      localStorage.removeItem('st_tutor_full');
      localStorage.removeItem('st_campus');
      localStorage.removeItem('st_is_admin');
    } catch {}
    window.location.href = '/login';
  }

  return (
    <header className="header">
      <div className="header-inner container" style={{paddingLeft:'1rem', paddingRight:'1rem'}}>
        <Link href="/" className="brand brand-link" prefetch={false} aria-label="Success Tutoring Portal home">
          <span className="brand-mark" aria-hidden="true">ST</span>
          <span className="brand-word accent">Success</span>{' '}
          <span className="brand-word">Tutoring</span>
          <span className="brand-word brand-portal"> Portal</span>
        </Link>
        {!hideNav && (
          <nav className="nav" aria-label="Main navigation">
            <Link className={navClass('/feedback')} href="/feedback" prefetch={false}>Feedback</Link>
            {isAdmin && (
              <Link className={navClass('/sent-feedback')} href="/sent-feedback" prefetch={false}>
                <span>Inbox</span>
                {unreadCount > 0 && <span className="nav-unread" aria-label={`${unreadCount} unread feedback conversation${unreadCount === 1 ? '' : 's'}`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </Link>
            )}
            <Link className={navClass('/print')} href="/print" prefetch={false}>Print</Link>
            <Link className={navClass('/progress')} href="/progress" prefetch={false}>Progress</Link>
            {isAdmin && (
              <Link className={navClass('/admin')} href="/admin" prefetch={false}>Admin</Link>
            )}
            <button className="btn nav-pill logout-pill" onClick={doLogout} aria-label="Logout">
              Logout{tutor ? ` (${tutor})` : ''}
            </button>
          </nav>
        )}
        {!hideNav && <div className="header-time-clock"><TimeClockButton /></div>}
      </div>
      <style jsx>{`
        .header-time-clock {
          display: flex;
          align-items: center;
          align-self: center;
          margin-left: .25rem;
          flex: 0 0 auto;
        }
        .nav {
          align-items: center;
          justify-content: flex-end;
          flex-wrap: nowrap;
        }
        .logout-pill { white-space: nowrap; }
        .nav-unread {
          display: inline-grid;
          place-items: center;
          min-width: 19px;
          height: 19px;
          margin-left: .32rem;
          padding: 0 .3rem;
          border-radius: 999px;
          color: #fff;
          background: #dc2626;
          font-size: .68rem;
          font-weight: 900;
          line-height: 1;
          box-shadow: 0 0 0 2px rgba(220,38,38,.12);
        }
        @media (max-width: 900px) {
          .header-inner {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
              "brand clock"
              "nav nav";
            align-items: center;
            column-gap: .75rem;
            row-gap: .55rem;
          }
          .brand-link {
            grid-area: brand;
            width: auto;
            min-width: 0;
            align-self: center;
          }
          .header-time-clock {
            grid-area: clock;
            align-self: center;
            justify-self: end;
            margin-left: 0;
          }
          .nav {
            grid-area: nav;
            width: 100%;
            margin-left: 0;
            justify-content: flex-start;
            overflow-x: auto;
            padding-bottom: .1rem;
          }
        }
        @media (max-width: 430px) {
          .brand-link { font-size: 1.2rem !important; min-width: 0; }
          .brand-portal { display: none; }
          .header-inner {
            padding-left: .7rem !important;
            padding-right: .7rem !important;
            column-gap: .4rem;
            row-gap: .5rem;
          }
        }
      `}</style>
    </header>
  );
}
