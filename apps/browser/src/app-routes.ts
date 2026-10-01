export type Route = 'home' | 'studio' | 'governance' | 'signin' | 'not-found';
export const paths = { home: '/', studio: '/studio', governance: '/governance', signin: '/sign-in' } as const satisfies Record<Exclude<Route, 'not-found'>, string>;
export const titles: Record<Route, string> = { home: 'Threadline', studio: 'Solution Studio · Threadline', governance: 'Governance · Threadline', signin: 'Sign in · Threadline', 'not-found': 'Page not found · Threadline' };
export type Navigate = (route: Exclude<Route, 'not-found'>) => void;

export function routeFromPath(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (Object.keys(paths) as (keyof typeof paths)[]).find((route) => paths[route] === path) ?? 'not-found';
}

export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
