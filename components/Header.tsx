import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

export default function Header(){
  const router = useRouter();
  const [tutor,setTutor] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnread = useCallback(async () => {
    try {
      const response = await fetch('/api/inbox-unread', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (response.ok && json?.ok) setUnreadCount(Math.max(0, Number(json.unreadTotal || 0)));
      else setUnreadCount(0);
    } catch {
      setUnreadCount(0);
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
      } else {
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
          loadUnread();
          interval = window.setInterval(loadUnread, 30000);
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
  },[loadUnread]);

  const hideNav = router.pathname === '/login';

  function navClass(path: string) {
    const active = router.pathname === path || (path !== '/' && router.pathname.startsWith(path));
    return `btn nav-pill${active ? ' active' : ''}`;
  }

  async function doLogout(e: React.MouseEvent){
    e.preventDefault();
    await fetch('/api/logout', { method:'POST' });
    try { localStorage.removeItem('st_tutor'); localStorage.removeItem('st_tutor_full'); localStorage.removeItem('st_campus'); localStorage.removeItem('st_is_admin'); } catch {}
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
      </div>
      <style jsx>{`
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
        @media (max-width: 760px) {
          .header-inner { flex-wrap: wrap; }
          .nav {
            width: 100%;
            margin-left: 0;
            justify-content: flex-start;
            overflow-x: auto;
            padding-bottom: .1rem;
          }
        }
      `}</style>
    </header>
  );
}
