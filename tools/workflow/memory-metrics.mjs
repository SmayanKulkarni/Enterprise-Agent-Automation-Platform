const ACTIVE = 'promoted';

/** @param {string} subject */
const localPart = (subject) => subject.includes(':') ? subject.slice(subject.indexOf(':') + 1) : subject;
/** @param {string} text @param {string} subject */
const mentions = (text, subject) => {
  const lower = text.toLowerCase();
  const key = subject.toLowerCase();
  return lower.includes(key) || (localPart(key).length > 0 && lower.includes(localPart(key)));
};
/** @param {number} hits @param {number} total */
const share = (hits, total) => total === 0 ? 0 : Math.round((hits / total) * 1000) / 1000;

/** @typedef {{ id: string, text: string, subjects: string[], type: string, state?: string }} MemoryRow */

/** @param {readonly MemoryRow[]} items */
export const salience = (items) => share(items.filter((item) => item.subjects.some((subject) => mentions(item.text, subject))).length, items.length);

/** @param {readonly MemoryRow[]} items */
export const duplication = (items) => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of items.filter((row) => (row.state ?? ACTIVE) === ACTIVE)) for (const subject of item.subjects.length ? item.subjects : ['(none)']) counts[subject] = (counts[subject] ?? 0) + 1;
  return counts;
};

/** @param {readonly MemoryRow[]} items */
export const activeFacts = (items) => duplication(items.filter((item) => item.type === 'task-fact'));

/** @param {readonly { subjects: string[] }[]} returned @param {string} subject @param {number} k */
export const precisionAtK = (returned, subject, k) => {
  const top = returned.slice(0, k);
  return share(top.filter((item) => item.subjects.includes(subject)).length, top.length);
};

/** @param {readonly MemoryRow[]} items */
export const bytesPerItem = (items) => {
  const sizes = items.map((item) => Buffer.byteLength(item.text, 'utf8'));
  return { count: sizes.length, meanTextBytes: sizes.length ? Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length) : 0, maxTextBytes: Math.max(0, ...sizes) };
};

/** @param {readonly MemoryRow[]} items @param {readonly { subject: string, k: number, returned: readonly { subjects: string[] }[] }[]} [queries] */
export const memoryReport = (items, queries = []) => ({
  salience: salience(items),
  duplication: duplication(items),
  activeFacts: activeFacts(items),
  bytes: bytesPerItem(items),
  precision: queries.map((query) => ({ subject: query.subject, k: query.k, value: precisionAtK(query.returned, query.subject, query.k) })),
});
