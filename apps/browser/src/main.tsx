import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import { App } from './platform-app.js';
import './styles.css';

const publishableKey = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY'];
const root = createRoot(document.getElementById('root')!);

const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? webDarkTheme : webLightTheme;
const content = !publishableKey ? <main className="shell"><section className="state"><h1>Clerk configuration required</h1><p>This deployment has no publishable Clerk key, so sign-in is disabled.</p></section></main> : <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/"><App /></ClerkProvider>;
root.render(<FluentProvider theme={theme}>{content}</FluentProvider>);
