import { SignInButton, SignUpButton, useAuth } from '@clerk/react';
import type { Navigate } from './app-routes.js';

export function SignIn({ authEnabled, navigate }: { authEnabled: boolean; navigate: Navigate }) {
  return <section className="auth-page"><button className="auth-back" onClick={() => navigate('home')}>← Back to home</button><div className="auth-panel"><div className="auth-brand"><span className="brand-mark"><i /><i /><i /></span><strong>threadline</strong></div>{authEnabled ? <ClerkSignIn navigate={navigate} /> : <FixtureSignIn navigate={navigate} />}</div></section>;
}

function ClerkSignIn({ navigate }: { navigate: Navigate }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <p aria-busy="true">Checking your session…</p>;
  if (isSignedIn) return <><h1>You're signed in.</h1><button className="button" onClick={() => navigate('studio')}>Open Solution Studio</button></>;
  return <><h1>Sign in to Threadline</h1><p>You'll return to Solution Studio.</p><SignInButton mode="modal" forceRedirectUrl="/studio"><button className="button">Sign in</button></SignInButton><SignUpButton mode="modal" forceRedirectUrl="/studio"><button className="button-secondary">Create an account</button></SignUpButton></>;
}

function FixtureSignIn({ navigate }: { navigate: Navigate }) {
  return <><h1>Sign-in isn't configured here.</h1><p>This build has no authentication. You can explore a fixture workspace; nothing is saved.</p><button className="button" onClick={() => navigate('studio')}>Explore fixture workspace</button></>;
}
