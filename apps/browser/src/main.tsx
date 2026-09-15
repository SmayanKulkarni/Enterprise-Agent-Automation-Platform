import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './styles.css';

const publishableKey = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY'];
const root = createRoot(document.getElementById('root')!);

if (!publishableKey) {
  root.render(<main className="shell"><section className="state"><h1>Clerk configuration required</h1><p>This deployment has no publishable Clerk key, so sign-in is disabled.</p></section></main>);
} else {
  root.render(<ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/"><App /></ClerkProvider>);
}
