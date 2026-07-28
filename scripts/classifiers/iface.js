// scripts/classifiers/iface.js
'use strict';
/**
 * @typedef {Object} ClassifyContext
 * @property {string} pageId
 * @property {string} title
 * @property {string} body
 * @property {string[]} ancestors
 * @property {string} sourceSpace
 * @property {string} sourceUrl
 * @property {string} pageDate
 * @property {string[]} existingLabels
 *
 * @typedef {Object} ClassifyResult
 * @property {boolean} ok
 * @property {'human'|'rule'|'claude'|'fallback'|'miss'} source
 * @property {string} [folderId]
 * @property {string} [folderTitle]
 * @property {string[]} [labels]
 * @property {string} [reason]
 *
 * @typedef {Object} ClassifierIface
 * @property {string} name
 * @property {(ctx: ClassifyContext, aaTree: import('../utils/aa_space_tree').fetchAATree extends () => Promise<infer T> ? T : never) => Promise<ClassifyResult>} classify
 */

module.exports = {};