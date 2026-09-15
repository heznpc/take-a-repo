const { renderTable } = require('./utils');

/**
 * Render the extracted fields into a single copy-paste doc.
 * @param {ReturnType<import('./listing').extractListing>} listing
 * @returns {string}
 */
function renderDescriptionDoc(listing) {
  const block = (label, body) => `## ${label}\n\n${body || '(missing)'}\n`;
  return [
    '# Store listing — copy/paste fields',
    '',
    `> Generated from ${listing.source || 'STORE_LISTING.md'} by take-a-repo. Edit the`,
    '> source file, not this file.',
    '',
    block('Title', listing.title),
    block('Summary (short description)', listing.summary),
    block('Description', listing.description),
    block("What's new", listing.whatsNew),
    block('Category', listing.category),
    listing.warnings.length ? `> ⚠️ ${listing.warnings.join('; ')}\n` : '',
  ].join('\n');
}

function renderPrivacyDisclosureDoc(privacy) {
  const permissionRows = privacy.permissions.map((p) => [
    p.name,
    p.purpose || '(missing)',
    p.disclosure || '(missing)',
    p.optional ? 'yes' : 'no',
  ]);
  const dataRows = privacy.dataFlows.map((flow) => [
    flow.data || '(unspecified)',
    flow.source || '(unspecified)',
    flow.destination || '(unspecified)',
    flow.purpose || '(missing)',
    flow.retention || '(unspecified)',
  ]);
  const notes = privacy.notes.length ? privacy.notes.map((note) => `- ${note}`).join('\n') : '(none declared)';
  return [
    '# Privacy disclosure worksheet',
    '',
    '> Generated from product.manifest.json by take-a-repo. This is a review',
    '> worksheet for store disclosures and README permission tables, not a',
    '> privacy policy or legal text.',
    '',
    `## Data collection`,
    '',
    privacy.dataCollection || '(not declared)',
    '',
    `## Data use`,
    '',
    privacy.dataUse || '(not declared)',
    '',
    '## Permissions',
    '',
    renderTable(['Permission', 'Purpose', 'User-facing disclosure', 'Optional'], permissionRows, '(none declared)'),
    '## Data flows',
    '',
    renderTable(['Data', 'Source', 'Destination', 'Purpose', 'Retention'], dataRows, '(none declared)'),
    '## Notes',
    '',
    notes,
    '',
    privacy.warnings.length ? `> ⚠️ ${privacy.warnings.join('; ')}\n` : '',
  ].join('\n');
}

module.exports = {
  renderDescriptionDoc,
  renderPrivacyDisclosureDoc,
};
