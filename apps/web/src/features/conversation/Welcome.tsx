import { Button } from '../../components/index.js';

export const EXAMPLES = [
  'Book a meeting with Sam on Friday afternoon',
  'Create a Jira story to review the onboarding flow',
  'Write an email to a colleague about next week',
  'What can you do?',
] as const;

/** The empty chat: a short welcome and a few things to try, each sent as a message when tapped. */
export function Welcome({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  return <div className="welcome">
    <h2>Hi, how can I help?</h2>
    <p className="muted">Tell me what you need. I will ask if anything is unclear, and nothing happens until you approve it.</p>
    <div className="examples">{EXAMPLES.map(text => <Button key={text} variant="ghost" disabled={disabled} onClick={() => onPick(text)}>{text}</Button>)}</div>
  </div>;
}
