import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Header(){
  const router = useRouter();
  const [tutor,setTutor] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(()=>{
    try {
      setTutor(localStorage.getItem('st_tutor') || '');
      // Use the role stored at login so the Admin nav slot is ready immediately.
      // The API call below still verifies the role from the secure cookie/sheet.
      setIsAdmin(localStorage.getItem('st_is_admin') === '1');
    } catch {}
    fetch('/api/admin-status')
      .then(r => r.json())
      .then(j => {
        const admin = !!j?.isAdmin;
        setIsAdmin(admin);
        try { localStorage.setItem('st_is_admin', admin ? '1' : '0'); } catch {}
      })
      .catch(() => setIsAdmin(false));
  },[]);

  // On the login screen, the nav can be confusing (it just bounces you back to login).
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
            <Link className={navClass('/print')} href="/print" prefetch={false}>Print</Link>
            <Link className={navClass('/progress')} href="/progress" prefetch={false}>Progress</Link>
            <Link
              className={`${navClass('/admin')} admin-nav-slot${isAdmin ? '' : ' is-hidden'}`}
              href="/admin"
              prefetch={false}
              aria-hidden={!isAdmin}
              tabIndex={isAdmin ? 0 : -1}
            >
              Admin
            </Link>
            <button className="btn nav-pill logout-pill" onClick={doLogout} aria-label="Logout">
              Logout{tutor ? ` (${tutor})` : ''}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
