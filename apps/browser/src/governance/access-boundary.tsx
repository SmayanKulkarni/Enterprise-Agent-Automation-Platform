import type { Navigate } from '../app-routes.js';

export function AccessBoundary({ navigate }: { navigate: Navigate }) {
  return (
    <section className="access-boundary">
      <div className="boundary-mark"><i /><i /></div>
      <p>Restricted</p>
      <h1>Governance is available to group admins.</h1>
      <span>Usage, approvals, health and logs across workspaces are shown to the admins of a workspace group. You can still run and review workflows in Solution Studio.</span>
      <div><button className="button" onClick={() => navigate('studio')}>Return to studio</button></div>
    </section>
  );
}
