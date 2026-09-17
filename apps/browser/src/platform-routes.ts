export type Surface = 'studio' | 'catalog' | 'operations' | 'technical' | 'vendor';

export interface CollectionRoute {
  collection: string;
  label: string;
  surface: Surface;
  description: string;
  commandPrerequisite: string;
}

const defaultRoute: CollectionRoute = { collection: 'packages', label: 'Packages', surface: 'studio', description: 'Version, artifact, trust, validation, simulation, and evaluation evidence.', commandPrerequisite: 'Lifecycle must publish the current package command and approval state.' };

export const collectionRoutes: readonly CollectionRoute[] = [
  defaultRoute,
  { collection: 'evaluations', label: 'Evaluations', surface: 'studio', description: 'Evaluation ledger, comparison evidence, and gate results.', commandPrerequisite: 'Evaluation must publish current gate evidence and an owner command.' },
  { collection: 'improvements', label: 'Improvements', surface: 'studio', description: 'Candidate, shadow, canary, promotion, and rollback evidence.', commandPrerequisite: 'Improvement must publish current gates and independent approval.' },
  { collection: 'packages', label: 'Discover', surface: 'catalog', description: 'Approved package trust, provenance, and version history.', commandPrerequisite: 'Lifecycle must publish an approved package action with its exact version.' },
  { collection: 'installations', label: 'Installations', surface: 'catalog', description: 'Installation configuration references, readiness, and activation state.', commandPrerequisite: 'Lifecycle must publish current readiness and the installation owner command.' },
  { collection: 'cases', label: 'Cases', surface: 'operations', description: 'Case state, package pin, generation, timeline, outcome, and cost.', commandPrerequisite: 'Case runtime must publish fresh authority, approval, and the exact Case command.' },
  { collection: 'interventions', label: 'Interventions', surface: 'operations', description: 'Responder, decision history, deadline, consequence, and compensation.', commandPrerequisite: 'Identity and Case owners must publish a current intervention response command.' },
  { collection: 'capabilities', label: 'Capabilities', surface: 'operations', description: 'Adapter availability, health, quota, scope-safe metadata, and checkpoints.', commandPrerequisite: 'Gateway must publish an installation action; credential values are never browser fields.' },
  { collection: 'operations', label: 'Effects & evidence', surface: 'operations', description: 'Effect intent, attempt, receipt, checkpoint, alert, audit, and cost joins.', commandPrerequisite: 'The owning runtime must publish a reconciliation or recovery command.' },
  { collection: 'memory', label: 'Memory', surface: 'operations', description: 'Authorized provenance, retrieval explanation, holds, and validated experience.', commandPrerequisite: 'Memory must publish a scoped command and any required exact manifest.' },
  { collection: 'evaluations', label: 'Evaluations', surface: 'operations', description: 'Evaluation evidence and Case outcome comparisons.', commandPrerequisite: 'Evaluation must publish current gate evidence and an owner command.' },
  { collection: 'improvements', label: 'Improvements', surface: 'operations', description: 'Candidate rollout, promotion, rollback, and supporting evidence.', commandPrerequisite: 'Improvement must publish current gates and independent approval.' },
  { collection: 'deployments', label: 'Deployments', surface: 'operations', description: 'Manifest, checks, lease, restore, teardown, and cost evidence.', commandPrerequisite: 'Deployment must publish the exact manifest, lease authority, and owner command.' },
  { collection: 'readiness', label: 'Readiness', surface: 'operations', description: 'Package, provider, environment, and handoff checks with blocked dependencies.', commandPrerequisite: 'The owning package or provider must publish a current readiness action.' },
  { collection: 'readiness', label: 'Handoff readiness', surface: 'technical', description: 'Customer Environment readiness, tests, open actions, residual risk, and approval.', commandPrerequisite: 'Technical Implementation must publish the current Case command and approval.' },
  { collection: 'cases', label: 'Technical Case', surface: 'technical', description: 'Agreement, discovery, plan, validation, approval, and handoff timeline.', commandPrerequisite: 'Technical Implementation must publish the current Case command and approval.' },
  { collection: 'interventions', label: 'Customer responses', surface: 'technical', description: 'Missing-information and approval responses for the Technical Case.', commandPrerequisite: 'The assigned responder must have a current intervention command.' },
  { collection: 'operations', label: 'Provider effects', surface: 'technical', description: 'Graph, SQL, Blob, and Boards effect evidence and reconciliation checkpoints.', commandPrerequisite: 'Gateway must publish a reconciliation command after a safe provider outcome.' },
  { collection: 'vendor-assessments', label: 'Assessments', surface: 'vendor', description: 'Versioned evidence, decision, expiry, and supersession.', commandPrerequisite: 'Vendor Risk must publish a current assessment owner command.' },
  { collection: 'access-grants', label: 'Access grants', surface: 'vendor', description: 'Pinned assessment, canonical request, approval, provider effects, and revocation.', commandPrerequisite: 'Vendor Risk must publish a current grant command and reconciled provider state.' },
  { collection: 'cases', label: 'Linked Cases', surface: 'vendor', description: 'Vendor Assessment and Access Grant Case correlation and outcome.', commandPrerequisite: 'Case runtime must publish fresh authority, approval, and the exact Case command.' },
  { collection: 'operations', label: 'Grant effects', surface: 'vendor', description: 'Graph and Jira effect receipts, unknown outcomes, and reconciliation.', commandPrerequisite: 'Vendor Risk must publish a reconciliation command after both provider effects are known.' },
];

const surfaceDefaults: Record<Surface, string> = { studio: 'packages', catalog: 'packages', operations: 'cases', technical: 'readiness', vendor: 'vendor-assessments' };

export function routeForPath(path: string): { route: CollectionRoute; id?: string } {
  const [pathname = ''] = path.split('?');
  const parts = pathname.split('/').filter(Boolean);
  const surface = (parts[0] ?? 'studio') as Surface;
  const collection = parts[1] ?? surfaceDefaults[surface];
  const route = collectionRoutes.find((candidate) => candidate.surface === surface && candidate.collection === collection) ?? defaultRoute;
  return { route, ...(parts[2] === undefined ? {} : { id: parts[2] }) };
}

export function routeHref(route: CollectionRoute, id?: string): string {
  const base = `/${route.surface}/${route.collection}`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

export function routesForSurface(surface: Surface): readonly CollectionRoute[] {
  return collectionRoutes.filter((route) => route.surface === surface);
}
