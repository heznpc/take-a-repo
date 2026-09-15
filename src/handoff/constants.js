const { APPROVAL_SCHEMA_ID } = require('../approval');

const HANDOFF_VERSION = 1;
const HANDOFF_KINDS = Object.freeze({
  manifest: 'take-a-repo.manifest',
  storyboard: 'take-a-repo.storyboard',
  captions: 'take-a-repo.captions',
});
const HANDOFF_SCHEMA_IDS = Object.freeze({
  manifest: 'urn:starter-series:take-a-repo:schema:take-a-repo-manifest:v1',
  storyboard: 'urn:starter-series:take-a-repo:schema:storyboard:v1',
  captions: 'urn:starter-series:take-a-repo:schema:captions:v1',
  approval: APPROVAL_SCHEMA_ID,
});
const HANDOFF_SCHEMA_FILES = Object.freeze({
  manifest: 'schemas/take-a-repo-manifest.schema.json',
  storyboard: 'schemas/storyboard.schema.json',
  captions: 'schemas/captions.schema.json',
  approval: 'schemas/approval.schema.json',
});

module.exports = {
  HANDOFF_KINDS,
  HANDOFF_SCHEMA_FILES,
  HANDOFF_SCHEMA_IDS,
  HANDOFF_VERSION,
};
