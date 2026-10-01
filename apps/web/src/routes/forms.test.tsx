import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MailSettings } from './MailSettings.js';
import { SignIn } from './SignIn.js';

const buttonTag = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

describe('forms can be submitted', () => {
  it('the mailbox form has a real submit button', () => {
    const html = renderToStaticMarkup(<MailSettings onUpdated={async () => {}} />);
    expect(buttonTag(html, 'Test and save mailbox')).toContain('type="submit"');
  });

  it('the sign-in form has a real submit button, and its mode switch is not one', () => {
    const html = renderToStaticMarkup(<SignIn onSubmit={async () => {}} />);
    expect(buttonTag(html, 'Sign in')).toContain('type="submit"');
    expect(buttonTag(html, 'Create account')).toContain('type="button"');
  });

  // The shared Button defaults to type="button" so that it never submits a form by accident. Inside a <form>, a Button
  // that is meant to submit it must say so; this guards every screen against the same mistake (SFT-247 regression).
  it('every button inside a form either submits explicitly or does something on click', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const form of source.matchAll(/<form[\s\S]*?<\/form>/g)) {
        for (const tag of form[0].matchAll(/<Button\b[^>]*?>/g)) {
          if (!/type="(submit|button)"/.test(tag[0]) && !/onClick=/.test(tag[0])) offenders.push(`${file}: ${tag[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
