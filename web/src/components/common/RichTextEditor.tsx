import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Palette,
  Strikethrough,
  Table,
  Underline,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SpectrumSwatch } from '@/components/common/SpectrumSwatch'
import { LABEL_TONE_VALUES, TONE_LABEL } from '@jojo/service/core/model'
import type { LabelTone } from '@jojo/service/core/model'
import { cn } from '@/lib/utils'

/**
 * Sizes map onto `fontSize` 1–7, the only scale the command understands.
 * Labelled by what they look like rather than by the number, which means
 * nothing to anyone.
 */
const SIZES = [
  { value: '2', label: 'Small' },
  { value: '3', label: 'Normal' },
  { value: '5', label: 'Large' },
  { value: '6', label: 'Huge' },
]

/**
 * The app's palette, as the literal hexes this toolbar has to have.
 *
 * Keyed by `LabelTone`, so the editor offers the same colours under the same
 * names as the keyword swatches — one palette, asked for in two places — and so
 * that adding a ninth colour is a compile error here until somebody picks its
 * ink, rather than a colour that quietly exists in one of the two pickers.
 *
 * The VALUES are not the `--kw-*` tokens and cannot be. `execCommand` takes a
 * colour rather than a class and writes it into the markup, where it stays put
 * while the theme flips underneath it — so each of these is a mid-tone measured
 * at 3:1 or better against BOTH panels and the well. The keyword tokens are
 * free of that constraint because they come in a light pair and a dark pair and
 * the stylesheet swaps them; these have to survive either. Cyan and Pink were
 * measured into the same band as the six that were already here (3.08–5.48:1).
 */
const TONE_INK: Record<LabelTone, string> = {
  gray: '#737373',
  teal: '#3c92c3',
  cyan: '#2f9bb0',
  green: '#449970',
  amber: '#aa842c',
  red: '#c96b64',
  pink: '#c77098',
  violet: '#8a6bbf',
}

const COLORS = [
  // Not "default colour": `execCommand` cannot undo one property, so the reset
  // swatch runs `removeFormat` and takes bold and italic with it. Labelled for
  // what it does rather than for where it sits.
  { name: 'Clear formatting', value: '' },
  ...LABEL_TONE_VALUES.map((tone) => ({ name: TONE_LABEL[tone], value: TONE_INK[tone] })),
]

/** Marks whose on/off state the toolbar reflects. */
const MARKS = [
  { cmd: 'bold', icon: Bold, label: 'Bold' },
  { cmd: 'italic', icon: Italic, label: 'Italic' },
  { cmd: 'underline', icon: Underline, label: 'Underline' },
  { cmd: 'strikeThrough', icon: Strikethrough, label: 'Strikethrough' },
] as const

const LISTS = [
  { cmd: 'insertUnorderedList', icon: List, label: 'Bullet list' },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
] as const

/**
 * A bare 3×3 grid. No inline styles: borders and padding come from the `.rte`
 * rules, which use the app's hairline token. An inline `border: 1px solid
 * currentColor` would win over the stylesheet and paint the grid in the text
 * colour — a heavy black cage that matches nothing else on the page.
 *
 * The trailing empty paragraph gives the caret somewhere to land after the
 * table; without it there is no way to type past a table at the end of a
 * document.
 */
const TABLE_HTML = `<table><tbody>${Array.from(
  { length: 3 },
  () => `<tr>${'<td><br></td>'.repeat(3)}</tr>`,
).join('')}</tbody></table><p><br></p>`

/**
 * A small rich-text editor.
 *
 * Built on `contenteditable` and `document.execCommand`. That API is formally
 * deprecated and worth knowing about — but it is implemented everywhere, and it
 * covers exactly this feature set in a few hundred bytes. The alternative is a
 * document-model editor (ProseMirror, Lexical) at ~100KB, which is the right
 * call when collaborative editing or a serialisable schema matter and the wrong
 * one for a formatting toolbar over a text field.
 *
 * `onChange` hands back HTML, and every field in this app stores plain text —
 * so a caller that persists must convert through `textFromHtml`, the way the
 * snippets tool and the file-note drawer do. Writing this straight into a
 * record puts `<span style="font-weight: bold;">` on every list and search
 * result that prints the field, because nothing outside this box renders HTML.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel = 'Snippet text',
  inlineOnly = false,
  onBlur,
  className,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  /**
   * Hide the two list buttons and the table button.
   *
   * For a field that stores INLINE formatting only. The application note keeps
   * bold, italic, underline, strikethrough, size and colour, and has nowhere to
   * put a table — so offering one and dissolving it on save would be the worst
   * of the three options. Default `false`, so the snippet editor, the file note
   * and the message draft are byte-identical to what they were.
   */
  inlineOnly?: boolean
  /**
   * Called when focus leaves the editing surface.
   *
   * For a field that saves when you click away rather than on a button. It
   * fires on the surface only — the toolbar buttons sit outside it, so pressing
   * Bold does not read as leaving.
   */
  onBlur?: () => void
  /**
   * What this field is, out loud. It was hardcoded to "Snippet text", so the
   * file note and the message draft both announced themselves as a snippet —
   * different fields with one wrong name between them. The default keeps the
   * snippets tool reading exactly as it did.
   */
  ariaLabel?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<Record<string, boolean>>({})

  /**
   * Only writes into the DOM when the incoming value differs from what is
   * already there. Assigning innerHTML on every render would drop the caret to
   * the start of the document on every keystroke.
   */
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== value) el.innerHTML = value
  }, [value])

  const refresh = useCallback(() => {
    const next: Record<string, boolean> = {}
    for (const { cmd } of MARKS) next[cmd] = document.queryCommandState(cmd)
    for (const { cmd } of LISTS) next[cmd] = document.queryCommandState(cmd)
    setActive(next)
  }, [])

  /**
   * The last selection made INSIDE this editor, kept for `exec` to put back.
   *
   * `el.focus()` restores a selection on its own when focus merely moved to a
   * toolbar button, which is why the marks have always worked. The colour
   * picker is not that: `<input type="color">` opens the operating system's own
   * panel, the page can lose focus entirely while it is up, and `change` may
   * not fire until it is dismissed — by which time the selection can be gone
   * and the colour would land on nothing, or on the caret, silently.
   *
   * A Range rather than offsets: the DOM under it does not change while a
   * colour is being chosen, and a live Range needs no arithmetic to be right.
   */
  const lastRange = useRef<Range | null>(null)

  useEffect(() => {
    const onSelect = () => {
      // Only when the caret is actually inside this editor, or the toolbar
      // would light up for selections elsewhere on the page.
      const sel = document.getSelection()
      if (sel && ref.current?.contains(sel.anchorNode)) {
        if (sel.rangeCount > 0) lastRange.current = sel.getRangeAt(0).cloneRange()
        refresh()
      }
    }
    document.addEventListener('selectionchange', onSelect)
    return () => document.removeEventListener('selectionchange', onSelect)
  }, [refresh])

  const exec = useCallback(
    (cmd: string, arg?: string) => {
      const el = ref.current
      if (!el) return
      // The command applies to the current selection, which is lost if the
      // toolbar button takes focus first.
      el.focus()
      /*
       * Put the selection back when focus came from somewhere that lost it.
       * Guarded on the range still being inside this editor: the value is only
       * ever written while it was, but the document may have been replaced
       * underneath it by a save in between.
       */
      const sel = document.getSelection()
      const range = lastRange.current
      if (sel && range && !el.contains(sel.anchorNode) && el.contains(range.commonAncestorContainer)) {
        sel.removeAllRanges()
        sel.addRange(range)
      }
      // Produces inline styles rather than <font> tags, which survive round
      // trips and respect the surrounding CSS.
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand(cmd, false, arg)
      onChange(el.innerHTML)
      refresh()
    },
    [onChange, refresh],
  )

  const btn =
    'grid size-7 shrink-0 cursor-pointer place-items-center rounded-sm text-text-2 transition-colors hover:bg-well hover:text-text-1'
  const btnOn = 'bg-accent-soft text-accent'

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-hairline bg-well px-1.5 py-1.5">
        <label className="sr-only" htmlFor="rte-size">
          Font size
        </label>
        <select
          id="rte-size"
          defaultValue="3"
          onChange={(e) => exec('fontSize', e.target.value)}
          className="cursor-pointer rounded-sm border border-hairline bg-panel px-1.5 py-1 text-xs text-text-2"
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <span aria-hidden className="mx-0.5 h-5 w-px bg-hairline" />

        {MARKS.map(({ cmd, icon: Icon, label }) => (
          <button
            key={cmd}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={!!active[cmd]}
            onClick={() => exec(cmd)}
            className={cn(btn, active[cmd] && btnOn)}
          >
            <Icon className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        ))}

        {!inlineOnly && <span aria-hidden className="mx-0.5 h-5 w-px bg-hairline" />}

        {!inlineOnly &&
          LISTS.map(({ cmd, icon: Icon, label }) => (
          <button
            key={cmd}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={!!active[cmd]}
            onClick={() => exec(cmd)}
            className={cn(btn, active[cmd] && btnOn)}
          >
              <Icon className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          ))}

        {!inlineOnly && (
          <button
            type="button"
            title="Insert table"
            aria-label="Insert table"
            onClick={() => exec('insertHTML', TABLE_HTML)}
            className={btn}
          >
            <Table className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        )}

        <Popover>
          <PopoverTrigger title="Text colour" aria-label="Text colour" className={btn}>
            <Palette className="size-3.5" strokeWidth={2} aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44">
            <div className="px-0.5 text-xs tracking-wide text-text-3 uppercase">Text colour</div>
            <div className="grid grid-cols-4 gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  title={c.name}
                  aria-label={c.name}
                  onClick={() => (c.value ? exec('foreColor', c.value) : exec('removeFormat'))}
                  className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline transition-transform hover:scale-110"
                  style={c.value ? { background: c.value } : undefined}
                >
                  {/* The reset swatch shows a slash rather than a colour. */}
                  {c.value ? null : <span className="text-xs text-text-3">—</span>}
                </button>
              ))}

              {/*
                * The ninth swatch: any colour at all.
                *
                * It persists, which is the part worth knowing. The eight are
                * matched back to their names when the note is saved; anything
                * else is kept as a hex on the span (`noteFromRuns` →
                * `NoteSpan.ink`), so a colour lifted off a logo with the
                * eyedropper is still there after a reload. What it is NOT is a
                * colour with a name — nothing else in jojo can refer to it.
                */}
              <SpectrumSwatch
                value={undefined}
                label="Any colour"
                className="size-7"
                onPick={(hex) => exec('foreColor', hex)}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onBlur={onBlur}
        onKeyUp={refresh}
        onMouseUp={refresh}
        className="rte min-h-[14rem] flex-1 overflow-y-auto rounded-b-md border border-t-0 border-hairline bg-panel px-3 py-2.5 text-sm outline-none focus-visible:border-accent-border"
      />
    </div>
  )
}
