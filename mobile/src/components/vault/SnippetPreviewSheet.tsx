import { ScrollView, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Marked, MarksLegend } from '@/components/ui/Marked'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { stripMarks } from '@jojo/service/core/marks'
import { useCopy } from '@/lib/use-copy'
import { space } from '@/theme/tokens'

/**
 * A snippet, read where it was found. The phone's half of web's
 * `vault/SnippetPreviewDialog.tsx`, and the same argument: the cards on the
 * record say what each tailored document IS, and the words live here.
 *
 * A sheet rather than a dialog because that is what a modal is on this app —
 * the same surface the menus, the pickers and the editors use — and `tall`
 * because a tailored CV is pages and a sheet sized to its content would open
 * as a scrap.
 */

export type PreviewSnippet = {
  readonly id: string
  readonly title: string
  readonly body: string
  /** 'CV · from Raghunathan-CV.md · gemma_4_31b · today'. Under the title. */
  readonly subtitle: string
  /** Whether the body carries the marks a model wrote. See `core/marks.ts`. */
  readonly marked: boolean
}

export function SnippetPreviewSheet({
  snippet,
  onClose,
}: {
  snippet: PreviewSnippet | null
  onClose: () => void
}) {
  const { copy, isCopied } = useCopy()
  if (snippet === null) return null

  return (
    <Sheet
      open
      onClose={onClose}
      title={snippet.title}
      description={snippet.subtitle}
      size="tall"
      footer={
        <View style={{ gap: space[2] }}>
          {snippet.marked ? <MarksLegend /> : null}
          <Button
            label={isCopied(snippet.id) ? 'Copied' : 'Copy'}
            icon={isCopied(snippet.id) ? 'check' : 'copy'}
            variant="outline"
            full
            onPress={() => {
              // Marks are for reading, not for pasting.
              void copy(snippet.marked ? stripMarks(snippet.body) : snippet.body, snippet.id)
            }}
          />
        </View>
      }
    >
      <ScrollView style={{ maxHeight: '100%' }} contentContainerStyle={{ paddingBottom: space[3] }}>
        {snippet.marked ? (
          <Marked body={snippet.body} />
        ) : (
          <Txt size="sm" tone="secondary">
            {snippet.body}
          </Txt>
        )}
      </ScrollView>
    </Sheet>
  )
}
