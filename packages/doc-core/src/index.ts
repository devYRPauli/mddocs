export * from '../../../src/formats/marks.js';
// Explicit re-export of provenance-sidecar to avoid name collisions with marks.js:
// createComment, getUnresolvedComments, and CommentReply are intentionally omitted
// here because marks.js owns those names in the new marks-based API.
export type {
  AttestationLevel,
  TextOrigin,
  ProvenanceSpan,
  AttentionData,
  AttentionEventType,
  AttentionEvent,
  ProvenanceMetadata,
  CommentSelector,
  Comment,
  ProvenanceData,
} from '../../../src/formats/provenance-sidecar.js';
export {
  migrateLegacyProvenance,
  isLegacyFormat,
  extractEmbeddedProvenance,
  generateCommentId,
  generateReplyId,
  createReply,
  addComment,
  addReplyToComment,
  setCommentResolved,
  deleteComment,
  ensureCommentsArray,
} from '../../../src/formats/provenance-sidecar.js';
export * from '../../../src/formats/remark-proof-marks.js';
export * from '../../../src/shared/agent-identity.js';
