import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import { App } from './platform-app.js';
import { lastCorrelationId } from './platform-api.js';
import './styles.css';

window.addEventListener('error', (event) => console.error('client error', { correlationId: lastCorrelationId(), message: event.message }));
window.addEventListener('unhandledrejection', (event) => console.error('client unhandled rejection', { correlationId: lastCorrelationId(), reason: event.reason instanceof Error ? event.reason.message : String(event.reason) }));

const publishableKey = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY'];
const root = createRoot(document.getElementById('root')!);
const app = <App authEnabled={Boolean(publishableKey)} />;

root.render(publishableKey ? <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">{app}</ClerkProvider> : app);
