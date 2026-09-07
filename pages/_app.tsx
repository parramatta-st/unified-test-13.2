import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    // Next's automatic scroll handling can align the next page's <main> with
    // the viewport instead of the document when a tall sticky mobile header is
    // present. That leaves the page heading underneath the header on iOS. A
    // pathname change should always begin at the real document top.
    if (window.location.hash) return;
    const frame = window.requestAnimationFrame(() => {
      const root = document.documentElement;
      const body = document.body;
      const rootScrollBehavior = root.style.scrollBehavior;
      const bodyScrollBehavior = body.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      body.style.scrollBehavior = 'auto';
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      root.scrollTop = 0;
      body.scrollTop = 0;
      root.style.scrollBehavior = rootScrollBehavior;
      body.style.scrollBehavior = bodyScrollBehavior;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [router.pathname]);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
        <title>Success Tutoring Portal</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
