import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import Annotate from './Annotate';
import Attachments, { type Attachment } from './Attachments';
import LinkFigma from './LinkFigma';
import { LINK_FIGMA } from '../lib/linkfigma';
import Asking from './Asking';
import type { HowFar } from '../agent/guard/policy';
import HowToWork, { type Plans } from './HowToWork';
import Room from './Room';
import type { Turn } from '../lib/thread';
import ThinkingWith from './ThinkingWith';
import type { ConnectionState, ModelChoice, Room as RoomState, Skill, ThinkingLevel, Workflow } from '../lib/ipc';
import {
  NOT_DRAGGING,
  carriesSomething,
  deeper,
  dragging,
  extensionOf,
  figmaLink,
  readDropped,
  readableSize,
  shallower,
  modelInFront,
  readsPictures,
  PICTURE_WORDS,
} from '../lib/attachments';
import {
  SAYING,
  around,
  canSay,
  earsIn,
  fold,
  gather,
  readSaid,
  wordsFor,
  type Around,
  type Listening,
} from '../lib/saying';
import './Composer.css';

type Props = {
  onSend: (text: string) => void;
  /** True while the run is waiting between steps because somebody asked it to. */
  waiting?: boolean;
  /** Hold the run between steps, or let it go on. */
  onWait?: (on: boolean) => void;
  /** Called instead of send while a turn is running: the same button in its
   *  other state (BACKLOG A1). Send and Stop are one affordance in opposite
   *  states — swapping in place is why the layout does not jump. */
  onStop?: () => void;
  /** A second thought while a turn is running is a choice, asked quietly:
   *  interrupt the run with this message, or queue it behind the turn. */
  onQueue?: (text: string, mode: 'steer' | 'followUp') => void;
  placeholder?: string;
  autoFocus?: boolean;
  busy?: boolean;
  /** What is currently attached. Held by whoever owns the conversation, because
   *  an attachment outlives the keystroke that produced it. */
  attachments?: readonly Attachment[];
  /** Whether Figma has been linked. Only consulted once somebody has actually
   *  put a Figma file in the box — until then it is nobody's business. */
  figmaLinked?: boolean;
  /** Link it, from here. Absent in the preview and the gallery. */
  onLinkFigma?: () => Promise<string | null>;
  onAttachmentsChange?: (next: readonly Attachment[]) => void;
  /**
   * A sentence put into the box from outside it — one of the examples on the
   * first screen.
   *
   * It seeds the field and focuses it, and then it is an ordinary draft: it can
   * be edited, cleared, or ignored. It is never sent on somebody's behalf. An
   * example is a starting point, and a click that spends money on a sentence
   * the user did not write is the exact surprise this product exists not to
   * have.
   */
  draft?: string;
  /** Who can think for this computer, for the chip in the row below the box. */
  connection?: ConnectionState | null;
  /** Whether a message gets a looking-around pass first. */
  plans?: Plans;
  onPlans?: (plans: Plans) => void;
  onSelectModel?: (choice: ModelChoice) => void;
  /** The model asked about the hard parts, or null for one model doing all of
   *  it. Chosen from inside the model chip, not beside it. */
  advisor?: ModelChoice | null;
  onAdvisor?: (choice: ModelChoice | null) => void;
  advisorThinking?: ThinkingLevel | null;
  onAdvisorThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  onConnect?: () => void;
  /** How long the chosen model should take before answering. */
  onThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  /** Whether a drop anywhere in the window lands here. On by default: people
   *  drag at the picture they are talking about, not at a box. */
  anywhere?: boolean;
  /** Whether to offer to listen. On by default, and only ever shown where this
   *  computer can actually do it. */
  outLoud?: boolean;
  /** How full this conversation is, for the ring in the row. Null before the
   *  model has answered once. */
  room?: RoomState | null;
  /** The conversation, for the split behind the ring. */
  turns?: readonly Turn[];
  /** True while it is being shortened. */
  tidying?: boolean;
  /** Shorten it now, by hand. */
  onTidy?: () => void;
  /** How far it may go before it stops and asks. */
  howFar?: HowFar;
  onHowFar?: (howFar: HowFar) => void;
  /** The native preview yields while one of the composer popovers is open. */
  onComposerPopoverOpenChange?: (open: boolean) => void;
  /** Ways of working the project has written down. `/` at the start of a
   *  message offers them, the way `@` offers skills. */
  workflows?: readonly Workflow[];
  /** Skills the open project can use. `@` turns this quiet library into an
   * explicit per-turn choice instead of a command someone has to memorise. */
  skills?: readonly Skill[];
};

/** What the file picker offers, in the same order a designer would think of
 *  them. The drop and paste paths accept the same things and say so themselves
 *  — see src/lib/attachments.ts. */
const ACCEPT = 'image/*,application/pdf';

let counter = 0;
function newId(): string {
  counter += 1;
  return `attachment-${counter}`;
}

/* Only the composer that mounted last answers a drop on the window: two of them
   listening would attach the same picture twice. */
const answering: symbol[] = [];

// Grow with content rather than scrolling a fixed box.
//
// Growth used to be felt, not seen: one line taller meant everything above the
// box jumped up by exactly that much. The window is one scroller and growing
// the box adds to its content height without touching scrollTop — so the fix
// is to hand the delta back to the scroll position whenever the reader is
// pinned to the bottom anyway. Scrolled away reading, nothing moves.
const MAX_HEIGHT = 220;
/** How close to the bottom counts as "reading the latest". A pixel of slack
 *  absorbs rounding; more than this and somebody is genuinely scrolled up. */
const PINNED_SLACK = 48;

function resize(el: HTMLTextAreaElement | null): void {
  if (el === null) return;
  const before = el.offsetHeight;
  el.style.height = 'auto';
  const next = Math.min(el.scrollHeight, MAX_HEIGHT);
  const delta = next - before;
  el.style.height = `${next}px`;
  if (delta === 0) return;
  const pane = el.closest('.app');
  if (pane === null || !(pane instanceof HTMLElement)) return;
  const fromBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
  if (fromBottom <= PINNED_SLACK) pane.scrollTop += delta;
}

/**
 * The one thing on the first screen.
 *
 * It takes a Figma link, a screenshot or a photo of a sketch, which is what its
 * own hint has always claimed and what, until now, it could not do. Five ways
 * in, because people reach for different ones and none of them is obscure:
 * drop something anywhere on the window, paste a screenshot straight out of the
 * clipboard, paste a Figma URL, press the paperclip and pick something, or say
 * out loud what you want changed.
 *
 * A pasted Figma link becomes a link chip rather than a file, because it is a
 * place and not a copy — and because turning your URL into text you then have
 * to look at is the sort of small dishonesty this composer has already been
 * guilty of once.
 */
export default function Composer({
  figmaLinked,
  onLinkFigma,
  onSend,
  onStop,
  onQueue,
  placeholder,
  autoFocus,
  busy,
  attachments = [],
  onAttachmentsChange,
  draft,
  connection,
  plans,
  onPlans,
  onSelectModel,
  advisor,
  onAdvisor,
  advisorThinking,
  onAdvisorThinking,
  onConnect,
  onThinking,
  anywhere = true,
  outLoud = true,
  room,
  turns,
  tidying,
  onTidy,
  howFar,
  onHowFar,
  onComposerPopoverOpenChange,
  skills = [],
  workflows,
  waiting,
  onWait,
}: Props) {
  const [value, setValue] = useState('');
  const [dropping, setDropping] = useState(false);
  /* Asked once, and again only if listening turns out not to work here. A
     control that is visible and does nothing is worse than no control. */
  const [canListen, setCanListen] = useState(() => canSay(globalThis));
  /** Why the last thing was turned away. One sentence, and never the user's
   *  fault. Cleared as soon as anything else happens. */
  const [refused, setRefused] = useState<string | null>(null);
  /** The picture open in the drawing surface, by its chip id. */
  const [drawingOn, setDrawingOn] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  /** Where the helper was put, once fetched. Undefined until somebody asks. */
  const [steps, setSteps] = useState<string | null | undefined>(undefined);
  /** What was drawn on the last picture, in sentences. It goes out with the
   *  message, because a box with no words beside it is half a thought. */
  const [drawn, setDrawn] = useState<string | null>(null);
  const [mention, setMention] = useState<{ from: number; query: string } | null>(null);
  const [command, setCommand] = useState<{ query: string } | null>(null);

  /* A picture in the box that the model in front cannot read. Worked out here
     rather than after a turn is spent: the provider's own refusal arrives as a
     wall of JSON several seconds later, and by then the money is gone. Only
     when the catalogue positively says it cannot — an entry that says nothing
     is left to the provider to answer. */
  const blindToPictures =
    readsPictures(connection) === false && attachments.some((one) => one.kind === 'image');
  const cannotRead = blindToPictures
    ? PICTURE_WORDS.cannotRead(modelInFront(connection)?.label ?? 'This model')
    : null;
  const [mentionAt, setMentionAt] = useState(0);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Drag events fire for every child element the pointer crosses, so a depth
     count is the difference between a calm drop state and one that flickers on
     and off as the cursor moves over the placeholder text. */
  const depth = useRef(NOT_DRAGGING);

  const attachedRef = useRef(attachments);
  attachedRef.current = attachments;

  /* A slash at the start of a message is a command. Only at the start: a slash
     inside a sentence is a slash, and a menu that opens on one is a menu that
     opens while somebody is writing a path. */
  const commands = command === null
    ? []
    : (workflows ?? [])
        .filter((one) => `${one.name} ${one.description}`.toLowerCase().includes(command.query.toLowerCase()))
        .slice(0, 6);

  const chooseCommand = (workflow: Workflow): void => {
    const after = value.slice(areaRef.current?.selectionStart ?? value.length);
    const next = `${workflow.command} ${after}`;
    setValue(next);
    setCaret(workflow.command.length + 1);
    setCommand(null);
    setMentionAt(0);
  };

  const mentions = mention === null ? [] : skills
    .filter((skill) => `${skill.name} ${skill.handle}`.toLowerCase().includes(mention.query.toLowerCase()))
    .slice(0, 6);

  const chooseMention = (skill: Skill) => {
    const current = mention;
    if (current === null) return;
    const before = value.slice(0, current.from);
    const after = value.slice(areaRef.current?.selectionStart ?? value.length);
    const next = `${before}@${skill.handle} ${after}`;
    const caretAt = before.length + skill.handle.length + 2;
    setValue(next);
    setCaret(caretAt);
    setMention(null);
    setMentionAt(0);
  };

  const change = useCallback(
    (next: readonly Attachment[]) => {
      onAttachmentsChange?.(next);
    },
    [onAttachmentsChange],
  );

  /* Seeded from outside, with the cursor left at the end of it so the next
     keystroke continues the sentence rather than landing in the middle of it. */
  useEffect(() => {
    if (draft === undefined || draft === '') return;
    setValue(draft);
    const field = areaRef.current;
    if (field === null) return;
    field.focus();
    field.setSelectionRange(draft.length, draft.length);
    resize(field);
  }, [draft]);

  /** Everything that arrives — dropped, pasted or picked — comes through here,
   *  so all three answer to the same rules and say the same sentences. */
  const land = useCallback(
    (payload: { files?: readonly File[]; text?: string }) => {
      const landed = readDropped<File>(payload);
      const added: Attachment[] = landed.taken.map(({ file, kind }) => ({
        id: newId(),
        kind,
        name: file.name,
        note: [extensionOf(file.name).toUpperCase(), readableSize(file.size)]
          .filter(Boolean)
          .join(' · '),
        preview: kind === 'image' ? URL.createObjectURL(file) : undefined,
        file,
      }));

      const link = landed.link;
      if (link !== null && !attachedRef.current.some((item) => item.url === link.url)) {
        added.push({ id: newId(), kind: 'figma', name: link.name, note: link.what, url: link.url });
      }

      setRefused(landed.because);
      if (added.length > 0) change([...attachedRef.current, ...added]);
    },
    [change],
  );

  const take = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      land({ files });
    },
    [land],
  );

  const takeLink = useCallback(
    (text: string): boolean => {
      const link = figmaLink(text);
      if (link === null) return false;
      if (attachedRef.current.some((item) => item.url === link.url)) return true;
      setRefused(null);
      change([
        ...attachedRef.current,
        { id: newId(), kind: 'figma', name: link.name, note: link.what, url: link.url },
      ]);
      return true;
    },
    [change],
  );

  const remove = useCallback(
    (id: string) => {
      const going = attachedRef.current.find((item) => item.id === id);
      if (going?.preview !== undefined) URL.revokeObjectURL(going.preview);
      setRefused(null);
      change(attachedRef.current.filter((item) => item.id !== id));
    },
    [change],
  );

  const submit = (mode?: 'steer' | 'followUp') => {
    const text = value.trim();
    if (!text) return;
    // Said rather than sent. The picture stays in the box, so switching model
    // and pressing again is the whole of the fix.
    if (blindToPictures) {
      setRefused(cannotRead);
      return;
    }
    ears.current?.stop();
    const said = drawn === null ? text : `${text}\n\n${drawn}`;
    // The marks travel as words as well as pixels: coordinates the model can
    // act on, beside a picture it can see.
    if (mode !== undefined && onQueue !== undefined) {
      onQueue(said, mode);
    } else {
      onSend(said);
    }
    setDrawn(null);
    setValue('');
    setRefused(null);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (command !== null && commands.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionAt((was) =>
          e.key === 'ArrowDown'
            ? (was + 1) % commands.length
            : (was + commands.length - 1) % commands.length,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = commands[mentionAt] ?? commands[0];
        if (chosen !== undefined) chooseCommand(chosen);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCommand(null);
        return;
      }
    }
    if (mention !== null && mentions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionAt((was) => (e.key === 'ArrowDown' ? (was + 1) % mentions.length : (was + mentions.length - 1) % mentions.length));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = mentions[mentionAt] ?? mentions[0];
        if (chosen !== undefined) chooseMention(chosen);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Escape' && listening) {
      e.preventDefault();
      stopListening();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // While a turn is running and words are in the box, Enter does not guess
      // between interrupting and queueing — the two quiet buttons beside the
      // box are the choice. (BACKLOG A1's Stop still owns the empty box.)
      if (busy && onQueue !== undefined && value.trim() !== '') return;
      submit();
    }
  };

  /* A screenshot on the clipboard arrives as a file with no name worth reading;
     a Figma URL arrives as text. Both are things somebody meant to attach, and
     neither should land in the middle of a sentence as characters. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      take(files);
      return;
    }
    if (takeLink(e.clipboardData.getData('text/plain'))) e.preventDefault();
  };

  /**
   * The whole window is the target.
   *
   * People drag at the thing they are talking about — the picture, the panel,
   * the screen they want changed — and not at a box six hundred pixels below
   * it. So anywhere counts, and the window says so plainly for as long as
   * something is being carried over it.
   *
   * It also has to be here rather than nowhere: dropping a file on a window
   * that is not expecting one makes the browser open it, and in a desktop app
   * that is the interface replaced by a photograph with no way back.
   */
  useEffect(() => {
    if (!anywhere) return;

    const mine = Symbol('composer');
    answering.push(mine);
    const ours = () => answering[answering.length - 1] === mine;

    const show = () => {
      if (ours()) setDropping(dragging(depth.current));
    };
    const clear = () => {
      depth.current = NOT_DRAGGING;
      show();
    };
    const carried = (event: globalThis.DragEvent) =>
      carriesSomething(Array.from(event.dataTransfer?.types ?? []));

    const enter = (event: globalThis.DragEvent) => {
      if (!carried(event)) return;
      event.preventDefault();
      depth.current = deeper(depth.current);
      show();
    };

    const over = (event: globalThis.DragEvent) => {
      if (!carried(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    };

    const leave = () => {
      depth.current = shallower(depth.current);
      show();
    };

    const drop = (event: globalThis.DragEvent) => {
      // A dragged word landing in the box is ordinary editing; leave it alone.
      if (!carried(event)) return;
      event.preventDefault();
      clear();
      if (!ours()) return;

      const carrying = event.dataTransfer;
      const dragged =
        carrying === null ? '' : carrying.getData('text/uri-list') || carrying.getData('text/plain');
      land({ files: Array.from(carrying?.files ?? []), text: dragged });
      areaRef.current?.focus();
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', drop);
    // A drag carried off to another app and released there never comes back.
    window.addEventListener('blur', clear);

    return () => {
      const at = answering.lastIndexOf(mine);
      if (at !== -1) answering.splice(at, 1);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', drop);
      window.removeEventListener('blur', clear);
    };
  }, [anywhere, land]);

  /**
   * Saying it instead of typing it.
   *
   * A change to how something looks is easier said than written — "warmer, and
   * give the whole thing more air" is one breath. The listening is the
   * browser's own, on this machine; what it hears lands in the box as ordinary
   * text with the cursor after it, and waits there to be read and edited.
   * Nothing goes anywhere until somebody presses send.
   */
  const ears = useRef<Listening | null>(null);
  const place = useRef<Around>({ before: '', after: '' });
  const [listening, setListening] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);

  useEffect(() => {
    if (caret === null) return;
    const field = areaRef.current;
    if (field === null) return;
    field.setSelectionRange(caret, caret);
    resize(field);
    setCaret(null);
  }, [caret]);

  useEffect(
    () => () => {
      ears.current?.abort();
      ears.current = null;
    },
    [],
  );

  const stopListening = useCallback(() => {
    ears.current?.stop();
    setListening(false);
  }, []);

  const listen = () => {
    if (listening) {
      stopListening();
      return;
    }

    const Ears = earsIn(globalThis);
    if (Ears === null) {
      setCanListen(false);
      return;
    }

    const field = areaRef.current;
    place.current = around(value, field?.selectionStart, field?.selectionEnd);

    const listener = new Ears();
    listener.continuous = true;
    listener.interimResults = true;
    listener.lang = navigator?.language ?? 'en-US';
    listener.onresult = (event) => {
      const { text, caret: at } = fold(place.current, gather(readSaid(event)));
      setValue(text);
      setCaret(at);
    };
    listener.onerror = (event) => {
      const { because, keepOffering } = wordsFor(event?.error);
      if (because !== null) setRefused(because);
      if (!keepOffering) setCanListen(false);
      setListening(false);
    };
    listener.onend = () => setListening(false);

    ears.current = listener;
    setRefused(null);
    setListening(true);
    try {
      listener.start();
    } catch {
      // Already going. Nothing to say about it.
    }
    field?.focus();
  };

  /** Stop is what the button does only when there is nothing written. With
   *  words in the box the same press sends them, whatever is running. */
  const stopping = busy === true && onStop !== undefined && value.trim() === '';

  /** The picture being drawn on, if the chip is still there. Read rather than
   *  held, so removing a chip mid-draw closes the surface instead of stranding
   *  it over a picture that no longer exists. */
  const open = attachments.find((one) => one.id === drawingOn && one.kind === 'image') ?? null;

  return (
    <div className={`composer ${dropping ? 'composer--dropping' : ''}`}>
      <Attachments items={attachments} onRemove={remove} onDrawOn={setDrawingOn} />

      {/* The moment somebody shows us a Figma file is the moment to say we
          cannot open it yet — not a screen they would have to know to go and
          find. It says nothing at all until there is a Figma file in the box,
          and nothing ever again once it is linked. */}
      {figmaLinked === false && onLinkFigma !== undefined &&
      attachments.some((one) => one.kind === 'figma') ? (
        <div className="composer__letin">
          <p className="composer__letinsays">
            {LINK_FIGMA.cannot}
            {steps === undefined ? (
              <button
                type="button"
                className="composer__letindo"
                disabled={linking}
                onClick={() => {
                  setLinking(true);
                  void onLinkFigma()
                    .then((where) => setSteps(where))
                    .finally(() => setLinking(false));
                }}
              >
                {linking ? LINK_FIGMA.linking : LINK_FIGMA.link}
              </button>
            ) : null}
          </p>
          {steps === undefined ? null : <LinkFigma manifest={steps} />}
        </div>
      ) : null}

      {/* Drawn on rather than described. The marked picture replaces the one it
          came from, so the chip stays the same chip and the message still has
          exactly one of it. */}
      {open === null ? null : (
        <Annotate
          source={open.preview ?? ''}
          name={open.name}
          onClose={() => setDrawingOn(null)}
          onDone={(marked) => {
            change(
              attachedRef.current.map((one) =>
                one.id === open.id
                  ? {
                      ...one,
                      name: marked.file.name,
                      note: ['PNG', readableSize(marked.file.size)].join(' · '),
                      preview: marked.dataUrl,
                      file: marked.file,
                    }
                  : one,
              ),
            );
            setDrawn(marked.said);
            setDrawingOn(null);
            areaRef.current?.focus();
          }}
        />
      )}

      <textarea
        ref={areaRef}
        className="composer__input scroll--auto"
        value={value}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Describe what you want, or paste a screenshot of it'}
        onChange={(e) => {
          // Typing is taking over: stop listening rather than let the next
          // thing heard land on top of what was just written.
          if (listening) stopListening();
          setValue(e.target.value);
          const cursor = e.target.selectionStart;
          const before = e.target.value.slice(0, cursor);
          const match = before.match(/(?:^|\s)@([a-z0-9-]*)$/i);
          const query = match?.[1];
          setMention(query === undefined ? null : { from: cursor - (query.length + 1), query });
          // The same characters a command can be named with, so the menu never
          // opens on something that could not match anything.
          const slash = before.match(/^\/([a-z0-9-]*)$/i);
          setCommand(slash === null ? null : { query: slash[1] ?? '' });
          setMentionAt(0);
          resize(e.target);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        aria-label="What do you want to make?"
      />

      {command === null || commands.length === 0 ? null : (
        <div className="composer__skills" role="listbox" aria-label="Ways of working">
          <p><span>/</span> A way of working this project has written down</p>
          {commands.map((one, index) => (
            <button
              key={one.command}
              type="button"
              role="option"
              aria-selected={index === mentionAt}
              className={index === mentionAt ? 'composer__skill--active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCommand(one)}
            >
              <span>
                <strong>{one.command}</strong>
                <small>{one.description}</small>
              </span>
              <em>{one.source === 'project' ? 'This project' : 'Your computer'}</em>
            </button>
          ))}
        </div>
      )}

      {mention === null || mentions.length === 0 ? null : (
        <div className="composer__skills" role="listbox" aria-label="Skills">
          <p><span>@</span> Use a skill for this turn</p>
          {mentions.map((skill, index) => (
            <button key={skill.id} type="button" role="option" aria-selected={index === mentionAt} className={index === mentionAt ? 'composer__skill--active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(skill)}>
              <span><strong>{skill.name}</strong><small>@{skill.handle}</small></span><em>{skill.source === 'project' ? 'This project' : 'Your computer'}</em>
            </button>
          ))}
        </div>
      )}

      <div className="composer__row">
        <button
          type="button"
          className="composer__attach"
          onClick={() => fileRef.current?.click()}
          aria-label="Add a picture or a file"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M9.6 4.2 5.2 8.6a1.9 1.9 0 0 0 2.7 2.7l4.7-4.7a3.2 3.2 0 0 0-4.5-4.5L3.3 6.9a4.5 4.5 0 0 0 6.4 6.4l3.6-3.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Beside the paperclip, because it is the same kind of offer: another
            way of getting what is in your head into the box. Absent entirely
            where this computer cannot listen. */}
        {!outLoud || !canListen ? null : (
          <button
            type="button"
            className={`composer__say ${listening ? 'composer__say--on' : ''}`}
            onClick={listen}
            aria-label={listening ? SAYING.stop : SAYING.start}
            aria-pressed={listening}
          >
            {listening ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="3.5" fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="6"
                  y="1.75"
                  width="4"
                  height="7.5"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        )}

        {plans === undefined || onPlans === undefined ? null : (
          <HowToWork plans={plans} onPlans={onPlans} />
        )}

        {onHowFar === undefined ? null : (
          <Asking
            howFar={howFar ?? 'asking'}
            onHowFar={onHowFar}
            onOpenChange={onComposerPopoverOpenChange}
          />
        )}

        {onSelectModel === undefined || onConnect === undefined ? null : (
          <ThinkingWith
            state={connection ?? null}
            onSelect={onSelectModel}
            onConnect={onConnect}
            onThinking={onThinking}
            onOpenChange={onComposerPopoverOpenChange}
            advisor={advisor ?? null}
            {...(onAdvisor === undefined ? {} : { onAdvisor })}
            {...(advisorThinking == null ? {} : { advisorThinking })}
            {...(onAdvisorThinking === undefined ? {} : { onAdvisorThinking })}
          />
        )}

        {/* Only when there is something to say. What used to live here was a
            line teaching Enter and Shift+Enter — a sentence everybody has read
            once and nobody needs on screen forever. The room the conversation
            has left is worth that space; nothing is. */}
        <span className={`composer__hint ${listening ? 'composer__hint--loud' : ''}`}>
          {listening ? SAYING.listening : ''}
        </span>

        {/* How full the conversation is, and the one thing to do about it. On
            the right-hand end, beside Send: it belongs to the message about to
            be written, not to the housekeeping on the left. */}
        <Room
          room={room ?? null}
          tidying={tidying === true}
          busy={busy}
          {...(turns === undefined ? {} : { turns })}
          {...(onTidy === undefined ? {} : { onTidy })}
        />

        {/* The same button in two states (BACKLOG A1): an arrow that sends, or a
            square that stops. They swap in place so the layout does not jump
            when a turn begins, and the Stop half is never disabled — a run that
            has been started must always be stoppable, even with an empty box.

            Words in the box while a turn is running are a second thought, and a
            second thought is a choice: queue it behind the run, or interrupt
            with it. Two quiet buttons, asked once, never guessed. */}
        {/* Wait, beside Stop and never instead of it. Stop ends the run; this
            holds it between steps so the machine is yours for a moment, and
            letting go picks up from wherever things now are. */}
        {stopping && onWait !== undefined ? (
          <button
            type="button"
            className={`composer__wait ${waiting === true ? 'composer__wait--on' : ''}`}
            onClick={() => onWait(waiting !== true)}
          >
            {waiting === true ? 'Go on' : 'Wait'}
          </button>
        ) : null}
        {busy && onQueue !== undefined && value.trim() !== '' ? (
          <span className="composer__queue">
            <button
              type="button"
              className="composer__queuebtn composer__queuebtn--safe"
              onClick={() => submit('followUp')}
            >
              Queue
            </button>
            <button
              type="button"
              className="composer__queuebtn"
              onClick={() => submit('steer')}
            >
              Interrupt
            </button>
          </span>
        ) : (
          <button
            className="composer__send"
            onClick={stopping ? onStop : () => submit()}
            disabled={stopping ? false : !value.trim()}
            aria-label={stopping ? 'Stop' : busy ? 'Send when it is free' : 'Send'}
          >
            {stopping ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="1.5"
                  y="1.5"
                  width="9"
                  height="9"
                  rx="1.5"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 12.75V3.5M8 3.5 4 7.5M8 3.5l4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Always in the document, empty most of the time. A live region that is
          added at the same moment as its first sentence is a live region a
          screen reader has no reason to be listening to yet. */}
      <p className="composer__refused" role="status">
        {refused ?? cannotRead}
      </p>

      <input
        ref={fileRef}
        className="composer__file"
        type="file"
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        onChange={(e) => {
          take(Array.from(e.target.files ?? []));
          // So the same file can be picked twice in a row.
          e.target.value = '';
          areaRef.current?.focus();
        }}
      />

      {/* Calm: the app dims a little and one line appears in the middle of it.
          No dashed rectangle, nothing that bounces, and one state for the whole
          window rather than a target that has to be aimed at. It goes over
          everything, so it goes at the end of the document rather than inside a
          box that something else might sit on top of. */}
      {!anywhere || typeof document === 'undefined'
        ? null
        : createPortal(
            <div className={`anywhere ${dropping ? 'anywhere--on' : ''}`} aria-hidden="true">
              <div className="anywhere__card">
                <span className="anywhere__what">Drop it anywhere</span>
                <span className="anywhere__note">A picture, a PDF, or a Figma link</span>
              </div>
            </div>,
            document.body,
          )}
    </div>
  );
}
