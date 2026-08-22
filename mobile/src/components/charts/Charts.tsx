import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Circle, G, Line, Path, Polygon } from 'react-native-svg'
import { PIE_VIEWBOX, pieSlices } from '@jojo/service/core/pie'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/* --------------------------------- meter --------------------------------- */

/**
 * A proportional bar on a recessed track.
 *
 * The one form the funnel, the pipeline breakdown and the frequency chart all
 * reduce to. Length encodes magnitude, so the fill is a single hue and the
 * figure beside it carries the meaning — a bar that changed colour per row
 * would be spending colour on something length already says.
 */
export function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  const c = useColors()
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <View style={[styles.track, { backgroundColor: c.well, borderColor: c.hairline }]}>
      <View style={[styles.fill, { backgroundColor: color, width: `${pct * 100}%` }]} />
    </View>
  )
}

/* --------------------------------- donut --------------------------------- */

export type Slice = { label: string; value: number; color: string }

/**
 * Part-to-whole, as a ring.
 *
 * A sequential ramp rather than four distinct hues: shares of a total are one
 * quantity split up, and four soft hues could not be told apart in the dark
 * band anyway.
 */
export function Donut({
  slices,
  size = 148,
  thickness = 22,
  centerValue,
  centerLabel,
}: {
  slices: Slice[]
  size?: number
  thickness?: number
  centerValue?: string
  centerLabel?: string
}) {
  const c = useColors()
  const total = slices.reduce((n, s) => n + s.value, 0)
  const r = (size - thickness) / 2
  const circumference = 2 * Math.PI * r

  let offset = 0

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={c.well}
            strokeWidth={thickness}
            fill="none"
          />
          {total > 0
            ? slices.map((s) => {
                const share = s.value / total
                const dash = share * circumference
                const node = (
                  <Circle
                    key={s.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={s.color}
                    strokeWidth={thickness}
                    fill="none"
                    // The 2px gap is what keeps two adjacent ramp steps from
                    // reading as one wide band.
                    strokeDasharray={`${Math.max(dash - 2, 0)} ${circumference}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                  />
                )
                offset += dash
                return node
              })
            : null}
        </G>
      </Svg>

      {centerValue ? (
        <View style={styles.donutCenter} pointerEvents="none">
          <Txt size="xl" weight="semibold">
            {centerValue}
          </Txt>
          {centerLabel ? (
            <Txt size="xs" tone="muted">
              {centerLabel}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/* --------------------------------- radar --------------------------------- */

/* ---------------------------------- pie ---------------------------------- */

export type PieDatum = { key: string; label: string; value: number; color: string }

/**
 * A pie, and a legend that doubles as the value table.
 *
 * The wedge geometry is `@jojo/service/core/pie`, shared with the web — which
 * renders the identical `d` strings through a browser `<svg>`. Only the colours
 * and the touch targets are per-platform, which is the split the whole service
 * layer is organised around: the arithmetic cannot disagree between the two
 * apps because there is only one copy of it.
 *
 * The legend earns its place twice over here. A pie cannot be read to a number,
 * so the count and the percentage sit beside it — and on a phone the wedges are
 * small, so the row is the reliable target and the wedge is the shortcut.
 */
export function Pie({
  data,
  size = 148,
  onSelect,
}: {
  data: PieDatum[]
  size?: number
  /** Called with the datum's key, from either the wedge or its legend row. */
  onSelect?: (key: string) => void
}) {
  const c = useColors()
  const slices = pieSlices(data)
  const total = data.reduce((n, d) => n + d.value, 0)
  const byKey = new Map(slices.map((slice) => [slice.key, slice]))

  return (
    <View style={styles.pieRow}>
      <Svg width={size} height={size} viewBox={PIE_VIEWBOX}>
        {slices.map((slice) => {
          const datum = data.find((d) => d.key === slice.key)
          return (
            <Path
              key={slice.key}
              d={slice.path}
              fill={datum?.color ?? c.text3}
              // The card's own surface divides the wedges, so the pie reads as
              // one shape rather than as six that happen to touch.
              stroke={c.panel}
              strokeWidth={1.5}
              onPress={onSelect ? () => onSelect(slice.key) : undefined}
            />
          )
        })}
      </Svg>

      <View style={s.fill}>
        {data.map((datum) => {
          const slice = byKey.get(datum.key)
          const empty = slice === undefined
          return (
            <Pressable
              key={datum.key}
              accessibilityRole="button"
              accessibilityLabel={`${datum.label}, ${String(datum.value)}${
                empty ? '' : `, ${String(slice.percent)}%`
              }`}
              // A stage holding nothing keeps its row — the six are a fixed
              // vocabulary and a legend that reordered itself as records moved
              // would be unreadable — but there is nothing to go and look at.
              disabled={empty || !onSelect}
              onPress={onSelect ? () => onSelect(datum.key) : undefined}
              style={({ pressed }) => [
                styles.pieLegendRow,
                pressed && !empty ? { backgroundColor: c.rowHover } : null,
              ]}
            >
              <View
                style={[
                  styles.pieSwatch,
                  {
                    backgroundColor: empty ? 'transparent' : datum.color,
                    borderColor: datum.color,
                  },
                ]}
              />
              <Txt size="sm" tone={empty ? 'muted' : 'secondary'} style={s.fill} numberOfLines={1}>
                {datum.label}
              </Txt>
              <Txt size="sm" weight="medium" mono>
                {datum.value}
              </Txt>
              <Txt size="xs" tone="muted" mono style={styles.piePercent}>
                {total > 0 ? (slice?.percent ?? 0) : 0}%
              </Txt>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export type RadarSeries = { label: string; color: string; values: number[] }

/**
 * One data point compared across several variables — strengths and weaknesses
 * at a glance, which is the only job radar does better than a bar chart.
 *
 * Values are 0–100. Axis names are drawn outside the web, positioned by angle
 * so they never sit on top of the shape.
 */
export function Radar({
  axes,
  series,
  size = 240,
}: {
  axes: string[]
  series: RadarSeries[]
  size?: number
}) {
  const c = useColors()
  const pad = 34
  const r = (size - pad * 2) / 2
  const cx = size / 2
  const cy = size / 2
  const n = axes.length

  const point = (i: number, value: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    const d = (Math.max(0, Math.min(100, value)) / 100) * r
    return [cx + Math.cos(angle) * d, cy + Math.sin(angle) * d] as const
  }

  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <Svg width={size} height={size}>
        {rings.map((k) => (
          <Polygon
            key={k}
            points={axes
              .map((_, i) => {
                const angle = (Math.PI * 2 * i) / n - Math.PI / 2
                return `${cx + Math.cos(angle) * r * k},${cy + Math.sin(angle) * r * k}`
              })
              .join(' ')}
            fill="none"
            stroke={c.hairline}
            strokeWidth={1}
          />
        ))}

        {axes.map((_, i) => {
          const [x, y] = point(i, 100)
          return <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={c.hairline} strokeWidth={1} />
        })}

        {series.map((s) => (
          <Polygon
            key={s.label}
            points={s.values.map((v, i) => point(i, v).join(',')).join(' ')}
            fill={s.color}
            fillOpacity={0.16}
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
      </Svg>

      {axes.map((axis, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2
        const x = cx + Math.cos(angle) * (r + 16)
        const y = cy + Math.sin(angle) * (r + 14)
        return (
          <View
            key={axis}
            pointerEvents="none"
            style={[styles.axisLabel, { left: x - 44, top: y - 8 }]}
          >
            <Txt size="xs" tone="muted" center numberOfLines={1}>
              {axis}
            </Txt>
          </View>
        )
      })}
    </View>
  )
}

/* -------------------------------- legend --------------------------------- */

/**
 * A chart key whose rows switch their series off.
 *
 * A swatch and a plain label, never a coloured pill: colour on a pill is
 * reserved for the user's own keywords, and this one is a legend.
 */
export function ChartLegend({
  items,
  isHidden,
  onToggle,
}: {
  items: { key: string; label: string; color: string }[]
  isHidden: (key: string) => boolean
  onToggle: (key: string) => void
}) {
  const c = useColors()
  return (
    <View style={styles.legend}>
      {items.map((item) => {
        const off = isHidden(item.key)
        return (
          <Pressable
            key={item.key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !off }}
            onPress={() => onToggle(item.key)}
            style={({ pressed }) => [
              styles.legendRow,
              { backgroundColor: pressed ? c.rowHover : 'transparent' },
            ]}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: off ? 'transparent' : item.color, borderColor: item.color },
              ]}
            />
            <Txt size="sm" tone={off ? 'muted' : 'secondary'} style={off ? s.struck : undefined}>
              {item.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/* ------------------------------ stacked bars ----------------------------- */

export type StackedBar = { label: string; parts: { key: string; value: number; color: string }[] }

/**
 * Applications over time, split by role.
 *
 * Stacked rather than grouped: the question the chart answers is "how much did
 * I send", and the split is the secondary read. Grouped bars at five series and
 * twelve buckets is sixty bars on a 360px screen.
 */
export function StackedBars({ bars, height = 132 }: { bars: StackedBar[]; height?: number }) {
  const c = useColors()
  const max = Math.max(1, ...bars.map((b) => b.parts.reduce((n, p) => n + p.value, 0)))

  return (
    <View>
      <View style={[styles.bars, { height }]}>
        {bars.map((bar) => {
          const total = bar.parts.reduce((n, p) => n + p.value, 0)
          return (
            <View key={bar.label} style={styles.barColumn}>
              <View style={styles.barStack}>
                {total === 0 ? (
                  <View style={[styles.barEmpty, { backgroundColor: c.well }]} />
                ) : (
                  bar.parts
                    .filter((p) => p.value > 0)
                    .map((p) => (
                      <View
                        key={p.key}
                        style={{
                          height: (p.value / max) * (height - 20),
                          backgroundColor: p.color,
                        }}
                      />
                    ))
                    .reverse()
                )}
              </View>
              <Txt size="xs" tone="muted" center numberOfLines={1} style={styles.barLabel}>
                {bar.label}
              </Txt>
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** The stacked single bar the Outcomes panel draws. */
export function StackedStrip({ slices }: { slices: Slice[] }) {
  const c = useColors()
  const total = slices.reduce((n, s) => n + s.value, 0)
  return (
    <View style={[styles.strip, { backgroundColor: c.well }]}>
      {total > 0
        ? slices
            .filter((s) => s.value > 0)
            .map((s) => (
              <View
                key={s.label}
                style={{ flex: s.value, backgroundColor: s.color, marginRight: 2 }}
              />
            ))
        : null}
    </View>
  )
}

/** Used by the graph preview — an edge between two node dots. */
export function GraphEdge({
  x1,
  y1,
  x2,
  y2,
  color,
}: Record<'x1' | 'y1' | 'x2' | 'y2', number> & { color: string }) {
  return <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} />
}

const styles = StyleSheet.create({
  pieRow: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexWrap: 'wrap' },
  pieLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 32,
    paddingHorizontal: space[1],
    borderRadius: radius.sm,
  },
  pieSwatch: { width: 11, height: 11, borderRadius: 3, borderWidth: 1.5 },
  /* Right-aligned in a fixed column so the figures form one edge rather than
     wandering with the width of the count beside them. */
  piePercent: { width: 34, textAlign: 'right' },
  track: {
    height: 8,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fill: { height: '100%', borderRadius: radius.sm },
  donutCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  axisLabel: { position: 'absolute', width: 88, alignItems: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 36,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  swatch: { width: 11, height: 11, borderRadius: 3, borderWidth: 1.5 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barStack: {
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barEmpty: { height: 2 },
  barLabel: { marginTop: space[1], width: '100%' },
  strip: { flexDirection: 'row', height: 10, borderRadius: radius.full, overflow: 'hidden' },
})
