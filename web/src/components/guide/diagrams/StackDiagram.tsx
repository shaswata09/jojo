import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DASH } from '@/components/guide/diagrams/marks'
import { Box, Connector } from '@/components/guide/diagrams/parts'

/**
 * The whole codebase as one stack: the three things a person touches on top,
 * the shared service in six layers beneath them, and the two storage adapters
 * underneath that implement its bottom port.
 *
 * The tools layer is the one drawn in the accent, because it is the claim the
 * rest of the picture hangs on: every change to the records passes through it,
 * from either app, the assistant or MCP.
 *
 * Layer names are module names and stay as written; every `note` and client
 * `label` below is a catalog key under `diagrams.stack`, translated at render.
 */

const W = 420
const TOP_Y = 14
const BOX_H = 32
const STACK_Y = 74
const PITCH = 48

const SERVICE = [
  { label: 'L4 react', note: 'reactNote', accent: false },
  { label: 'L3.5 agent', note: 'agentNote', accent: false },
  { label: 'L3 tools', note: 'toolsNote', accent: true },
  { label: 'L2 repo', note: 'repoNote', accent: false },
  { label: 'L1 core', note: 'coreNote', accent: false },
  { label: 'L0 storage', note: 'storageNote', accent: false },
] as const

const CLIENT_W = 116
const CLIENTS = [
  { label: 'extension', x: 4 },
  { label: 'webApp', x: 152 },
  { label: 'phoneApp', x: 300 },
] as const

const ADAPTER_Y = STACK_Y + SERVICE.length * PITCH + 4
const STORAGE_BOTTOM = STACK_Y + (SERVICE.length - 1) * PITCH + BOX_H
const HEIGHT = ADAPTER_Y + BOX_H + 6

export function StackDiagram() {
  const { t } = useTranslation('guideReference')
  const titleId = useId()
  const descId = useId()
  const center = (x: number) => x + CLIENT_W / 2
  const web = CLIENTS[1]
  const phone = CLIENTS[2]

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${String(W)} ${String(HEIGHT)}`}
        className="diagram h-auto w-full max-w-[560px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{t('diagrams.stack.title')}</title>
        <desc id={descId}>{t('diagrams.stack.desc')}</desc>

        {CLIENTS.map((client) => (
          <g key={client.label}>
            <Box x={client.x} y={TOP_Y} w={CLIENT_W} h={BOX_H} />
            <text
              x={center(client.x)}
              y={TOP_Y + BOX_H / 2 + 4}
              fontSize={11}
              textAnchor="middle"
              fill="var(--text-1)"
            >
              {t(`diagrams.stack.${client.label}`)}
            </text>
          </g>
        ))}

        {/* Sideways links between the top three — neither is an import. */}
        <Connector
          from={[CLIENTS[0].x + CLIENT_W, TOP_Y + BOX_H / 2]}
          to={[web.x, TOP_Y + BOX_H / 2]}
          dir="right"
          dash={DASH.soft}
        />
        <text
          x={(CLIENTS[0].x + CLIENT_W + web.x) / 2}
          y={TOP_Y - 3}
          fontSize={9}
          textAnchor="middle"
          fill="var(--text-2)"
        >
          {t('diagrams.stack.relay')}
        </text>
        <Connector
          from={[web.x + CLIENT_W, TOP_Y + BOX_H / 2]}
          to={[phone.x, TOP_Y + BOX_H / 2]}
          dir="right"
          dash={DASH.soft}
        />
        <text
          x={(web.x + CLIENT_W + phone.x) / 2}
          y={TOP_Y - 3}
          fontSize={9}
          textAnchor="middle"
          fill="var(--text-2)"
        >
          {t('diagrams.stack.lan')}
        </text>

        {[web, phone].map((client) => (
          <g key={client.label}>
            <Connector
              from={[center(client.x), TOP_Y + BOX_H]}
              to={[center(client.x), STACK_Y]}
              dir="down"
            />
            <text x={center(client.x) + 6} y={TOP_Y + BOX_H + 17} fontSize={9} fill="var(--text-2)">
              {t('diagrams.stack.hooks')}
            </text>
          </g>
        ))}

        {SERVICE.map((layer, i) => {
          const y = STACK_Y + i * PITCH
          return (
            <g key={layer.label}>
              <Box
                x={4}
                y={y}
                w={W - 8}
                h={BOX_H}
                stroke={layer.accent ? 'var(--accent)' : undefined}
                width={layer.accent ? 1.5 : 1}
              />
              <text x={14} y={y + BOX_H / 2 + 4} fontSize={11} fill="var(--text-1)">
                {layer.label}
              </text>
              <text
                x={W - 14}
                y={y + BOX_H / 2 + 4}
                fontSize={10}
                textAnchor="end"
                fill="var(--text-2)"
              >
                {t(`diagrams.stack.${layer.note}`)}
              </text>
              {i < SERVICE.length - 1 ? (
                <Connector from={[W / 2, y + BOX_H]} to={[W / 2, y + PITCH]} dir="down" />
              ) : null}
            </g>
          )
        })}

        {[
          { label: 'idbDriver', x: 4 },
          { label: 'asyncDriver', x: W / 2 + 4 },
        ].map((adapter) => {
          const w = W / 2 - 8
          return (
            <g key={adapter.label}>
              <Box x={adapter.x} y={ADAPTER_Y} w={w} h={BOX_H} dash={DASH.soft} />
              <text
                x={adapter.x + w / 2}
                y={ADAPTER_Y + BOX_H / 2 + 4}
                fontSize={10}
                textAnchor="middle"
                fill="var(--text-1)"
              >
                {t(`diagrams.stack.${adapter.label}`)}
              </text>
              <Connector
                from={[adapter.x + w / 2, ADAPTER_Y]}
                to={[adapter.x + w / 2, STORAGE_BOTTOM]}
                dir="up"
                dash={DASH.soft}
              />
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">{t('diagrams.stack.caption')}</figcaption>
    </figure>
  )
}
