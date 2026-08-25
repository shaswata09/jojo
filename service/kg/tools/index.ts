/**
 * L3 — the TOOLS registry.
 *
 * A const object rather than a Map populated by side effect, so
 * `run('application.creat', …)` is a compile error rather than a no-op at
 * runtime, and so the registry stays tree-shakeable.
 *
 * Naming is `domain.noun.verb`: lowercase, dotted, singular nouns, verb last,
 * from a closed verb set — create update delete duplicate set add remove move
 * attach detach promote ensure. No `toggle` anywhere, for the reason written in
 * `timeline.ts`.
 *
 * A card action that writes nothing to memory is not a tool. "Copy snippet to
 * clipboard" and "open link" are absent on purpose: keeping that line sharp is
 * what stops the registry becoming a list of every `onClick` in the app.
 */

import {
  applicationDelete,
  applicationDuplicate,
  applicationFlagSet,
  applicationNoteSet,
} from './application-record'
import {
  applicationOfferClear,
  applicationOfferDecide,
  applicationStageAdvance,
  applicationStageSet,
} from './application-stage'
import { applicationCreate, applicationUpdate, orgEnsure } from './application'
import {
  keywordAttach,
  keywordCreate,
  keywordDelete,
  keywordDetach,
  keywordRecordSet,
  keywordRename,
  keywordToneSet,
} from './keyword'
import {
  threadCreate,
  threadDelete,
  threadFile,
  threadRename,
  threadSet,
  threadAutoSet,
} from './assistant'
import {
  pipelineRunRecord,
  proposalApprove,
  proposalDiscard,
  proposalFail,
  proposalRaise,
  proposalSweep,
} from './pipeline'
import { memoryClear, memoryReset } from './memory'
import {
  profileDocumentAdd,
  profileBackgroundAdd,
  profileBackgroundUpdate,
  profileBackgroundDelete,
  profileMatchTermAdd,
  profileMatchTermRemove,
  profilePreferenceSet,
  profileSet,
  profileTextSet,
} from './profile'
import {
  scoutMatchDismiss,
  scoutMatchPromote,
  scoutMatchSave,
  scoutMatchUpdate,
  scoutPipelineCreate,
  scoutPipelineDelete,
  scoutPipelineEnableSet,
  scoutPipelineUpdate,
  scoutPostingDelete,
  scoutPostingPromote,
  scoutPostingSave,
  scoutPostingUpdate,
} from './scout'
import {
  timelineItemComplete,
  timelineItemCreate,
  timelineItemDelete,
  timelineItemDuplicate,
  timelineItemRemindSet,
  timelineItemReopen,
  timelineItemReschedule,
  timelineItemSnooze,
  timelineItemUpdate,
} from './timeline'
import type { AnyTool, Tool } from './tool'
import {
  vaultFileAdd,
  vaultFileDelete,
  vaultFileMove,
  vaultFileNoteSet,
  vaultFileUpdate,
  vaultLinkDelete,
  vaultLinkDuplicate,
  vaultLinkRecategorise,
  vaultLinkSave,
  vaultLinkUpdate,
  vaultPersonCreate,
  vaultPersonDelete,
  vaultPersonUpdate,
  vaultSnippetCreate,
  vaultSnippetDelete,
  vaultSnippetDuplicate,
  vaultSnippetRetag,
  vaultSnippetUpdate,
} from './vault'

export const TOOLS = {
  'application.create': applicationCreate,
  'application.update': applicationUpdate,
  'application.delete': applicationDelete,
  'application.duplicate': applicationDuplicate,
  'application.note.set': applicationNoteSet,
  'application.flag.set': applicationFlagSet,
  'application.stage.set': applicationStageSet,
  'application.stage.advance': applicationStageAdvance,
  'application.offer.decide': applicationOfferDecide,
  'application.offer.clear': applicationOfferClear,
  'org.ensure': orgEnsure,

  'timeline.item.create': timelineItemCreate,
  'timeline.item.update': timelineItemUpdate,
  'timeline.item.delete': timelineItemDelete,
  'timeline.item.duplicate': timelineItemDuplicate,
  'timeline.item.complete': timelineItemComplete,
  'timeline.item.reopen': timelineItemReopen,
  'timeline.item.snooze': timelineItemSnooze,
  'timeline.item.reschedule': timelineItemReschedule,
  'timeline.item.remind.set': timelineItemRemindSet,

  'vault.link.save': vaultLinkSave,
  'vault.link.update': vaultLinkUpdate,
  'vault.link.delete': vaultLinkDelete,
  'vault.link.duplicate': vaultLinkDuplicate,
  'vault.link.recategorise': vaultLinkRecategorise,
  'vault.file.add': vaultFileAdd,
  'vault.file.update': vaultFileUpdate,
  'vault.file.delete': vaultFileDelete,
  'vault.file.move': vaultFileMove,
  'vault.file.note.set': vaultFileNoteSet,
  'vault.person.create': vaultPersonCreate,
  'vault.person.update': vaultPersonUpdate,
  'vault.person.delete': vaultPersonDelete,
  'vault.snippet.create': vaultSnippetCreate,
  'vault.snippet.update': vaultSnippetUpdate,
  'vault.snippet.delete': vaultSnippetDelete,
  'vault.snippet.duplicate': vaultSnippetDuplicate,
  'vault.snippet.retag': vaultSnippetRetag,

  'keyword.create': keywordCreate,
  'keyword.rename': keywordRename,
  'keyword.delete': keywordDelete,
  'keyword.tone.set': keywordToneSet,
  'keyword.attach': keywordAttach,
  'keyword.detach': keywordDetach,
  'keyword.record.set': keywordRecordSet,

  'scout.posting.save': scoutPostingSave,
  'scout.posting.update': scoutPostingUpdate,
  'scout.posting.delete': scoutPostingDelete,
  'scout.posting.promote': scoutPostingPromote,
  'scout.match.save': scoutMatchSave,
  'scout.match.update': scoutMatchUpdate,
  'scout.match.promote': scoutMatchPromote,
  'scout.match.dismiss': scoutMatchDismiss,
  'scout.pipeline.create': scoutPipelineCreate,
  'scout.pipeline.update': scoutPipelineUpdate,
  'scout.pipeline.delete': scoutPipelineDelete,
  'scout.pipeline.enable.set': scoutPipelineEnableSet,

  'profile.set': profileSet,
  'profile.text.set': profileTextSet,
  'profile.matchTerm.add': profileMatchTermAdd,
  'profile.matchTerm.remove': profileMatchTermRemove,
  'profile.preference.set': profilePreferenceSet,
  'profile.document.add': profileDocumentAdd,
  'profile.background.add': profileBackgroundAdd,
  'profile.background.update': profileBackgroundUpdate,
  'profile.background.delete': profileBackgroundDelete,

  'assistant.thread.create': threadCreate,
  'assistant.thread.set': threadSet,
  'assistant.thread.rename': threadRename,
  'assistant.thread.file': threadFile,
  'assistant.thread.auto.set': threadAutoSet,
  'assistant.thread.delete': threadDelete,

  'pipeline.proposal.raise': proposalRaise,
  'pipeline.proposal.approve': proposalApprove,
  'pipeline.proposal.discard': proposalDiscard,
  'pipeline.proposal.fail': proposalFail,
  'pipeline.proposal.sweep': proposalSweep,
  'pipeline.run.record': pipelineRunRecord,

  'memory.reset': memoryReset,
  'memory.clear': memoryClear,
} as const

export type ToolName = keyof typeof TOOLS

/**
 * The half of `Tool<I, O>` a caller cares about, pulled back off the registry.
 *
 * Both used to spell the other half as `any` with an eslint-disable over it.
 * `infer` is what they wanted: `Tool<infer I, infer O>` matches the same tools
 * and names nothing, so `unknown` never leaks and the suppression goes with it.
 * `unknown` in place of the `any` is NOT equivalent and was the reason for the
 * suppression — `Tool` is invariant in `O` (it is a `run` return AND a
 * `describe` parameter), so `Tool<I, string>` does not extend `Tool<I, unknown>`
 * and every tool would have resolved to `never`.
 */
export type InputOf<N extends ToolName> =
  (typeof TOOLS)[N] extends Tool<infer I, infer _O> ? I : never
export type OutputOf<N extends ToolName> =
  (typeof TOOLS)[N] extends Tool<infer _I, infer O> ? O : never

/**
 * The registry key is the authority on a tool's name.
 *
 * Checked here rather than by typing `Tool['name']` as `ToolName`, which reads
 * better and does not compile: `ToolName` is `keyof typeof TOOLS`, and TOOLS'
 * type would then depend on the tools' own `name` fields depending on TOOLS. A
 * throw at module load is a test that cannot be forgotten — an entry filed under
 * the wrong key would otherwise announce itself as the wrong verb in the palette
 * and the wrong label in the undo toast, months later.
 */
for (const [key, tool] of Object.entries(TOOLS) as [ToolName, AnyTool][]) {
  if (tool.name !== key) {
    throw new Error(`Tool registered as '${key}' calls itself '${tool.name}'.`)
  }
}
