const fs = require('fs');
const path = require('path');
const { HANDOFF_SCHEMA_IDS } = require('../src/handoff');

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', name), 'utf8'));
}

describe('packaged handoff schemas', () => {
  test('schema ids match runtime handoff constants', () => {
    expect(readSchema('take-a-repo-manifest.schema.json').$id).toBe(HANDOFF_SCHEMA_IDS.manifest);
    expect(readSchema('storyboard.schema.json').$id).toBe(HANDOFF_SCHEMA_IDS.storyboard);
    expect(readSchema('captions.schema.json').$id).toBe(HANDOFF_SCHEMA_IDS.captions);
    expect(readSchema('approval.schema.json').$id).toBe(HANDOFF_SCHEMA_IDS.approval);
  });

  test('schemas declare the expected document kinds', () => {
    expect(readSchema('take-a-repo-manifest.schema.json').properties.kind.const).toBe('take-a-repo.manifest');
    expect(readSchema('storyboard.schema.json').properties.kind.const).toBe('take-a-repo.storyboard');
    expect(readSchema('captions.schema.json').properties.kind.const).toBe('take-a-repo.captions');
    expect(readSchema('approval.schema.json').properties.kind.const).toBe('take-a-repo.approval');
  });

  test('v1 keeps its constants and adds the agent-ready category compatibly', () => {
    expect(readSchema('take-a-repo-manifest.schema.json').properties.positioning.const)
      .toBe('capture-and-handoff-kit');
    expect(readSchema('take-a-repo-manifest.schema.json').properties.category.const)
      .toBe('agent-ready-launch-asset-pipeline');
    expect(readSchema('storyboard.schema.json').properties.purpose.const)
      .toBe('browser-extension-demo-starter-pack');
  });
});
