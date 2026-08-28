/** Executive — one voice, eight specialists.
 *
 * OpenExecutive shape: a single coherent take backed by parallel helpers.
 * This brief teaches the existing harness that shape without a server.
 */

export const executiveWords = {
  chip: 'Executive',
  name: 'Ask the executive',
  note: 'One coherent take, backed by specialists working in parallel.',
} as const;

export type SpecialistId = 'cso' | 'cfo' | 'chro' | 'gc' | 'coo' | 'cmo' | 'cpo' | 'board';

export type Specialist = {
  id: SpecialistId;
  title: string;
  remit: string;
};

export const SPECIALISTS: readonly Specialist[] = [
  { id: 'cso', title: 'Chief Strategy Officer', remit: 'competitive analysis, M&A, market positioning, OKRs' },
  { id: 'cfo', title: 'Chief Financial Officer', remit: 'financial modelling, fundraising, unit economics, cash flow' },
  { id: 'chro', title: 'Chief HR / People Officer', remit: 'hiring, compensation, performance, culture' },
  { id: 'gc', title: 'General Counsel', remit: 'contracts, IP, employment basics, compliance' },
  { id: 'coo', title: 'Chief Operating Officer', remit: 'process design, vendor management, operational scaling' },
  { id: 'cmo', title: 'Chief Marketing Officer', remit: 'GTM strategy, brand, communications' },
  { id: 'cpo', title: 'Chief Product Officer', remit: 'roadmap, prioritisation, product strategy' },
  { id: 'board', title: 'Board Communications Director', remit: 'board decks, investor relations, governance' },
] as const;

export const SPECIALIST_IDS: readonly SpecialistId[] = SPECIALISTS.map((one) => one.id);

export function executiveBrief(): string {
  const list = SPECIALISTS.map((one) => `- ${one.title} (${one.id}): ${one.remit}`).join('\n');
  return [
    'Treat this as an executive take, one coherent voice, not a change.',
    '',
    'You are the executive. Back your answer with specialists where it helps, then synthesise.',
    '',
    'Specialists you may consult (use only those the question needs):',
    list,
    '',
    '1. Decide which specialists this question needs, one is fine, three is common, eight is rare. Name them before you start.',
    '2. Send a helper after each perspective, several at the same time rather than one after another, all in the same reply, so they work in parallel. Give each a whole question it can answer without the others.',
    '3. Begin each helper\'s work with a line reading "Looking into: " and a few plain words for that perspective.',
    '4. Read this project as well as the web where it helps. What the code already does is evidence.',
    '5. Synthesise into one executive response in your own voice. Do not expose the specialist structure, do not paste eight memos. Surface disagreements as trade-offs.',
    '6. End with a short numbered list of next steps the person can actually take.',
    '',
    'Change nothing until I have read it and said so.',
  ].join('\n');
}

export const EXECUTIVE_BRIEF = executiveBrief();

export function asExecutive(asked: string): string {
  const said = asked.trim();
  if (said === '') return said;
  return `${executiveBrief()}\n\nThe question:\n\n${said}`;
}
