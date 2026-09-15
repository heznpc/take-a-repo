const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SCHEMAS = Object.freeze({
  manifest: 'take-a-repo-manifest.schema.json',
  storyboard: 'storyboard.schema.json',
  captions: 'captions.schema.json',
});

let validators;

function handoffValidators() {
  if (validators) return validators;
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  validators = Object.fromEntries(Object.entries(SCHEMAS).map(([key, filename]) => {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', filename), 'utf8'));
    return [key, ajv.compile(schema)];
  }));
  return validators;
}

function validationMessage(key, errors) {
  const detail = (errors || []).map((error) => (
    `${error.instancePath || '/'} ${error.message}`
  )).join('; ');
  return `${key} does not match its packaged schema${detail ? `: ${detail}` : ''}`;
}

function validateHandoffDocs(docs) {
  for (const [key, validate] of Object.entries(handoffValidators())) {
    if (!validate(docs && docs[key])) {
      throw new Error(validationMessage(key, validate.errors));
    }
  }
  return true;
}

function isValidHandoffDocs(docs) {
  try {
    validateHandoffDocs(docs);
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = { isValidHandoffDocs, validateHandoffDocs };
