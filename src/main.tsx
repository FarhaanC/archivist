import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { TimingPage } from '@/pages/timing-page';
import '@/styles.css';

/**
 * One hidden address besides the app itself: #/timing runs the standard
 * timing test. Nothing links to it — it is for whoever is measuring whether a
 * change made imports faster, and it would only be a distraction in the way
 * of someone trying to read their documents.
 */
const isTimingPage = (): boolean => window.location.hash.replace(/^#\/?/, '') === 'timing';

createRoot(document.getElementById('root')!).render(
    <StrictMode>{isTimingPage() ? <TimingPage /> : <App />}</StrictMode>,
);
