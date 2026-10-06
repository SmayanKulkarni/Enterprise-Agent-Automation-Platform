/// <reference types="vite/client" />
const configured: unknown = import.meta.env['VITE_PLATFORM_API_ORIGIN'];

export const apiOrigin: string = typeof configured === 'string' ? configured.trim().replace(/\/+$/u, '') : '';
