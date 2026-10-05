import { modelValid, policyValid, type JsonSchema, type JsonSchemaProperty, type NodePolicy } from './graph.js';

export type Band = 'act' | 'review' | 'escalate';
export interface Thresholds { act: number; review: number; }
export type JudgmentQuestion = { instructions: string } & ({ type: 'choice'; criteria: Record<string, string> } | { type: 'score'; criteria: string[] } | { type: 'noul'; criteria?: { true: string; false: string } });
export type JudgmentQuestionConfig = JudgmentQuestion & { thresholds?: Thresholds; gate?: boolean };
export interface JudgmentConfig { provider: 'openrouter'; openRouterOptIn: true; model: string; questions: Record<string, JudgmentQuestionConfig>; state: Record<string, string>; thresholds: Thresholds; policy: NodePolicy; }
export interface NormalisedAnswer { answer: string; probability: number; confidence: number; probabilities: Record<string, number>; score?: number; }
export interface QuestionBand { id: string; type: JudgmentQuestion['type']; band: Band; }

export const MAX_QUESTIONS = 16;
export const MAX_CRITERIA = 512;
const MAX_STATE_KEYS = 16;
const MAX_INSTRUCTIONS = 4000;
const MAX_CRITERION = 2000;
const QUESTION_ID = /^[a-z][a-z0-9_]{0,31}$/u;
const CHOICE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const STATE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u;
const MAPPING = /^\$(?:input|node\.[a-zA-Z0-9_-]+)\.[a-zA-Z0-9_-]+$/u;
const CONFIG_FIELDS = ['provider', 'openRouterOptIn', 'model', 'questions', 'state', 'thresholds', 'policy'];
const QUESTION_FIELDS = ['type', 'instructions', 'criteria', 'thresholds', 'gate'];
const CAUTION: Record<Band, number> = { act: 0, review: 1, escalate: 2 };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, names: readonly string[]): boolean => Object.keys(value).every((key) => names.includes(key));
const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const criterion = (value: unknown): boolean => typeof value === 'string' && value.length >= 1 && value.length <= MAX_CRITERION;
const thresholdsValid = (value: unknown): value is Thresholds => object(value) && only(value, ['act', 'review']) && unit(value['act']) && unit(value['review']) && Number(value['review']) <= Number(value['act']);

const criteriaCount = (question: Record<string, unknown>): number => question['type'] === 'choice' && object(question['criteria']) ? Object.keys(question['criteria']).length : question['type'] === 'score' && Array.isArray(question['criteria']) ? question['criteria'].length : 0;

const criteriaValid = (question: Record<string, unknown>): boolean => {
  const criteria = question['criteria'];
  if (question['type'] === 'choice') return object(criteria) && Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 255 && Object.entries(criteria).every(([key, text]) => CHOICE_KEY.test(key) && criterion(text));
  if (question['type'] === 'score') return Array.isArray(criteria) && criteria.length >= 2 && criteria.length <= 10 && criteria.every(criterion);
  return question['type'] === 'noul' && (criteria === undefined || object(criteria) && Object.keys(criteria).length === 2 && criterion(criteria['true']) && criterion(criteria['false']));
};

const questionValid = (id: string, question: unknown): boolean => QUESTION_ID.test(id) && object(question) && only(question, QUESTION_FIELDS) && typeof question['instructions'] === 'string' && question['instructions'].trim().length >= 1 && question['instructions'].length <= MAX_INSTRUCTIONS && criteriaValid(question) && (question['thresholds'] === undefined || thresholdsValid(question['thresholds'])) && (question['gate'] === undefined || typeof question['gate'] === 'boolean');

const stateValid = (value: unknown): boolean => object(value) && Object.keys(value).length >= 1 && Object.keys(value).length <= MAX_STATE_KEYS && Object.entries(value).every(([key, item]) => STATE_KEY.test(key) && typeof item === 'string' && (item.startsWith('$') ? MAPPING.test(item) : item.length <= MAX_INSTRUCTIONS));

export function judgmentConfigValid(node: { instructions: string; config: Record<string, unknown> }): boolean {
  const config = node.config; const questions = config['questions'];
  return node.instructions === '' && CONFIG_FIELDS.every((key) => key in config) && only(config, CONFIG_FIELDS) && config['provider'] === 'openrouter' && config['openRouterOptIn'] === true && modelValid(config['model']) && config['model'].includes('/') && object(questions) && Object.keys(questions).length >= 1 && Object.keys(questions).length <= MAX_QUESTIONS && Object.entries(questions).every(([id, question]) => questionValid(id, question)) && Object.values(questions).reduce((total: number, question) => total + criteriaCount(question as Record<string, unknown>), 0) <= MAX_CRITERIA && stateValid(config['state']) && thresholdsValid(config['thresholds']) && policyValid(config['policy']) && config['policy'].toolRounds === 0 && config['policy'].effects === 0 && config['policy'].tokens >= 1;
}

export const judgmentStateMappings = (config: Record<string, unknown>): [string, string][] => object(config['state']) ? Object.entries(config['state']).flatMap(([key, value]): [string, string][] => typeof value === 'string' && value.startsWith('$') ? [[key, value]] : []) : [];

const questionsOf = (config: Record<string, unknown>): [string, Record<string, unknown>][] => object(config['questions']) ? Object.entries(config['questions']).flatMap(([id, question]): [string, Record<string, unknown>][] => object(question) ? [[id, question]] : []) : [];

export function judgmentOutputSchema(config: Record<string, unknown>): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {}; const required: string[] = [];
  for (const [id, question] of questionsOf(config)) {
    for (const [suffix, type] of [['answer', 'string'], ['probability', 'number'], ['confidence', 'number'], ['band', 'string']] as const) { properties[`${id}_${suffix}`] = { type }; required.push(`${id}_${suffix}`); }
    if (question['type'] === 'score') properties[`${id}_score`] = { type: 'number' };
  }
  Object.assign(properties, { band: { type: 'string' }, probabilities: { type: 'object' }, model: { type: 'string' }, requestId: { type: 'string' } });
  return { type: 'object', properties, required: [...required, 'band', 'probabilities', 'model'], additionalProperties: false };
}

export const judgmentAnswers = (question: JudgmentQuestion): string[] => question.type === 'choice' ? Object.keys(question.criteria) : question.type === 'score' ? question.criteria.map((_, index) => String(index)) : ['yes', 'no'];

function check(condition: unknown): asserts condition { if (!condition) throw Object.assign(new Error('INVALID_MODEL_OUTPUT'), { code: 'INVALID_MODEL_OUTPUT' }); }

const probabilitiesOf = (raw: Record<string, unknown>, keys: readonly string[]): Record<string, number> => {
  const value = raw['probabilities'];
  check(object(value) && Object.entries(value).every(([key, item]) => keys.includes(key) && unit(item)));
  return value as Record<string, number>;
};

export function normaliseAnswer(question: JudgmentQuestion, raw: unknown): NormalisedAnswer {
  check(object(raw) && raw['type'] === question.type);
  if (question.type === 'noul') {
    const noul = raw['noul']; check(unit(noul));
    return { answer: noul >= 0.5 ? 'yes' : 'no', probability: noul, confidence: Math.max(noul, 1 - noul), probabilities: { yes: noul, no: 1 - noul } };
  }
  const keys = judgmentAnswers(question); const probabilities = probabilitiesOf(raw, keys); const confidence = raw['confidence'];
  check(unit(confidence));
  if (question.type === 'choice') {
    const choice = raw['choice']; check(typeof choice === 'string' && keys.includes(choice));
    const probability = probabilities[choice]; check(probability !== undefined);
    return { answer: choice, probability, confidence, probabilities };
  }
  const score = raw['score']; check(typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= keys.length - 1);
  const best = keys.filter((key) => probabilities[key] !== undefined).reduce<string | undefined>((top, key) => top === undefined || probabilities[key]! > probabilities[top]! ? key : top, undefined);
  check(best !== undefined);
  return { answer: best, probability: probabilities[best]!, confidence, probabilities, score };
}

export function normaliseAnswers(questions: Record<string, JudgmentQuestion>, raw: Record<string, unknown>): Record<string, NormalisedAnswer> {
  const ids = Object.keys(questions);
  check(Object.keys(raw).length === ids.length && ids.every((id) => id in raw));
  return Object.fromEntries(ids.map((id) => [id, normaliseAnswer(questions[id]!, raw[id])]));
}

export const bandOf = (confidence: number, thresholds: Thresholds): Band => confidence >= thresholds.act ? 'act' : confidence >= thresholds.review ? 'review' : 'escalate';

export function evaluateJudgment(config: JudgmentConfig, raw: Record<string, unknown>, model: string, requestId?: string): { output: Record<string, unknown>; bands: QuestionBand[] } {
  const normalised = normaliseAnswers(config.questions, raw);
  const output: Record<string, unknown> = {}; const bands: QuestionBand[] = []; const probabilities: Record<string, Record<string, number>> = {};
  let overall: Band = 'act';
  for (const [id, question] of Object.entries(config.questions)) {
    const answer = normalised[id]!; const band = bandOf(answer.confidence, question.thresholds ?? config.thresholds);
    Object.assign(output, { [`${id}_answer`]: answer.answer, [`${id}_probability`]: answer.probability, [`${id}_confidence`]: answer.confidence, [`${id}_band`]: band, ...(answer.score === undefined ? {} : { [`${id}_score`]: answer.score }) });
    probabilities[id] = answer.probabilities; bands.push({ id, type: question.type, band });
    if (question.gate !== false && CAUTION[band] > CAUTION[overall]) overall = band;
  }
  return { output: { ...output, band: overall, probabilities, model, ...(requestId ? { requestId } : {}) }, bands };
}
