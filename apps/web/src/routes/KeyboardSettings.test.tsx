import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { KeyboardSettings } from './KeyboardSettings.js';
import { PromptBox } from '../features/prompt/PromptBox.js';

describe('the keyboard setting and the chat box (SFT-300, SFT-301)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is shown in Settings, checked by default, and explains Enter, Ctrl+Enter and that it is saved on this device', () => {
    const html = renderToStaticMarkup(<KeyboardSettings />);
    expect(html).toContain('Press Enter to send my message');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('Ctrl+Enter');
    expect(html).toContain('this device only');
    expect(readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8')).toContain('<KeyboardSettings />');
  });

  it('shows the unchecked state and the new-line explanation when it was turned off', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'off', setItem: () => {} });
    const html = renderToStaticMarkup(<KeyboardSettings />);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('Enter adds a new line');
  });

  it('the chat box is described to assistive technology: the input names its hint and status, the hint says what Enter does, the buttons say what they do', () => {
    const html = renderToStaticMarkup(<PromptBox onSubmit={async () => {}} transcribe={async () => ''} />);
    expect(html).toContain('aria-label="Type an instruction"');
    expect(html).toContain('aria-describedby="prompt-hint prompt-status"');
    expect(html).toMatch(/<p id="prompt-hint" class="sr-only">Press Enter to send, Shift\+Enter for a new line\.<\/p>/);
    expect(html).toMatch(/<p id="prompt-status"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toContain('aria-label="Start dictation"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Send instruction"');
    expect(html).toContain('title="Send (Enter)"');
  });

  it('with the setting off the chat box says so in its hint and on the send button', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'off', setItem: () => {} });
    const html = renderToStaticMarkup(<PromptBox onSubmit={async () => {}} transcribe={async () => ''} />);
    expect(html).toContain('Press Ctrl+Enter or the Send button to send. Enter adds a new line.');
    expect(html).toContain('title="Send (Ctrl+Enter)"');
  });

  it('the hidden hint stays available to screen readers but takes no room on screen', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.sr-only\{[^}]*position:absolute[^}]*clip:rect\(0,0,0,0\)/);
    expect(css).not.toMatch(/\.sr-only\{[^}]*display:none/);
  });
});
