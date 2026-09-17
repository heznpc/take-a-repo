const config = require('./take-a-repo.config');

// Both producers exercise the local service.js; no remote state is cached.
module.exports = {
  ...config,
  outDir: process.env.TAKE_A_REPO_EXAMPLE_OUT || 'product-evidence/production',
  evidence: {
    ...config.evidence,
    producers: config.evidence.producers.map((producer) => ({
      ...producer,
      reuse: { mode: 'local-inputs', inputs: ['collect.js', 'service.js'], maxAgeSeconds: 86400 },
    })),
  },
};
