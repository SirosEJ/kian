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
    expect(html).toContain('Trust and automate this task in future');
  });
});
