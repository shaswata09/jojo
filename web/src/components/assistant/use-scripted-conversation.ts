import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { fromReactKey, shouldSend } from '@/lib/composer-keys'
import { vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useVault } from '@jojo/service/react/use-vault'
import { COPIED_MS, scriptById, scriptedExchange } from './scripts'
import type { Message } from './scripts'

/** The scripted panel's conversation: the canned exchange, copy, save to snippets, clear. */
export function useScriptedConversation() {
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const nextId = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { addSnippet } = useVault()
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  /**
   * The unconnected path, and the only one this page had for its whole life.
   *
   * No model, no request, no delay: the reply was chosen before the question
   * finished rendering, and a thinking pause would be theatre. Every message it
   * produces carries `scriptId`, which is what puts the badge on it — see the
   * row in `ScriptedMessage`, where the badge is keyed to the message rather
   * than to the branch that drew it.
   */
  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    const at = nextId.current
    nextId.current += 2
    setPrompt('')
    setMessages((prev) => [...prev, ...scriptedExchange(at, clean)])
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(prompt)
  }

  /*
   * Enter sends; Shift+Enter is left to the textarea, which puts in the newline
   * itself. `shouldSend` also refuses an Enter that an input method is using to
   * pick a candidate — see `lib/composer-keys.ts`, where the rule is tested.
   */
  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSend(fromReactKey(event))) return
    event.preventDefault()
    onSubmit(event)
  }

  const copy = async (id: string, text: string) => {
    clearTimeout(copyTimer.current)
    try {
      // Unavailable outside a secure context, and refused outright by some
      // browsers — hence the visible failure rather than a confirmation for
      // something that did not happen.
      await navigator.clipboard.writeText(text)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
    }
    setCopiedId(id)
    copyTimer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  const saveToSnippets = (message: Message) => {
    const script = scriptById(message.scriptId)
    const snippet = addSnippet({ title: script.title, tag: script.tag, body: message.text })
    toast({
      title: 'Saved to snippets',
      description: `${snippet.title} · filed under ${snippet.tag}`,
      action: {
        label: 'Open vault',
        onClick: () => navigate(vaultPath({ tool: 'snippets' })),
      },
    })
  }

  /** A conversation of canned replies is the cheapest record in the app — an
   *  undo toast, no confirmation. */
  const clearConversation = () => {
    const previous = messages
    setMessages([])
    toast({
      title: 'Conversation cleared',
      description: `${previous.length} messages`,
      tone: 'danger',
      action: { label: 'Undo', onClick: () => setMessages(previous) },
    })
  }

  return {
    messages,
    prompt,
    setPrompt,
    copiedId,
    copyFailed,
    send,
    onSubmit,
    onComposerKey,
    copy,
    saveToSnippets,
    clearConversation,
  }
}
