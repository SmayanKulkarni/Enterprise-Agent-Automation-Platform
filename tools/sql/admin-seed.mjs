import { URL } from 'node:url';
const ADMIN_SEED_FILE = /^004_/u;
const SUBJECT_PATTERN = /^[A-Za-z0-9_.:@-]{1,256}$/u;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_ISSUER_LENGTH = 512;

/**
 * @param {string} name
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function required(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

/**
 * @param {string} issuer
 * @returns {string}
 */
function validIssuer(issuer) {
  if (issuer.length > MAX_ISSUER_LENGTH || !/^[\x21-\x7e]+$/u.test(issuer)) throw new Error('CLERK_ISSUER is not a valid issuer.');
  let url;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error('CLERK_ISSUER is not a valid issuer.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('CLERK_ISSUER is not a valid issuer.');
  return issuer;
}

/**
 * @param {string} list
 * @returns {string[]}
 */
function validTenants(list) {
  const tenants = list.split(',').map((item) => item.trim()).filter((item) => item !== '');
  if (tenants.length === 0) throw new Error('PLATFORM_LOCAL_TENANTS lists no tenants.');
  const invalid = tenants.find((tenant) => !GUID_PATTERN.test(tenant));
  if (invalid !== undefined) throw new Error('PLATFORM_LOCAL_TENANTS must list tenant GUIDs.');
  return tenants;
}

/**
 * @param {string} value
 * @returns {string}
 */
const literal = (value) => value.replaceAll("'", "''");

/**
 * @param {string} file
 * @param {string} source
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function seedSource(file, source, env) {
  if (!ADMIN_SEED_FILE.test(file)) return source;
  const subject = env['ADMIN_TEST_CLERK_SUBJECT']?.trim();
  if (!subject) return undefined;
  if (!SUBJECT_PATTERN.test(subject)) throw new Error('ADMIN_TEST_CLERK_SUBJECT contains unsupported characters.');
  const issuer = validIssuer(required('CLERK_ISSUER', env));
  const tenants = validTenants(required('PLATFORM_LOCAL_TENANTS', env));
  return source
    .replaceAll('$(ADMIN_ISSUER)', () => literal(issuer))
    .replaceAll('$(ADMIN_SUBJECT)', () => literal(subject))
    .replaceAll('$(ADMIN_TENANTS)', () => tenants.join(','));
}
