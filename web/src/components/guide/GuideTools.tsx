import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { ToolGateDiagram } from '@/components/guide/diagrams/ToolGateDiagram'
import { ToolGraphDiagram } from '@/components/guide/diagrams/ToolGraphDiagram'
import { ToolEvalTable } from '@/components/guide/ToolEvalTable'
import { ToolBenchTable } from '@/components/guide/ToolBenchTable'
import { BenchAxesDiagram } from '@/components/guide/diagrams/BenchAxesDiagram'
import { BenchAmbiguityDiagram } from '@/components/guide/diagrams/BenchAmbiguityDiagram'
import { BenchExplorer } from '@/components/guide/BenchExplorer'
import { ReasoningTables } from '@/components/guide/ReasoningTables'
import { EnglishData } from '@/components/guide/EnglishData'
import {
  CONVERSATIONS as BENCH_CONVERSATIONS,
  GROUPS as BENCH_GROUPS,
} from '@jojo/service/agent/bench-conversations'
import { CATALOG } from '@jojo/service/agent/catalog'
import { assistantPath, guidePath, settingsPath, useTitle } from '@/lib/links'

/**
 * Page 4 — what the assistant can do to your records, and what stops it.
 *
 * The audience here is somebody deciding whether to let a model write to a year
 * of job applications. That is a trust question, not a curiosity one, so the
 * order is: what it can do, what it cannot, how it is stopped, and only then
 * the mechanism that makes the prompt small.
 *
 * The two diagrams answer the two questions that reliably get asked in the
 * wrong order. People ask "how does it pick the right tool" first, and the
 * answer only means anything after they know that picking wrong is caught —
 * so the gate figure comes before the graph figure, even though the code runs
 * them the other way round.
 *
 * The tool COUNT is read from the catalog rather than typed. It was 82 when
 * this was written, it will not stay 82, and a number in prose that quietly
 * stops matching the software is the failure this whole page is arguing the app
 * avoids.
 *
 * Every sentence lives in the `guideReference` catalog under `tools.`; the
 * counts reach it as placeholders, so no language can type one in either.
 */
export function GuideTools() {
  const { t } = useTranslation('guideReference')
  useTitle(t('tools.pageTitle'))

  const reads = CATALOG.filter((e) => e.effect === 'read').length
  const destructive = CATALOG.filter((e) => e.destructive).length
  const writes = CATALOG.length - reads
  /*
   * Derived, not typed as "two".
   *
   * It happens to be two, and it happened to STAY two only because the tool
   * added since this was written is non-undoable without being destructive —
   * so it fell outside the denominator by luck rather than by the sentence
   * being right. A count in prose that survives on a coincidence is a count
   * waiting to be wrong.
   *
   * `alwaysAsks` is destructive and not undoable, and it is the flag the
   * approval gate reads for its floor, so the sentence below and the gate are
   * counting the same tools.
   */
  const irreversible = CATALOG.filter((e) => e.alwaysAsks).length
  const irreversibleKey =
    irreversible === 1
      ? 'tools.can.irreversibleOne'
      : irreversible === 2
        ? 'tools.can.irreversibleTwo'
        : 'tools.can.irreversibleMany'

  const P = 'text-sm text-text-2'
  const P3 = 'mt-3 text-sm text-text-2'
  const lead = <span className="text-text-1" />

  return (
    <>
      <PageHeader title={t('tools.pageTitle')} subtitle={t('tools.subtitle')} />

      {/* --------------------------- what exists --------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.can.hint', { total: String(CATALOG.length) })}>
          {t('tools.can.title')}
        </PanelTitle>
        <p className={P}>
          <Trans
            t={t}
            i18nKey="tools.can.intro"
            values={{ total: String(CATALOG.length) }}
            components={{ go: <Go to={assistantPath()} /> }}
          />
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat
            n={reads}
            label={t('tools.can.stats.readsLabel')}
            hint={t('tools.can.stats.readsHint')}
          />
          <Stat
            n={writes}
            label={t('tools.can.stats.writesLabel')}
            hint={t('tools.can.stats.writesHint')}
          />
          <Stat
            n={destructive}
            label={t('tools.can.stats.destructiveLabel')}
            hint={t('tools.can.stats.destructiveHint')}
          />
        </div>

        <p className="mt-4 text-sm text-text-2">
          {t(irreversibleKey, {
            irreversible: String(irreversible),
            destructive: String(destructive),
          })}{' '}
          {t('tools.can.neverOffered')}
        </p>
        <p className={P3}>{t('tools.can.ownWords')}</p>
        <p className={P3}>{t('tools.can.errs')}</p>
      </Panel>

      {/* ---------------------------- the gates ---------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.gates.hint')}>{t('tools.gates.title')}</PanelTitle>
        <p className={P}>{t('tools.gates.intro')}</p>

        <div className="mt-4">
          <ToolGateDiagram />
        </div>

        <h3 className="mt-5 text-sm font-medium">{t('tools.gates.distinctionTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">
          <Trans t={t} i18nKey="tools.gates.distinction" components={{ em: <em /> }} />
        </p>
        <p className={P3}>{t('tools.gates.askGraph')}</p>
      </Panel>

      {/* -------------------------- the workflow --------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.workflow.hint')}>{t('tools.workflow.title')}</PanelTitle>
        <p className={P}>
          <Trans
            t={t}
            i18nKey="tools.workflow.p1"
            components={{ code: <code className="font-mono text-xs" /> }}
          />
        </p>
        <p className={P3}>
          <Trans t={t} i18nKey="tools.workflow.p2" components={{ strong: <strong /> }} />
        </p>
        <p className={P3}>{t('tools.workflow.p3')}</p>
        <p className="mt-3 text-sm text-text-3">{t('tools.workflow.p4')}</p>
      </Panel>

      {/* ------------------ when the model answers badly ------------------- */}
      <Panel>
        <PanelTitle hint={t('tools.badReply.hint')}>{t('tools.badReply.title')}</PanelTitle>
        <p className={P}>
          <Trans t={t} i18nKey="tools.badReply.p1" components={{ strong: <strong /> }} />
        </p>
        <p className={P3}>{t('tools.badReply.p2')}</p>
        <p className={P3}>{t('tools.badReply.p3')}</p>
      </Panel>

      {/* --------------------------- the graph ----------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.picks.hint')}>{t('tools.picks.title')}</PanelTitle>
        <p className={P}>{t('tools.picks.p1', { total: String(CATALOG.length) })}</p>
        <p className={P3}>{t('tools.picks.p2')}</p>

        <div className="mt-4">
          <ToolGraphDiagram />
        </div>

        <h3 className="mt-5 text-sm font-medium">{t('tools.picks.unsureTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">{t('tools.picks.unsure')}</p>
        <h3 className="mt-5 text-sm font-medium">{t('tools.picks.secondTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">{t('tools.picks.second1')}</p>
        <p className={P3}>{t('tools.picks.second2')}</p>
        <p className={P3}>{t('tools.picks.second3')}</p>

        <h3 className="mt-5 text-sm font-medium">{t('tools.picks.longTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">{t('tools.picks.long1')}</p>
        <p className={P3}>{t('tools.picks.long2')}</p>

        <p className={P3}>{t('tools.picks.long3')}</p>
      </Panel>

      {/* -------------------------- the evidence --------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.evidence.hint')}>{t('tools.evidence.title')}</PanelTitle>
        <p className={P}>{t('tools.evidence.p1')}</p>
        <p className={P3}>{t('tools.evidence.p2')}</p>

        <div className="mt-4">
          <EnglishData>
            <ToolEvalTable />
          </EnglishData>
        </div>

        <h3 className="mt-5 text-sm font-medium">{t('tools.evidence.suiteTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">{t('tools.evidence.suite')}</p>
      </Panel>

      {/* ------------------------ the harder benchmark --------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.conversation.hint')}>{t('tools.conversation.title')}</PanelTitle>
        <p className={P}>{t('tools.conversation.p1')}</p>
        <p className={P3}>
          {t('tools.conversation.p2', {
            conversations: String(BENCH_CONVERSATIONS.length),
            groups: String(BENCH_GROUPS.length),
          })}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-text-2">
          {(['called', 'route', 'shape', 'left'] as const).map((axis) => (
            <li key={axis}>
              <Trans t={t} i18nKey={`tools.conversation.${axis}`} components={{ lead }} />
            </li>
          ))}
        </ul>
        <p className={P3}>{t('tools.conversation.p3')}</p>

        <div className="mt-4">
          <BenchAxesDiagram />
        </div>

        <div className="mt-5">
          <EnglishData>
            <ToolBenchTable />
          </EnglishData>
        </div>
      </Panel>

      {/* ------------------------------ reasoning ---------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.reasoning.hint')}>{t('tools.reasoning.title')}</PanelTitle>
        <p className={P}>
          <Trans
            t={t}
            i18nKey="tools.reasoning.p1"
            components={{ go: <Go to={settingsPath()} /> }}
          />
        </p>

        <div className="mt-4">
          <EnglishData>
            <ReasoningTables />
          </EnglishData>
        </div>

        <h3 className="mt-5 text-sm font-medium">{t('tools.reasoning.numbersTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">
          <Trans t={t} i18nKey="tools.reasoning.gemma" components={{ lead }} />
        </p>
        <p className={P3}>
          <Trans t={t} i18nKey="tools.reasoning.gptOss" components={{ lead }} />
        </p>
        <p className={P3}>{t('tools.reasoning.advice')}</p>
        <p className={P3}>{t('tools.reasoning.firstToken')}</p>
      </Panel>

      {/* --------------------------- the previewer ------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.previewer.hint')}>{t('tools.previewer.title')}</PanelTitle>
        <p className={P}>{t('tools.previewer.p1')}</p>
        <p className={P3}>{t('tools.previewer.p2')}</p>
        <p className={P3}>{t('tools.previewer.p3')}</p>

        <div className="mt-4">
          <EnglishData>
            <BenchExplorer />
          </EnglishData>
        </div>
      </Panel>

      {/* ------------------------- the failure that matters ---------------- */}

      <Panel>
        <PanelTitle hint={t('tools.ambiguity.hint')}>{t('tools.ambiguity.title')}</PanelTitle>
        <p className={P}>{t('tools.ambiguity.p1')}</p>

        <div className="mt-4">
          <BenchAmbiguityDiagram />
        </div>

        <p className="mt-4 text-sm text-text-2">{t('tools.ambiguity.p2')}</p>
        <p className={P3}>{t('tools.ambiguity.p3')}</p>
      </Panel>

      {/* -------------------------- where it runs -------------------------- */}

      <Panel>
        <PanelTitle hint={t('tools.model.hint')}>{t('tools.model.title')}</PanelTitle>
        <p className={P}>
          <Trans t={t} i18nKey="tools.model.p1" components={{ go: <Go to={settingsPath()} /> }} />
        </p>
        <p className={P3}>{t('tools.model.p2')}</p>

        <h3 className="mt-5 text-sm font-medium">{t('tools.model.stoppedTitle')}</h3>
        <p className="mt-1.5 text-sm text-text-2">{t('tools.model.stopped')}</p>
      </Panel>

      <p className="px-1 pb-2 text-sm text-text-3">
        <Trans
          t={t}
          i18nKey="tools.next"
          components={{ go: <Go to={guidePath('built-with')} /> }}
        />
      </p>
    </>
  )
}

/** One number and what it counts, in the three-across shape page 1 uses. */
function Stat({ n, label, hint }: { n: number; label: string; hint: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-well px-3 py-2.5">
      <div className="tabular text-lg font-medium">{n}</div>
      <div className="text-sm text-text-1">{label}</div>
      <div className="mt-0.5 text-xs text-text-3">{hint}</div>
    </div>
  )
}

/** Optional children: inside a `<Trans>` the catalog supplies the link text. */
function Go({ to, children }: { to: string; children?: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-accent underline decoration-1 underline-offset-4 hover:decoration-2"
    >
      {children}
    </Link>
  )
}
