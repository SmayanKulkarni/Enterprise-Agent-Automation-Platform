import type { ReactNode } from 'react';
import { Dialog } from '../ui.js';

interface Props { surface: 'studio' | 'governance'; onStart: () => void; onDismiss: () => void; signIn: ReactNode }

export function DemoPrompt({ surface, onStart, onDismiss, signIn }: Props) {
  return <Dialog labelledBy="demo-prompt-title" onClose={onDismiss} className="demo-dialog">
    <h2 id="demo-prompt-title">Just looking around?</h2>
    <p>{surface === 'studio' ? 'Studio' : 'Governance'} needs a sign-in. If you are reviewing this project, open the demo instead: a read-only PR gate workflow with sample data, no account, and none of the owner's credentials.</p>
    <div className="dialog-actions">
      <button className="button-secondary" onClick={onDismiss}>Not now</button>
      {signIn}
      <button className="button" onClick={onStart}>Start demo</button>
    </div>
  </Dialog>;
}
