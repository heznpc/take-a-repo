const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  approvalGate,
  deliveryStatus,
  emptyApprovalDocument,
  loadApproval,
  syncManifestApproval,
  updateApprovalDecision,
  updateApprovalDecisions,
} = require('../src/approval');

const DIGEST = 'a'.repeat(64);

function manifest(targetStatus = 'publish-ready') {
  return {
    assets: [{ id: 'sns-demo-mp4:demo-shorts', integrity: { algorithm: 'sha256', digest: DIGEST } }],
    handoff: {
      automation: {
        status: targetStatus === 'publish-ready' ? 'publish-ready' : 'needs-fix',
        targets: [{
          target: 'youtube-shorts',
          story: 'demo',
          demo: 'demo-shorts',
          status: targetStatus,
          profileHash: 'profile-1',
          deliverable: { id: 'sns-demo-mp4:demo-shorts' },
        }],
      },
      summary: {},
    },
  };
}

function decision(status, overrides = {}) {
  return {
    status,
    assetDigest: DIGEST,
    profileHash: 'profile-1',
    decidedAt: '2026-07-10T00:00:00.000Z',
    ...(status === 'changes-requested' ? { note: 'Move the result higher.' } : {}),
    ...overrides,
  };
}

describe('user approval gate', () => {
  test('holds a technically ready target for user review', () => {
    const value = manifest();
    syncManifestApproval(value, emptyApprovalDocument());
    expect(value.handoff.approval).toMatchObject({
      status: 'awaiting-approval',
      userActionRequired: true,
      publishable: false,
      targets: [{ status: 'awaiting-approval', stale: false }],
    });
    expect(deliveryStatus(value)).toBe('awaiting-approval');
  });

  test.each([
    ['approved', 'approved', true],
    ['changes-requested', 'changes-requested', false],
  ])('applies a current %s decision', (decisionStatus, expectedStatus, publishable) => {
    const value = manifest();
    const document = emptyApprovalDocument();
    document.decisions.demo = { 'youtube-shorts': decision(decisionStatus) };
    const gate = approvalGate(value, document);
    expect(gate).toMatchObject({ status: expectedStatus, publishable });
    expect(gate.targets[0]).toMatchObject({ status: expectedStatus, stale: false });
  });

  test('expires approval when the deliverable digest changes', () => {
    const value = manifest();
    const document = emptyApprovalDocument();
    document.decisions.demo = {
      'youtube-shorts': decision('approved', { assetDigest: 'b'.repeat(64) }),
    };
    expect(approvalGate(value, document)).toMatchObject({
      status: 'awaiting-approval',
      targets: [{ status: 'awaiting-approval', stale: true }],
    });
  });

  test('does not replace technical failure with an approval state', () => {
    const value = manifest('needs-fix');
    syncManifestApproval(value, emptyApprovalDocument());
    expect(value.handoff.approval.status).toBe('not-ready');
    expect(deliveryStatus(value)).toBe('needs-fix');
  });

  test('keeps a technically ready target not-ready when its deliverable is missing', () => {
    const value = manifest();
    value.assets = [];
    expect(approvalGate(value, emptyApprovalDocument())).toMatchObject({
      status: 'not-ready',
      userActionRequired: false,
      publishable: false,
      targets: [{ status: 'not-ready', assetDigest: null }],
    });
  });

  test('invalidates approval when current profile context is unverified', () => {
    const value = manifest();
    const document = emptyApprovalDocument();
    document.decisions.demo = { 'youtube-shorts': decision('approved') };
    const gate = approvalGate(value, document, {
      targetContext: () => ({ ready: false, profileHash: 'profile-2' }),
    });
    expect(gate).toMatchObject({
      status: 'not-ready',
      publishable: false,
      targets: [{ status: 'not-ready', profileHash: 'profile-2', stale: true }],
    });
  });

  test('atomically writes and reloads user feedback', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-approval-'));
    try {
      updateApprovalDecision(outDir, 'demo', 'youtube-shorts', {
        status: 'changes-requested',
        assetDigest: DIGEST,
        profileHash: 'profile-1',
        note: 'Keep the CTA clear.',
      });
      expect(loadApproval(outDir).document.decisions.demo['youtube-shorts']).toMatchObject({
        status: 'changes-requested',
        note: 'Keep the CTA clear.',
      });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('rejects reserved decision keys', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-approval-'));
    try {
      expect(() => updateApprovalDecision(outDir, '__proto__', 'youtube-shorts', {
        status: 'approved',
        assetDigest: DIGEST,
      })).toThrow('uses a reserved key');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('validates a multi-target decision batch before writing it once', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-approval-'));
    const filePath = path.join(outDir, 'take-a-repo-approval.json');
    try {
      expect(() => updateApprovalDecisions(outDir, [
        { story: 'demo', target: 'x', decision: { status: 'approved', assetDigest: DIGEST } },
        { story: 'demo', target: 'youtube-shorts', decision: { status: 'approved', assetDigest: 'invalid' } },
      ])).toThrow('must be a SHA-256 digest');
      expect(fs.existsSync(filePath)).toBe(false);

      const updated = updateApprovalDecisions(outDir, [
        { story: 'demo', target: 'x', decision: { status: 'approved', assetDigest: DIGEST } },
        { story: 'demo', target: 'youtube-shorts', decision: { status: 'approved', assetDigest: DIGEST } },
      ], () => new Date('2026-07-11T12:00:00.000Z'));
      expect(updated.document.decisions.demo.x.decidedAt).toBe('2026-07-11T12:00:00.000Z');
      expect(updated.document.decisions.demo['youtube-shorts'].decidedAt).toBe('2026-07-11T12:00:00.000Z');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
