import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskReview } from './TaskReview.js';

describe('task review', () => {
  it('shows action details and independent approve/reject choices', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id:'a',action:'email.send',state:'proposed',destination:'solmaz@example.com',connectionId:'mail-1',parameters:{subject:'Agenda',body:'Hello'},uncertainties:[] }} onChange={()=>{}} />);
    expect(html).toContain('Agenda');
    expect(html).toContain('solmaz@example.com');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('Always do this without asking: send email to solmaz@example.com');
    expect(html).toContain('You can stop it any time in Settings');
  });

  it('offers no trust option for changes to existing items, only the reason', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id:'u',action:'calendar.update',state:'proposed',destination:'primary',connectionId:'cal',parameters:{eventId:'e1'},uncertainties:[] }} onChange={()=>{}} />);
    expect(html).toContain('Changes to existing items always need your approval.');
    expect(html).not.toContain('Always do this without asking');
    expect(html).not.toContain('type="checkbox"');
  });
});

