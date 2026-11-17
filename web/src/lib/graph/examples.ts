/**
 * The questions worth a click.
 *
 * Each one builds a query against the graph in front of it rather than a
 * hard-coded record id, and returns null when this session has nothing to ask
 * it about — a button that cannot answer is disabled rather than silently
 * returning an empty table.
 */

import type { Graph, GraphNodeType } from '@/lib/graph/model'
import type { GraphQuery } from '@/lib/graph/query'
import { shortestPath } from '@/lib/graph/traversal'
import { i18next } from '@/i18n/i18n'

export type QueryExample = {
  id: string
  label: string
  hint: string
  build: (graph: Graph) => GraphQuery | null
}

const firstOfType = (graph: Graph, type: GraphNodeType) => graph.nodes.find((n) => n.type === type)

export const QUERY_EXAMPLES: QueryExample[] = [
  {
    id: 'no-follow-up',
    get label() {
      return i18next.t('messages:graph.examples.noFollowUp.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.noFollowUp.hint')
    },
    build: (graph) =>
      firstOfType(graph, 'application')
        ? {
            kind: 'pattern',
            start: 'application',
            quantifier: 'missing',
            rel: 'ABOUT',
            end: 'item',
            endFacet: 'follow-up',
          }
        : null,
  },
  {
    id: 'tagged',
    get label() {
      return i18next.t('messages:graph.examples.tagged.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.tagged.hint')
    },
    build: (graph) => {
      const keyword =
        graph.nodes.find((n) => n.type === 'keyword' && n.label.toLowerCase() === 'referral') ??
        graph.nodes.find((n) => n.type === 'keyword')
      if (!keyword) return null
      return {
        kind: 'pattern',
        start: 'any',
        quantifier: 'has',
        rel: 'TAGS',
        end: 'keyword',
        keywordId: keyword.id,
      }
    },
  },
  {
    id: 'repeat-orgs',
    get label() {
      return i18next.t('messages:graph.examples.repeatOrgs.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.repeatOrgs.hint')
    },
    build: (graph) =>
      firstOfType(graph, 'organisation')
        ? {
            kind: 'pattern',
            start: 'organisation',
            quantifier: 'atLeast',
            atLeast: 2,
            rel: 'AT',
            end: 'application',
          }
        : null,
  },
  {
    id: 'loose-reminders',
    get label() {
      return i18next.t('messages:graph.examples.looseReminders.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.looseReminders.hint')
    },
    build: (graph) =>
      graph.nodes.some((n) => n.type === 'item' && n.reminder)
        ? {
            kind: 'pattern',
            start: 'item',
            startFacet: 'reminder',
            quantifier: 'missing',
            rel: 'ABOUT',
            end: 'application',
          }
        : null,
  },
  {
    id: 'unused-files',
    get label() {
      return i18next.t('messages:graph.examples.unusedFiles.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.unusedFiles.hint')
    },
    build: (graph) =>
      firstOfType(graph, 'file')
        ? {
            kind: 'pattern',
            start: 'file',
            quantifier: 'missing',
            rel: 'FILED_UNDER',
            end: 'application',
          }
        : null,
  },
  {
    id: 'bare-applications',
    get label() {
      return i18next.t('messages:graph.examples.bareApplications.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.bareApplications.hint')
    },
    build: (graph) =>
      firstOfType(graph, 'application')
        ? {
            kind: 'pattern',
            start: 'application',
            quantifier: 'missing',
            rel: 'FILED_UNDER',
            end: 'any',
          }
        : null,
  },
  {
    id: 'path',
    get label() {
      return i18next.t('messages:graph.examples.path.label')
    },
    get hint() {
      return i18next.t('messages:graph.examples.path.hint')
    },
    build: (graph) => {
      // Picks a pair that is actually joined, so the example demonstrates a
      // path rather than demonstrating that there is not one.
      const files = graph.nodes.filter((n) => n.type === 'file')
      const applications = graph.nodes.filter((n) => n.type === 'application')
      for (const file of files) {
        for (const application of applications) {
          if (shortestPath(graph, file.id, application.id)) {
            return { kind: 'path', from: file.id, to: application.id }
          }
        }
      }
      const [first, second] = graph.nodes
      return first && second ? { kind: 'path', from: first.id, to: second.id } : null
    },
  },
]
