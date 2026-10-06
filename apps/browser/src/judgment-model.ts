import { judgmentAnswers, MAX_QUESTIONS, type JudgmentQuestion } from '../../../packages/workflow/src/judgment.js';
import type { WorkflowNode } from './workflow-model.js';

export const QUESTION_LIMIT = MAX_QUESTIONS;
export const MEMORY_ITEM_ADVICE = 3;
export type QuestionType = JudgmentQuestion['type'];
export type QuestionConfig = JudgmentQuestion & { thresholds?: { act: number; review: number }; gate?: boolean };
type Questions = Record<string, QuestionConfig>;

const QUESTION_ID = /^[a-z][a-z0-9_]{0,31}$/u;
const FIELD_SUFFIX = '(?:answer|probability|confidence|band|score)';
const BANDS = ['act', 'review', 'escalate'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export const defaultCriteria: Record<QuestionType, Pick<QuestionConfig, 'criteria'>> = {
  choice: { criteria: { option_1: 'Describe the first option', none: 'Nothing fits' } },
  score: { criteria: ['Low', 'High'] },
  noul: {},
};

const questionsOf = (config: Record<string, unknown>): Questions => record(config['questions']) ? config['questions'] as Questions : {};
const withQuestions = (config: Record<string, unknown>, questions: Questions): Record<string, unknown> => ({ ...config, questions });

export function defaultJudgmentConfig(trigger: WorkflowNode | undefined): Record<string, unknown> {
  const properties = record(trigger?.config?.['inputSchema']) && record(trigger.config['inputSchema']['properties']) ? trigger.config['inputSchema']['properties'] : {};
  const field = Object.entries(properties).find(([, value]) => record(value) && value['type'] === 'string')?.[0];
  return {
    provider: 'openrouter', openRouterOptIn: true, model: 'typesafe/jev-1.13',
    questions: { intent: { type: 'choice', instructions: 'Which option best describes `request`? Pick none when nothing fits.', criteria: { yes_action: 'The request should go ahead', none: 'Nothing fits or the request is unclear' } } },
    state: field === undefined ? {} : { request: `$input.${field}` },
    thresholds: { act: 0.85, review: 0.6 },
    policy: { milliseconds: 15000, attempts: 2, tokens: 8000, cost: 0.01, toolRounds: 0, effects: 0 },
  };
}

export function questionIdError(id: string, existing: readonly string[], previous?: string): string | undefined {
  if (id === '') return 'Enter an id.';
  if (id.length > 32) return 'Use at most 32 characters.';
  if (!QUESTION_ID.test(id)) return 'Use lowercase letters, numbers and underscores; start with a letter.';
  if (id !== previous && existing.includes(id)) return `${id} already exists.`;
  return undefined;
}

export function nextQuestionId(questions: Record<string, unknown>): string {
  let index = 1;
  while (`question_${String(index)}` in questions) index += 1;
  return `question_${String(index)}`;
}

export function addQuestion(config: Record<string, unknown>): Record<string, unknown> {
  const questions = questionsOf(config);
  if (Object.keys(questions).length >= QUESTION_LIMIT) return config;
  return withQuestions(config, { ...questions, [nextQuestionId(questions)]: { type: 'choice', instructions: 'Which option best fits the request? Pick none when nothing fits.', ...defaultCriteria.choice } as QuestionConfig });
}

export function removeQuestion(config: Record<string, unknown>, id: string): Record<string, unknown> {
  const questions = questionsOf(config);
  if (Object.keys(questions).length <= 1 || !(id in questions)) return config;
  return withQuestions(config, Object.fromEntries(Object.entries(questions).filter(([key]) => key !== id)));
}

export function renameQuestion(config: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  const questions = questionsOf(config);
  if (from === to || !(from in questions) || questionIdError(to, Object.keys(questions), from) !== undefined) return config;
  return withQuestions(config, Object.fromEntries(Object.entries(questions).map(([key, question]) => [key === from ? to : key, question])));
}

export function setQuestion(config: Record<string, unknown>, id: string, question: QuestionConfig): Record<string, unknown> {
  const questions = questionsOf(config);
  return id in questions ? withQuestions(config, { ...questions, [id]: question }) : config;
}

export function changeQuestionType(question: QuestionConfig, type: QuestionType): QuestionConfig {
  if (question.type === type) return question;
  const rest = Object.fromEntries(Object.entries(question).filter(([key]) => key !== 'criteria' && key !== 'type'));
  return { ...rest, type, ...defaultCriteria[type] } as QuestionConfig;
}

export function setCriteriaKey(criteria: Record<string, string>, from: string, to: string): Record<string, string> {
  if (from === to || to in criteria) return criteria;
  return Object.fromEntries(Object.entries(criteria).map(([key, text]) => [key === from ? to : key, text]));
}

const readsQuestion = (field: string, questionId: string): boolean => new RegExp(`^${questionId}_${FIELD_SUFFIX}$`, 'u').test(field);
const mappedFields = (values: unknown, judgmentId: string): string[] => record(values) ? Object.values(values).flatMap((value) => typeof value === 'string' ? [new RegExp(`^\\$node\\.${judgmentId}\\.([a-zA-Z0-9_-]+)$`, 'u').exec(value)?.[1] ?? ''] : []).filter(Boolean) : [];

export function questionReferences(nodes: readonly WorkflowNode[], judgmentId: string, questionId: string): string[] {
  return nodes.filter((node) => {
    const config = node.config ?? {};
    if (node.kind === 'condition') return config['source'] === judgmentId && typeof config['field'] === 'string' && readsQuestion(config['field'], questionId);
    return [...mappedFields(config['state'], judgmentId), ...mappedFields(config['arguments'], judgmentId)].some((field) => readsQuestion(field, questionId));
  }).map((node) => node.title);
}

export function answerValues(config: Record<string, unknown>, field: string): string[] | undefined {
  if (field === 'band' || /_band$/u.test(field) && Object.keys(questionsOf(config)).some((id) => field === `${id}_band`)) return BANDS;
  const found = Object.entries(questionsOf(config)).find(([key]) => field === `${key}_answer`);
  return found === undefined ? undefined : judgmentAnswers(found[1]);
}

export function memoryLimitWarning(state: unknown, nodes: readonly WorkflowNode[]): string | undefined {
  const large = nodes.some((node) => node.kind === 'memory' && Number(node.config?.['limit']) > MEMORY_ITEM_ADVICE && mappedFields(state, node.id).includes('memory'));
  return large ? 'Large memory context can distract the decision model; 3 items or fewer is recommended.' : undefined;
}
