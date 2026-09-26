import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import { App } from './platform-app.js';
import './styles.css';

const publishableKey = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY'];
const root = createRoot(document.getElementById('root')!);
const app = <App authEnabled={Boolean(publishableKey)} />;

root.render(publishableKey ? <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">{app}</ClerkProvider> : app);
