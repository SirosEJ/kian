import { useState } from 'react';
import { Card } from '../components/index.js';
import { enterHint, enterSends, setEnterSends } from '../features/prompt/enterToSend.js';

/** The keyboard choice for the chat box. Saved on this device and applied at once: no reload, no reinstall. */
export function KeyboardSettings() {
  const [on, setOn] = useState(enterSends);
  return <Card>
    <h3>Keyboard</h3>
    <label className="checkbox"><input type="checkbox" checked={on} onChange={event => { setOn(event.target.checked); setEnterSends(event.target.checked); }} />Press Enter to send my message</label>
    <p className="muted">{enterHint(on)} Ctrl+Enter (Cmd+Enter on a Mac) always sends. This choice is saved on this device only, so a phone and a computer can differ.</p>
  </Card>;
}
