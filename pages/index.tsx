import Header from '../components/Header';
import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <Header />
      <main className="container home-shell">
        <section className="card dashboard-hero">
          <div className="hero-glow-orb" aria-hidden="true" />
          <div className="eyebrow">Tutor workspace</div>
          <h1 className="hero-title">Run the centre from one beautiful portal.</h1>
          <p className="hero-subtitle">
            Send parent feedback, print lesson materials, and check student progress without jumping between systems.
          </p>
          <div className="dashboard-actions grid grid-3 grid-col mt-6">
            <Link href="/feedback" className="tile action-card p-6">
              <span className="action-icon">✦</span>
              <div className="text-xl" style={{fontWeight:800}}>Feedback</div>
              <div className="text-sm text-muted">Send polished parent updates after completed lesson workbooks.</div>
            </Link>
            <Link href="/print" className="tile action-card p-6">
              <span className="action-icon blue">⌁</span>
              <div className="text-xl" style={{fontWeight:800}}>Print</div>
              <div className="text-sm text-muted">Print lesson packs, folders, revisions, homework, and custom programs.</div>
            </Link>
            <Link href="/progress" className="tile action-card p-6">
              <span className="action-icon green">◌</span>
              <div className="text-xl" style={{fontWeight:800}}>Student Progress</div>
              <div className="text-sm text-muted">Review completed topics, recent activity, and suggested next lessons.</div>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
