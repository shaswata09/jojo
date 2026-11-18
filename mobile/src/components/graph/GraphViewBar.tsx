import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Segment } from '@/components/ui/Segment'
import { Txt } from '@/components/ui/Text'
import { GROUP_DIMENSIONS } from '@/lib/graph-view'
import type { GroupDimension } from '@/lib/graph-view'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

export type GraphMode = 'overview' | 'focus'

/**
 * The strip above a large store's canvas: which picture (Overview, Focus),
 * what the overview groups by, in focus the trail of records focused on, and
 * what the selected record can do here — the web's `GraphViewBar`, stacked
 * into rows for a phone's width.
 *
 * The trail is a row, so a right-to-left layout reverses it with everything
 * else; its chevrons turn round through `Icon`.
 */
export function GraphViewBar({
  mode,
  onMode,
  by,
  onBy,
  trail,
  labelOf,
  onCrumb,
  onBack,
}: {
  mode: GraphMode
  onMode: (mode: GraphMode) => void
  by: GroupDimension
  onBy: (by: GroupDimension) => void
  /** Focused records, oldest first; the last is at the centre. */
  trail: readonly string[]
  labelOf: (id: string) => string
  onCrumb: (index: number) => void
  onBack: () => void
}) {
  const { t } = useTranslation('screens')
  const c = useColors()

  return (
    <View style={styles.bar}>
      <Segment
        label={t('graph.view.mode.label')}
        value={mode}
        onChange={onMode}
        options={[
          { value: 'overview', label: t('graph.view.mode.overview') },
          { value: 'focus', label: t('graph.view.mode.focus') },
        ]}
      />

      {mode === 'overview' ? (
        <View style={styles.row}>
          <Txt size="xs" tone="muted">
            {t('graph.view.groupBy.label')}
          </Txt>
          <Segment
            scroll
            label={t('graph.view.groupBy.label')}
            value={by}
            onChange={onBy}
            options={GROUP_DIMENSIONS.map((dimension) => ({
              value: dimension,
              label: t(`graph.view.groupBy.${dimension}`),
            }))}
            style={styles.fill}
          />
        </View>
      ) : null}

      {mode === 'focus' && trail.length > 0 ? (
        <View style={styles.trailRow}>
          <Button
            label={t('graph.view.back')}
            icon="arrow-left"
            variant="ghost"
            size="sm"
            onPress={onBack}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel={t('graph.view.trail')}
            contentContainerStyle={styles.trail}
          >
            {trail.map((id, index) => {
              const last = index === trail.length - 1
              return (
                <View key={`${id}-${index}`} style={styles.crumb}>
                  {index > 0 ? <Icon name="chevron-right" size={12} color={c.text3} /> : null}
                  {last ? (
                    <Txt size="xs" weight="medium" numberOfLines={1} style={styles.crumbText}>
                      {labelOf(id)}
                    </Txt>
                  ) : (
                    <Pressable accessibilityRole="link" onPress={() => onCrumb(index)} hitSlop={10}>
                      <Txt size="xs" tone="secondary" numberOfLines={1} style={styles.crumbText}>
                        {labelOf(id)}
                      </Txt>
                    </Pressable>
                  )}
                </View>
              )
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

export type GraphAction = {
  label: string
  canFocus: boolean
  onFocus: () => void
  /** Only in focus, for a record that is not the centre. */
  expand?: { expanded: boolean; onToggle: () => void }
}

/**
 * What the selected record can do here: focus on it, and in focus expand it.
 * Under the picture rather than above it, so the row appearing when a record
 * is tapped does not move the picture out from under the finger.
 */
export function GraphActions({ action }: { action: GraphAction | null }) {
  const { t } = useTranslation('screens')
  if (!action) return null
  return (
    <View style={styles.actions}>
      {action.canFocus ? (
        <Button
          label={t('graph.view.focusOn', { label: action.label })}
          icon="crosshair"
          variant="outline"
          size="sm"
          onPress={action.onFocus}
          style={styles.shrink}
        />
      ) : null}
      {action.expand ? (
        <Button
          label={action.expand.expanded ? t('graph.view.collapse') : t('graph.view.expand')}
          icon={action.expand.expanded ? 'minimize-2' : 'maximize-2'}
          variant="outline"
          size="sm"
          onPress={action.expand.onToggle}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { gap: space[2], marginBottom: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  fill: { flexShrink: 1 },
  trailRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  trail: { alignItems: 'center', gap: space[1], paddingEnd: space[2] },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  crumbText: { maxWidth: 180 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  shrink: { flexShrink: 1, maxWidth: '100%' },
})
