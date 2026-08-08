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
 * Mid-tone swatches, so a colour picked in one theme is still legible in the
 * other. The editor's own background flips with the theme but the colour set
 * here does not, and pale-on-white or dark-on-black would be unreadable half
 * the time. These are the pipeline stage colours, already measured at 3:1 or
 * better against both surfaces.
 */
const COLORS = [
  // Not "default colour": `execCommand` cannot undo one property, so the reset
  // swatch runs `removeFormat` and takes bold and italic with it. Labelled for
  // what it does rather than for where it sits.
  { name: 'Clear formatting', value: '' },
  { name: 'Grey', value: '#737373' },
  { name: 'Blue', value: '#3c92c3' },
  { name: 'Gold', value: '#aa842c' },
  { name: 'Violet', value: '#8a6bbf' },
  { name: 'Green', value: '#449970' },
  { name: 'Red', value: '#c96b64' },
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
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
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

  useEffect(() => {
    const onSelect = () => {
      // Only when the caret is actually inside this editor, or the toolbar
      // would light up for selections elsewhere on the page.
      const sel = document.getSelection()
      if (sel && ref.current?.contains(sel.anchorNode)) refresh()
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

        <span aria-hidden className="mx-0.5 h-5 w-px bg-hairline" />

        {LISTS.map(({ cmd, icon: Icon, label }) => (
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

        <button
          type="button"
          title="Insert table"
          aria-label="Insert table"
          onClick={() => exec('insertHTML', TABLE_HTML)}
          className={btn}
        >
          <Table className="size-3.5" strokeWidth={2} aria-hidden />
        </button>

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
        aria-label="Snippet text"
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onKeyUp={refresh}
        onMouseUp={refresh}
        className="rte min-h-[14rem] flex-1 overflow-y-auto rounded-b-md border border-t-0 border-hairline bg-panel px-3 py-2.5 text-sm outline-none focus-visible:border-accent-border"
      />
    </div>
  )
}
