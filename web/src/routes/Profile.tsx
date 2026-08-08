import { useState } from 'react'
import { Download, FileText, Plus, Upload, X } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { Field, SettingRow } from '@/components/common/Field'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const documents = [
  {
    name: 'CV_academic.pdf',
    version: 'v4',
    edited: '2 days ago',
    size: '210 KB',
    used: 12,
    track: 'academia',
  },
  {
    name: 'Research_statement.pdf',
    version: 'v2',
    edited: '5 days ago',
    size: '180 KB',
    used: 9,
    track: 'academia',
  },
  {
    name: 'Teaching_statement.pdf',
    version: 'v3',
    edited: '1 week ago',
    size: '95 KB',
    used: 8,
    track: 'academia',
  },
  {
    name: 'Resume_industry.pdf',
    version: 'v6',
    edited: 'yesterday',
    size: '120 KB',
    used: 8,
    track: 'industry',
  },
]

const INITIAL_KEYWORDS = [
  'machine learning systems',
  'distributed training',
  'efficient inference',
  'MLOps',
]

export function Profile() {
  // Page option: the profile drives scoring, so seeing that spelled out helps
  // the first time and is noise thereafter.
  const [showScoringHelp, setShowScoringHelp] = useState(true)
  const [keywords, setKeywords] = useState(INITIAL_KEYWORDS)
  const [includeAcademia, setIncludeAcademia] = useState(true)
  const [includeIndustry, setIncludeIndustry] = useState(true)

  return (
    <>
      <PageHeader
        title="My profile"
        subtitle={
          showScoringHelp
            ? 'What the scout and assistant use to match and draft. None of it leaves your device.'
            : 'Basics, documents and match keywords'
        }
        settings={
          <PageOption
            label="Explain what this feeds"
            hint="The longer subtitle about scoring and privacy"
            control={
              <Switch
                checked={showScoringHelp}
                onCheckedChange={setShowScoringHelp}
                aria-label="Explain what this feeds"
              />
            }
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>Basics</PanelTitle>
          <div className="space-y-3">
            <Field label="Full name" defaultValue="Alex Rahman" autoComplete="name" />
            <Field label="Current position" defaultValue="PhD candidate, Computer Science" />
            <Field label="Location" defaultValue="Lubbock, TX (open to relocate)" />
            <Field
              label="Email"
              type="email"
              defaultValue="alex@university.edu"
              autoComplete="email"
              mono
            />
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Links</PanelTitle>
          <div className="space-y-3">
            <Field label="Website" type="url" defaultValue="https://alexrahman.dev" mono />
            <Field
              label="Google Scholar"
              type="url"
              defaultValue="https://scholar.google.com/citations?user=xxxx"
              mono
            />
            <Field label="GitHub" type="url" defaultValue="https://github.com/alexr" mono />
            <Field label="LinkedIn" type="url" defaultValue="https://linkedin.com/in/alexr" mono />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelTitle hint="drives scout matching">Interests and targets</PanelTitle>

        <div className="mb-4">
          <p className="mb-2 text-xs text-text-2">Research areas and keywords</p>
          <ul className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <li key={k}>
                <Chip tone="teal" className="pr-1">
                  {k}
                  <button
                    type="button"
                    onClick={() => setKeywords((prev) => prev.filter((x) => x !== k))}
                    aria-label={`Remove ${k}`}
                    className="ml-0.5 rounded-sm p-0.5 hover:bg-accent-border/40"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </Chip>
              </li>
            ))}
            <li>
              <Button
                variant="ghost"
                size="sm"
                disabled
                title="Adding keywords needs the local store"
              >
                <Plus className="size-3" strokeWidth={2} aria-hidden />
                Add
              </Button>
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Target roles"
            defaultValue="Assistant professor (TT) · Research scientist · ML engineer"
          />
          <Field label="Preferred regions" defaultValue="Texas · remote · open to US-wide for TT" />
        </div>

        <div className="mt-4">
          <SettingRow
            label="Include academia postings"
            control={
              <Switch
                checked={includeAcademia}
                onCheckedChange={setIncludeAcademia}
                aria-label="Include academia postings"
              />
            }
          />
          <SettingRow
            label="Include industry postings"
            control={
              <Switch
                checked={includeIndustry}
                onCheckedChange={setIncludeIndustry}
                aria-label="Include industry postings"
              />
            }
          />
        </div>
      </Panel>

      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PanelTitle className="mb-0" hint="a snapshot is saved with every submission">
            Documents
          </PanelTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled title="Uploads need the local store">
              <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
              Upload
            </Button>
            <Button variant="ghost" size="sm" disabled title="Export needs the local store">
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              Export all
            </Button>
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => (
            <li key={d.name} className="rounded-lg border border-hairline bg-well p-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 shrink-0 text-accent" strokeWidth={1.7} aria-hidden />
                <span className="truncate text-sm font-medium">{d.name}</span>
              </div>
              <p className="tabular mt-1.5 text-xs text-text-3">
                {d.version} · edited {d.edited} · {d.size}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Chip tone="teal" size="sm">
                  {d.used} applications
                </Chip>
                <Chip tone="gray" size="sm">
                  {d.track}
                </Chip>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  )
}
