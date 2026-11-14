/**
 * The prop schema for every node type, assembled from the per-domain modules
 * beside it. See `validate.ts` for what the trust boundary promises.
 */

import type { NodePropsByType, NodeType } from './model'
import type { Schema } from './schema'
import { backgroundProps, claimProps, profileProps, threadProps } from './validate-props-self'
import {
  fileProps,
  keywordProps,
  linkProps,
  personProps,
  snippetProps,
} from './validate-props-vault'
import {
  applicationProps,
  matchProps,
  organisationProps,
  pipelineProps,
  postingProps,
  proposalProps,
  stickyNoteProps,
  timelineItemProps,
} from './validate-props-work'

/* ------------------------------ props schemas ----------------------------- */

/**
 * One schema per node type, and the palette generates its form from these.
 *
 * Listed in the order the types were always declared here, so anything that
 * walks the keys sees them as it always has.
 */
export const NODE_PROP_SCHEMAS = {
  application: applicationProps,
  organisation: organisationProps,
  timelineItem: timelineItemProps,
  keyword: keywordProps,
  link: linkProps,
  file: fileProps,
  snippet: snippetProps,
  claim: claimProps,
  background: backgroundProps,
  person: personProps,
  thread: threadProps,
  posting: postingProps,
  stickyNote: stickyNoteProps,
  match: matchProps,
  pipeline: pipelineProps,
  proposal: proposalProps,
  profile: profileProps,
} satisfies { [T in NodeType]: Schema<NodePropsByType[T]> }

export function propSchemaFor(type: NodeType): Schema<unknown> {
  return NODE_PROP_SCHEMAS[type]
}
