import { useState } from 'react'
import { Plus, Radar, TriangleAlert } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { StatusDot } from '@/components/common/StatusDot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { matches, pipelines as seedPipelines, savedPostings } from '@/data/scout'

/** Fit bands. A number alone doesn't say whether 64 is good. */
function fitTone(fit: number) {
  if (fit >= 80) return 'green' as const
  if (fit >= 60) return 'amber' as const
  return 'gray' as const
}

export function JobScout() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(seedPipelines.map((p) => [p.id, p.enabled])),
  )
  const [url, setUrl] = useState('')
  // Page option: a long list of off pipelines buries the ones actually running.
  const [onlyActive, setOnlyActive] = useState(false)

  return (
    <>
      <PageHeader
        title="Job scout"
        subtitle="Pipelines crawl your sources and score postings against your profile"
        settings={
          <PageOption
            label="Only active pipelines"
            hint="Hide the ones switched off"
            control={
              <Switch
                checked={onlyActive}
                onCheckedChange={setOnlyActive}
                aria-label="Only active pipelines"
              />
            }
          />
        }
        actions={
          <Button size="sm" disabled title="Creating pipelines needs the local store">
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            New pipeline
          </Button>
        }
      />

      {/* System status, stated plainly rather than implied by a colour. */}
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
        <p>
          No local model is connected, so matching is paused. You can still save postings below —
          they will be scored once a model is reachable.
        </p>
      </div>

      <Panel>
        <PanelTitle hint="run locally on a schedule">Pipelines</PanelTitle>
        <RowList>
          {seedPipelines
            .filter((p) => !onlyActive || enabled[p.id])
            .map((p) => (
              <Row key={p.id} className="flex-wrap">
                <StatusDot status={enabled[p.id] ? 'warn' : 'off'} className="mt-1.5" />
                <div className="min-w-0 flex-1 basis-64">
                  <div>{p.name}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-text-3">
                    {p.source} · {p.schedule} · {p.filter}
                  </div>
                </div>
                <Chip tone={enabled[p.id] ? 'amber' : 'gray'}>
                  {enabled[p.id] ? 'paused' : 'off'}
                </Chip>
                <Switch
                  checked={enabled[p.id]}
                  onCheckedChange={(v) => setEnabled((prev) => ({ ...prev, [p.id]: v }))}
                  aria-label={`Enable ${p.name}`}
                />
              </Row>
            ))}
        </RowList>
      </Panel>

      <Panel>
        <PanelTitle hint="last run Oct 11">Matches</PanelTitle>
        <RowList>
          {matches.map((m) => (
            <Row key={m.id} className="flex-wrap">
              <div className="min-w-0 flex-1 basis-64">
                <div>{m.role}</div>
                <div className="mt-0.5 text-xs text-text-3">{m.detail}</div>
              </div>
              <Chip tone={fitTone(m.fit)}>{m.fit}% fit</Chip>
              <Button variant="ghost" size="sm" disabled title="Needs the local store">
                Add to applications
              </Button>
            </Row>
          ))}
        </RowList>
      </Panel>

      <Panel>
        <PanelTitle hint="works without a model">Save a posting</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          jojo fetches the page and stores a snapshot on your device, so the posting survives after
          it is taken down.
        </p>

        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <Label htmlFor="posting-url" className="sr-only">
              Job posting URL
            </Label>
            <Input
              id="posting-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://university.edu/careers/assistant-professor-12345"
              className="font-mono text-xs"
            />
          </div>
          <Button size="sm" disabled={!url} title={url ? undefined : 'Paste a URL first'}>
            Save page
          </Button>
        </div>

        <div className="mt-4">
          <RowList>
            {savedPostings.map((p) => (
              <Row key={p.id} className="flex-wrap">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="truncate">{p.title}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-text-3">
                    {p.url} · saved {p.saved} · {p.size}
                  </div>
                </div>
                <Chip tone={p.linked ? 'teal' : 'gray'}>
                  {p.linked ? 'linked to application' : 'unscored'}
                </Chip>
                <Button variant="ghost" size="sm" disabled title="Snapshots need the local store">
                  Open snapshot
                </Button>
              </Row>
            ))}
          </RowList>
        </div>
      </Panel>

      <p className="flex items-center gap-2 text-xs text-text-3">
        <Radar className="size-3.5" strokeWidth={1.7} aria-hidden />
        Pipelines run on your machine. Nothing is sent to a third party.
      </p>
    </>
  )
}
