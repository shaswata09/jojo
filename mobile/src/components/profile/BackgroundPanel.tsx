import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { BACKGROUND_LABEL, BACKGROUND_ORDER } from '@jojo/service/core/model'
import type { Background, BackgroundKind } from '@jojo/service/core/model'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import { useToast } from '@/lib/toast-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What jojo knows about the person, grouped and listed.
 *
 * The phone's half of web's `profile/BackgroundPanel.tsx`. The reasoning is
 * there: the entries had nowhere to be seen and no way to be corrected, and a
 * wrong claim about somebody's career in their own records that they cannot
 * delete is worse than no record at all.
 *
 * ONE DIFFERENCE, and it is not cosmetic: deleting asks first. A trash icon
 * that appears on hover is a deliberate act with a pointer; the same icon under
 * a thumb on a scrolling list is not, and the Undo in a toast is easy to scroll
 * past on a phone. So this confirms and web does not.
 */

function Entry({ entry, onDelete }: { entry: Background; onDelete: () => void }) {
  const c = useColors()
  const [open, setOpen] = useState(false)
  const bullets = entry.highlights ?? []

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.hairline, paddingVertical: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, gap: space[0.5] }}>
          <Txt size="sm">
            <Txt size="sm" weight="medium">
              {entry.title}
            </Txt>
            {entry.where === undefined ? '' : ` · ${entry.where}`}
            {entry.period === undefined ? '' : ` · ${entry.period}`}
          </Txt>
          {entry.detail !== undefined && (
            <Txt size="sm" tone="secondary">
              {entry.detail}
            </Txt>
          )}

          {bullets.length > 0 && (
            <>
              <Pressable
                onPress={() => setOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}
              >
                <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={c.text3} />
                <Txt size="xs" tone="muted">
                  {bullets.length === 1 ? '1 detail' : `${String(bullets.length)} details`}
                </Txt>
              </Pressable>
              {open && (
                <View style={{ gap: space[0.5], paddingLeft: space[3] }}>
                  {bullets.map((b) => (
                    <Txt key={b} size="sm" tone="secondary">
                      • {b}
                    </Txt>
                  ))}
                </View>
              )}
            </>
          )}

          {entry.source !== undefined && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
              <Feather name="file-text" size={11} color={c.text3} />
              <Txt size="xs" tone="muted">
                read from a document
              </Txt>
            </View>
          )}
        </View>

        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${entry.title}`}
          hitSlop={10}
        >
          <Feather name="trash-2" size={16} color={c.text3} />
        </Pressable>
      </View>
    </View>
  )
}

export function BackgroundPanel() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()
  const { toast } = useToast()
  const [confirming, setConfirming] = useState<Background | null>(null)

  const all = projections.background(graph)

  const groups = useMemo(() => {
    const by = new Map<BackgroundKind, Background[]>()
    for (const entry of all) {
      const held = by.get(entry.kind)
      if (held) held.push(entry)
      else by.set(entry.kind, [entry])
    }
    return BACKGROUND_ORDER.flatMap((kind) => {
      const rows = by.get(kind)
      return rows === undefined ? [] : [{ kind, rows }]
    })
  }, [all])

  const remove = (entry: Background) => {
    const result = run('profile.background.delete', { id: entry.id })
    setConfirming(null)
    toast({
      title: result.ok ? `${entry.title} removed` : 'That did not save',
      ...(result.ok ? {} : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
  }

  return (
    <Panel>
      <PanelTitle
        hint={
          all.length === 0
            ? undefined
            : `${String(all.length)} recorded · what a posting is weighed against`
        }
      >
        Your background
      </PanelTitle>

      {all.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="Nothing recorded yet"
          description="Put your CV, a research or teaching statement in the Vault and jojo will offer to read it. What it finds is shown to you before anything is saved."
        />
      ) : (
        <View style={{ gap: space[5] }}>
          {groups.map(({ kind, rows }) => (
            <View key={kind}>
              <Txt size="xs" tone="muted" uppercase>
                {BACKGROUND_LABEL[kind]}
              </Txt>
              {rows.map((entry) => (
                <Entry key={entry.id} entry={entry} onDelete={() => setConfirming(entry)} />
              ))}
            </View>
          ))}
        </View>
      )}

      <ConfirmSheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === null ? '' : `Remove ${confirming.title}?`}
        description="It goes from your background, so postings stop being weighed against it. The document it came from is untouched."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => {
          if (confirming !== null) remove(confirming)
        }}
      />
    </Panel>
  )
}
