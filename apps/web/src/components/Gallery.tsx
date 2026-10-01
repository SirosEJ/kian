import { tokens, cssVar } from '../theme/index.js';
import { Alert, Button, Card, Logo, StatusBadge } from './index.js';

const hidden = new Set(['navy-950', 'navy-700', 'cyan-300', 'ice-100']);

/** Visual reference for the token-driven components. Open the app with `?components`; it needs no sign-in and shows no data. */
export function Gallery() {
  const palette = Object.keys(tokens.color.core).filter(name => !hidden.has(name));
  return <main className="card gallery">
    <h1>Components</h1>
    <p>Every colour, font, radius and space here comes from the brand tokens in <code>src/theme/tokens.json</code>.</p>

    <h2>Logo</h2>
    <Card><Logo variant="light" /></Card>
    <div className="on-navy"><Logo variant="dark" /></div>

    <h2>Palette</h2>
    <div className="swatches">{palette.map(name => <div key={name} className="swatch"><i style={{ background: cssVar(`palette-${name}`) }} /><b>{name}</b></div>)}</div>

    <h2>Typography</h2>
    <h1>Heading one, Fraunces</h1><h2>Heading two</h2><h3>Heading three</h3><h4>Heading four</h4>
    <p>Body text in Inter, with <a href="#components">a link</a> and <span className="muted">secondary text</span>.</p>

    <h2>Buttons</h2>
    <p>
      <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="destructive">Destructive</Button><Button variant="ghost">Ghost</Button><Button disabled>Disabled</Button>
    </p>

    <h2>Form controls</h2>
    <label>Email address<input type="email" placeholder="you@example.com" /></label>
    <label>Instruction<textarea rows={3} placeholder="Ask Kian to create a Jira story" /></label>
    <label>Calendar<select defaultValue=""><option value="">Select a calendar</option><option>Personal</option></select></label>

    <h2>Task status</h2>
    <p>{['proposed', 'queued', 'succeeded', 'failed', 'rejected', 'uncertain'].map(state => <span key={state}><StatusBadge state={state} />{' '}</span>)}</p>

    <h2>Messages</h2>
    <Alert tone="success">Connected. The mailbox accepted the test.</Alert>
    <Alert tone="warning">Check the recipient before approving.</Alert>
    <Alert tone="error">Could not connect. Check your details and try again.</Alert>
    <Alert tone="info">Kian did not create any tasks from that instruction.</Alert>
  </main>;
}
