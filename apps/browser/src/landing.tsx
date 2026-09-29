import { useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { gsap, motionAllowed, useGSAP } from './motion.js';
import { useThemeName } from './theme.js';
import DotGrid from './react-bits/DotGrid.js';
import Magnet from './react-bits/Magnet.js';
import SplitText from './react-bits/SplitText.js';
import { scrollBehavior, type Navigate } from './app-routes.js';
import { Dialog } from './ui.js';

export function Landing({ navigate, authEnabled }: { navigate: Navigate; authEnabled: boolean }) {
  const [activeCapability, setActiveCapability] = useState(0);
  const [drawer, setDrawer] = useState<'studio' | 'governance'>();
  const opener = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [motion] = useState(motionAllowed);
  const dark = useThemeName() === 'dark';
  const capabilities = [
    { title: 'Compose the work', text: 'Map decisions, tools, and human checkpoints on one inspectable canvas.', stat: '7 live step types' },
    { title: 'Bring your harness', text: 'Attach skills, remote connectors, or stdio MCP servers without reshaping the workflow.', stat: 'Certified per workspace' },
    { title: 'Operate with evidence', text: 'Give admins trace-level oversight while operators see only the signals needed to act.', stat: 'Run History for every run' },
  ];
  const active = capabilities[activeCapability]!;
  useGSAP(() => {
    if (!motion) return;
    gsap.from('.hero-item', { y: 22, opacity: 0, duration: .7, ease: 'power3.out', stagger: .12, delay: .35 });
    gsap.from('.hero-product-wrap', { y: 60, opacity: 0, duration: 1.1, ease: 'power3.out', delay: .25 });
    gsap.to('.hero-product-wrap', { y: -10, duration: 3.2, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.4 });
    const reveal = (selector: string, vars: gsap.TweenVars = {}) => gsap.utils.toArray<HTMLElement>(selector).forEach((element) => gsap.from(element, { y: 44, opacity: 0, duration: .8, ease: 'power3.out', scrollTrigger: { trigger: element, start: 'top 88%', once: true }, ...vars }));
    reveal('.proof-strip', { y: 0 });
    reveal('.section-heading');
    reveal('.capability-grid > article');
    reveal('.capability-accordion > h2');
    reveal('.accordion-layout');
    reveal('.landing-cta');
    gsap.from('.line-chart i', { scaleY: 0, transformOrigin: 'bottom', duration: .7, ease: 'power3.out', stagger: .05, scrollTrigger: { trigger: '.line-chart', start: 'top 90%', once: true } });
  }, { scope: stage, revertOnUpdate: false });
  useGSAP(() => { if (motion) gsap.fromTo('.detail-art i', { scale: .82, opacity: 0 }, { scale: 1, opacity: 1, duration: .5, ease: 'back.out(1.6)', stagger: .08, clearProps: 'transform,opacity' }); }, { dependencies: [activeCapability], scope: stage });
  const openDrawer = (next: 'studio' | 'governance', event: ReactMouseEvent<HTMLButtonElement>) => { opener.current = event.currentTarget; setDrawer(next); };
  const closeDrawer = () => setDrawer(undefined);
  return <div className="landing" ref={stage}><section className="hero-stage">{motion && <DotGrid className="hero-dots" baseColor={dark ? '#262d26' : '#d3d8cf'} activeColor={dark ? '#b8ef3b' : '#789f1d'} />}<div className="hero page-shell"><div className="hero-copy"><p className="eyebrow hero-item"><i className="eyebrow-dot" />Agent operations, under control</p><SplitText tag="h1" className="hero-title" text="Build AI workflows your team can actually operate." animate={motion} delay={70} /><p className="hero-deck hero-item">Design the workflow, attach its tools, and know what happened after every run.</p><div className="hero-actions hero-item"><Magnet padding={70} magnetStrength={4} disabled={!motion}><button className="button" onClick={() => navigate('studio')}>Open the studio</button></Magnet><button className="link-button" onClick={() => document.getElementById('platform')?.scrollIntoView({ behavior: scrollBehavior() })}>See how it works <span>↘</span></button></div><ul className="hero-facts hero-item"><li>7 live step types</li><li>Certified per workspace</li><li>Run History for every run</li></ul></div><WorkflowPreview /></div></section>
  <section className="proof-strip" aria-label="Built with"><div className="marquee-track"><span>MCP</span><span>Clerk</span><span>OpenRouter</span><span>Signed webhooks</span><span>Azure SQL</span><span aria-hidden="true">MCP</span><span aria-hidden="true">Clerk</span><span aria-hidden="true">OpenRouter</span><span aria-hidden="true">Signed webhooks</span><span aria-hidden="true">Azure SQL</span></div></section>
  <section id="platform" className="capability-section page-shell"><div className="section-heading"><h2>One surface for building.<br />One for knowing.</h2><p>Operators get a focused workspace. Admins get the evidence needed to keep every automation accountable.</p></div><div className="capability-grid"><article className="capability-visual studio-visual" role="img" aria-label="Example workflow: a Request input step feeds an Agent that reasons about it, which then calls a Resolve tool."><div className="mini-toolbar"><span>Support resolution</span><b>Example draft</b></div><div className="mini-canvas"><div className="mini-node n1"><small>Input</small><strong>Request</strong></div><div className="mini-node n2 active"><small>Agent</small><strong>Reason</strong></div><div className="mini-node n3"><small>Tool</small><strong>Resolve</strong></div><i className="mini-line l1" /><i className="mini-line l2" /></div></article><article className="capability-copy"><span className="index">01</span><h3>Solution Studio</h3><p>Configure instructions, skills, MCP servers, connectors, policies, and approvals without losing sight of the actual flow.</p><button className="inline-link" onClick={(event) => openDrawer('studio', event)}>How Studio works <span>→</span></button></article><article className="capability-copy governance-copy"><span className="index">02</span><h3>Governance</h3><p>Review the authenticated fixture preview for example usage, latency, failures, cost, and access signals.</p><button className="inline-link" onClick={(event) => openDrawer('governance', event)}>How Governance works <span>→</span></button></article><article className="capability-visual governance-visual"><div className="metric-big"><span>Example success rate</span><strong>97.4%</strong><small>Fixture preview</small></div><div className="line-chart" aria-label="Example success rate trend">{[32,40,35,54,49,61,58,73,69,82,88,91].map((height,index) => <i key={index} style={{ height: `${height}%` }} />)}</div></article></div></section>
  <section className="capability-accordion page-shell"><h2>Designed around the hard parts.</h2><div className="accordion-layout"><div className="accordion-list">{capabilities.map((capability,index) => <button key={capability.title} className={activeCapability === index ? 'active' : ''} aria-expanded={activeCapability === index} aria-controls="capability-detail" onClick={() => setActiveCapability(index)}><span>0{index + 1}</span><strong>{capability.title}</strong><i aria-hidden="true">+</i></button>)}</div><div className="accordion-detail" id="capability-detail"><p>{active.text}</p><strong>{active.stat}</strong><div className={`detail-art art-${activeCapability}`} aria-hidden="true"><i /><i /><i /></div></div></div></section>
  <section className="landing-cta page-shell"><div><p>Start with the work you already know.</p><h2>Make the next workflow visible from the first step.</h2></div><button className="button button-light" onClick={() => navigate('studio')}>Build a workflow</button></section>{drawer && <LandingDrawer surface={drawer} navigate={navigate} close={closeDrawer} opener={opener} authEnabled={authEnabled} />}<Footer navigate={navigate} authEnabled={authEnabled} /></div>;
}

const previewWidth = 116;
const previewHeight = 62;
const previewNodes = [
  { kind: 'trigger', label: 'Trigger', title: 'Ticket created', note: 'Example webhook', x: 6, y: 64 },
  { kind: 'memory', label: 'Memory', title: 'Recall history', note: 'Scoped, cited', x: 130, y: 160 },
  { kind: 'agent', label: 'Agent', title: 'Assess request', note: 'Example · 3 skills', x: 254, y: 64 },
  { kind: 'mcp', label: 'Action', title: 'Issue refund', note: 'Needs approval', x: 378, y: 160 },
] as const;
const previewEdges = previewNodes.slice(1).map((node, index) => {
  const from = previewNodes[index]!;
  const startX = from.x + previewWidth;
  const startY = from.y + previewHeight / 2;
  return `M ${startX} ${startY} C ${startX + 12} ${startY}, ${node.x - 12} ${node.y + previewHeight / 2}, ${node.x} ${node.y + previewHeight / 2}`;
});

export function WorkflowPreview() {
  const product = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!motionAllowed()) return;
    const nodes = gsap.utils.toArray<SVGGElement>('.pv-node');
    const run = gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 1.2 });
    nodes.forEach((node, index) => run.to(node, { '--live': 1, duration: .3 }, index * .8).to(node, { '--live': 0, duration: .5 }, index * .8 + .8));
    const tiltX = gsap.quickTo(product.current, 'rotateX', { duration: .6, ease: 'power3.out' });
    const tiltY = gsap.quickTo(product.current, 'rotateY', { duration: .6, ease: 'power3.out' });
    gsap.set(product.current, { rotateY: -3, rotateX: 1 });
    const move = (event: PointerEvent) => { tiltY(-3 + (event.clientX / window.innerWidth - .5) * 8); tiltX(1 - (event.clientY / window.innerHeight - .5) * 6); };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, { scope: product });
  return <div className="hero-product-wrap" ref={product}><div className="hero-product" role="img" aria-label="Example workflow: a Ticket created webhook starts a Recall history memory step, an Assess request agent uses it, and an Issue refund action waits for approval."><div className="window-bar"><span className="window-dots"><i /><i /><i /></span><span>Example workflow / Refund triage</span><b>Example</b></div><div className="preview-body"><aside><strong>Workflow</strong><span className="selected">Canvas</span><span>Harness</span><span>Tests</span><span>Versions</span></aside><div className="preview-canvas"><svg className="preview-svg" viewBox="0 0 500 300" aria-hidden="true">{previewEdges.map((path) => <path key={path} className="pv-edge" d={path} />)}{previewNodes.map((node) => <g key={node.title} className="pv-node" data-kind={node.kind} transform={`translate(${node.x} ${node.y})`}><rect className="pv-card" width={previewWidth} height={previewHeight} rx="9" /><rect className="pv-bar" x="0" y="11" width="3" height="40" rx="1.5" /><text className="pv-kind" x="14" y="18">{node.label.toUpperCase()}</text><text className="pv-title" x="14" y="35">{node.title}</text><text className="pv-note" x="14" y="50">{node.note}</text><circle className="pv-port" cx="0" cy={previewHeight / 2} r="3.5" /><circle className="pv-port" cx={previewWidth} cy={previewHeight / 2} r="3.5" /></g>)}</svg><div className="run-toast"><i /> Example run: 2.8s</div></div><aside className="preview-inspector"><strong>Harness</strong><label>Model<span>Example model</span></label><label>Memory<span>Scoped recall</span></label><label>Policy<span>Human approval</span></label></aside></div></div></div>;
}

function LandingDrawer({ surface, navigate, close, opener, authEnabled }: { surface: 'studio' | 'governance'; navigate: Navigate; close: () => void; opener: RefObject<HTMLButtonElement | null>; authEnabled: boolean }) {
  const content = surface === 'studio' ? { title: 'Solution Studio', purpose: 'Author a workflow as an inspectable graph before saving a revision.', first: 'Start with a Trigger, then connect the steps that handle the work.', visible: 'You will see the canvas, node settings, saved revision state, checks, and published run evidence.', action: 'Open Solution Studio' } : { title: 'Governance fixture preview', purpose: 'Review the shape of governance information without claiming live operational data.', first: 'Open the authenticated fixture preview to inspect its example portfolio and trace view.', visible: 'You will see fixture-only metrics, example service health, workflow rows, and a trace drawer.', action: 'Open Governance preview' };
  const close2 = () => { close(); requestAnimationFrame(() => opener.current?.focus()); };
  return <Dialog labelledBy="landing-drawer-title" onClose={close2} className={`landing-drawer ${surface}`}><div className="drawer-heading"><div><small>Product guide</small><h2 id="landing-drawer-title">{content.title}</h2></div><button onClick={close2} aria-label="Close guide">×</button></div><dl><div><dt>Purpose</dt><dd>{content.purpose}</dd></div><div><dt>First action</dt><dd>{content.first}</dd></div><div><dt>Visible information</dt><dd>{content.visible}</dd></div></dl><button className="button drawer-action" onClick={() => { close(); navigate(surface); }}>{content.action}</button></Dialog>;
}

export function Footer({ navigate, authEnabled }: { navigate: Navigate; authEnabled: boolean }) { return <footer className="footer page-shell"><button className="wordmark" onClick={() => navigate('home')}><span className="brand-mark"><i /><i /><i /></span><span>threadline</span></button><p>AI workflow infrastructure for teams that need proof, not promises.</p><nav><button onClick={() => navigate('studio')}>Studio</button><button onClick={() => navigate('governance')}>Governance preview</button></nav><small>© 2026 Threadline Systems</small></footer>; }
