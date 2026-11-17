import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { RecordModelDiagram } from '@/components/guide/diagrams/RecordModelDiagram'
import { UnlinkDiagram } from '@/components/guide/diagrams/UnlinkDiagram'
import { graphPath, guidePath, settingsPath, useTitle } from '@/lib/links'

/**
 * Page 3 — the bridge page, where the audience changes halfway down.
 *
 * The concrete artefact first: the Graph route draws something the reader has
 * already seen, and the model falls out of it. Someone who stops at the halfway
 * point has still learned why deleting an application does not delete its
 * keywords, which is the fact this page exists to deliver.
 *
 * The order is therefore picture, then question, then model, then delete, then
 * the source-reader's paragraph — and NOT the order the code is arranged in.
 * A first draft opened with the eleven node types, on the reasoning that you
 * cannot explain a drawing without explaining what it draws. It read as a
 * schema reference with a screenshot bolted on, and the delete rule — the one
 * thing on this page that changes what a user does — sat below the fold behind
 * two sections about type unions.
 *
 * What this page must not do is restate page 1. That page already covers the
 * three pickers, the worked examples, and that the query line is illustrative;
 * it ends by pointing here for what is drawn and why. So everything below goes
 * a level deeper than that pointer promised: what the marks mean rather than
 * that there are marks, why the illustrative line is shown at all rather than
 * that it is labelled, and the record model underneath both.
 *
 * Every sentence lives in the `guideReference` catalog under `graph.`.
 */
export function GuideGraph() {
  const { t } = useTranslation('guideReference')
  useTitle(t('graph.pageTitle'))

  const hi = <span className="text-text-1" />
  const lead = <span className="font-medium text-text-1" />
  const code = <span className="font-mono text-xs text-text-1" />

  return (
    <>
      <PageHeader title={t('graph.pageTitle')} subtitle={t('graph.subtitle')} />

      {/* ------------------------- the drawn artefact ---------------------- */}

      <Panel>
        <PanelTitle hint={t('graph.picture.hint')}>{t('graph.picture.title')}</PanelTitle>
        <p className="text-sm text-text-2">
          <Trans t={t} i18nKey="graph.picture.body" components={{ go: <Go to={graphPath()} /> }} />
        </p>

        <h3 className="mt-4 text-sm font-medium">{t('graph.picture.markTitle')}</h3>
        <dl className="mt-2 divide-y divide-hairline text-sm">
          <Row term={t('graph.picture.colourTerm')}>{t('graph.picture.colour')}</Row>
          <Row term={t('graph.picture.shapeTerm')}>{t('graph.picture.shape')}</Row>
          <Row term={t('graph.picture.sizeTerm')}>{t('graph.picture.size')}</Row>
          <Row term={t('graph.picture.lineTerm')}>{t('graph.picture.line')}</Row>
        </dl>

        <h3 className="mt-4 text-sm font-medium">{t('graph.picture.notDoTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">{t('graph.picture.notDo1')}</p>
        <p className="mt-2 text-sm text-text-2">
          <Trans
            t={t}
            i18nKey="graph.picture.notDo2"
            components={{ go: <Go to={settingsPath()} /> }}
          />
        </p>
      </Panel>

      {/* ---------------------------- the question ------------------------- */}

      <Panel>
        <PanelTitle hint={t('graph.question.hint')}>{t('graph.question.title')}</PanelTitle>
        <p className="text-sm text-text-2">{t('graph.question.intro')}</p>
        <ol className="mt-2 space-y-2 text-sm text-text-2">
          <li>
            <Trans t={t} i18nKey="graph.question.pickers" components={{ lead, hi }} />
          </li>
          <li>
            <Trans t={t} i18nKey="graph.question.queryLine" components={{ lead }} />
          </li>
          <li>
            <Trans t={t} i18nKey="graph.question.answer" components={{ lead }} />
          </li>
        </ol>

        <h3 className="mt-4 text-sm font-medium">{t('graph.question.whyTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">
          {/* The query is the illustrative line itself, so it stays as written. */}
          <Trans
            t={t}
            i18nKey="graph.question.why"
            values={{ query: 'WHERE NOT (a)-[:ABOUT]-(:Timeline item)' }}
            components={{ code }}
          />
        </p>

        <h3 className="mt-4 text-sm font-medium">{t('graph.question.answersTitle')}</h3>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-text-2 marker:text-text-3">
          <li>{t('graph.question.answers1')}</li>
          <li>{t('graph.question.answers2')}</li>
          <li>{t('graph.question.answers3')}</li>
        </ul>
      </Panel>

      {/* ------------------------------ the model -------------------------- */}

      <Panel>
        <PanelTitle hint={t('graph.model.hint')}>{t('graph.model.title')}</PanelTitle>
        <p className="mb-4 text-sm text-text-2">{t('graph.model.intro')}</p>

        <RecordModelDiagram />

        <h3 className="mt-5 text-sm font-medium">{t('graph.model.manyTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">
          <Trans t={t} i18nKey="graph.model.many" components={{ code }} />
        </p>

        <h3 className="mt-4 text-sm font-medium">{t('graph.model.elevensTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">{t('graph.model.elevensIntro')}</p>
        <dl className="mt-2 divide-y divide-hairline text-sm">
          <Row term={t('graph.model.nineTerm')}>{t('graph.model.nine')}</Row>
          <Row term={t('graph.model.fiveTerm')}>{t('graph.model.five')}</Row>
          <Row term={t('graph.model.oneNameTerm')}>
            <Trans
              t={t}
              i18nKey="graph.model.oneName"
              components={{ code: <span className="font-mono text-xs" /> }}
            />
          </Row>
        </dl>
      </Panel>

      {/* ---------------------- drawn but never stored --------------------- */}

      <Panel>
        <PanelTitle hint={t('graph.drawn.hint')}>{t('graph.drawn.title')}</PanelTitle>
        <p className="text-sm text-text-2">{t('graph.drawn.p1')}</p>
        <p className="mt-2 text-sm text-text-2">{t('graph.drawn.p2')}</p>

        <h3 className="mt-4 text-sm font-medium">{t('graph.drawn.tellTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">
          <Trans
            t={t}
            i18nKey="graph.drawn.tell"
            components={{ hi, go: <Go to={settingsPath()} /> }}
          />
        </p>
        <p className="mt-2 text-sm text-text-2">{t('graph.drawn.source')}</p>
      </Panel>

      {/* ------------------------------- delete ---------------------------- */}

      <Panel>
        <PanelTitle hint={t('graph.delete.hint')}>{t('graph.delete.title')}</PanelTitle>
        <p className="mb-4 text-sm text-text-2">{t('graph.delete.intro')}</p>

        <UnlinkDiagram />

        <h3 className="mt-5 text-sm font-medium">{t('graph.delete.afterTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">
          <Trans t={t} i18nKey="graph.delete.after" components={{ hi }} />
        </p>

        <h3 className="mt-4 text-sm font-medium">{t('graph.delete.halfTitle')}</h3>
        <p className="mt-1 text-sm text-text-2">{t('graph.delete.half')}</p>
      </Panel>

      {/* --------------------- for the source reader ----------------------- */}

      <Panel>
        <PanelTitle hint={t('graph.source.hint')}>{t('graph.source.title')}</PanelTitle>
        <p className="text-sm text-text-2">{t('graph.source.p1')}</p>
        <p className="mt-2 text-sm text-text-2">{t('graph.source.p2')}</p>
        <p className="mt-2 text-sm text-text-2">
          <Trans
            t={t}
            i18nKey="graph.source.p3"
            components={{ go: <Go to={settingsPath()} />, em: <em /> }}
          />
        </p>
        <p className="mt-2 text-sm text-text-2">
          <Trans
            t={t}
            i18nKey="graph.source.p4"
            components={{ go: <Go to={guidePath('built-with')} /> }}
          />
        </p>
      </Panel>
    </>
  )
}

/**
 * A link into the app or across the section, styled once.
 *
 * The same three classes as page 1's, deliberately duplicated rather than
 * exported from it: the alternative is one guide page importing a private
 * helper from another, which makes the two files a unit and means neither can
 * be rewritten without opening the other.
 */
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

/** One term and its explanation, in the two-column shape page 1 uses. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
      <dt className="basis-44 font-medium">{term}</dt>
      <dd className="min-w-0 flex-1 basis-64 text-text-2">{children}</dd>
    </div>
  )
}
