/**
 * Milkdown plugin for remark-proof-marks
 *
 * Uses $remark to properly integrate the remark plugin with Milkdown's
 * parsing pipeline.
 */

import { $remark } from '@milkdown/kit/utils';
import { remarkProofMarks as remarkProofMarksCore } from '../../formats/remark-proof-marks.js';

/**
 * Milkdown plugin that integrates remarkProofMarks with the parsing pipeline.
 * This ensures the remark plugin runs during both parsing and serialization.
 *
 * Note: $remark expects () => () => transformer signature
 */
export const remarkProofMarksPlugin = $remark('remarkProofMarks', () => () => remarkProofMarksCore());
