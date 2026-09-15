import { clamp, clone, keyFor, profileDefaults, round } from './model.js';
import { createPreviewController } from './preview.js';
import { createRegionEditor } from './regions.js';

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elements = {
    app: $('app'),
    projectName: $('projectName'),
    statusDot: $('statusDot'),
    targetStatus: $('targetStatus'),
    operationState: $('operationState'),
    recaptureButton: $('recaptureButton'),
    saveButton: $('saveButton'),
    requestChangesButton: $('requestChangesButton'),
    approveButton: $('approveButton'),
    targetCount: $('targetCount'),
    targetList: $('targetList'),
    layoutCount: $('layoutCount'),
    layoutList: $('layoutList'),
    captureName: $('captureName'),
    captureIdentity: $('captureIdentity'),
    warningSummary: $('warningSummary'),
    warningCount: $('warningCount'),
    viewportLabel: $('viewportLabel'),
    canvasFrame: $('canvasFrame'),
    previewVideo: $('previewVideo'),
    previewCanvas: $('previewCanvas'),
    previewPoster: $('previewPoster'),
    mediaEmpty: $('mediaEmpty'),
    captionLane: $('captionLane'),
    captionPreview: $('captionPreview'),
    regionLayer: $('regionLayer'),
    focusPoint: $('focusPoint'),
    profileName: $('profileName'),
    profileState: $('profileState'),
    profileForm: $('profileForm'),
    reviewState: $('reviewState'),
    reviewNote: $('reviewNote'),
    bottomOffsetRange: $('bottomOffsetRange'),
    bottomOffsetNumber: $('bottomOffsetNumber'),
    zoomRange: $('zoomRange'),
    zoomNumber: $('zoomNumber'),
    focusX: $('focusX'),
    focusY: $('focusY'),
    regionTabs: $('regionTabs'),
    deleteRegionButton: $('deleteRegionButton'),
    addRegionButton: $('addRegionButton'),
    regionEmpty: $('regionEmpty'),
    regionFields: $('regionFields'),
    regionX: $('regionX'),
    regionY: $('regionY'),
    regionWidth: $('regionWidth'),
    regionHeight: $('regionHeight'),
    warningsBadge: $('warningsBadge'),
    warningsList: $('warningsList'),
    beatSummary: $('beatSummary'),
    timeReadout: $('timeReadout'),
    beatList: $('beatList'),
    notice: $('notice'),
    noticeTitle: $('noticeTitle'),
    noticeMessage: $('noticeMessage'),
    noticeClose: $('noticeClose'),
  };

  const state = {
    document: null,
    selectedKey: null,
    target: null,
    profile: null,
    selectedRegionId: null,
    dirty: false,
    busy: false,
  };
  let noticeReturnFocus = null;

  function showNotice(title, message) {
    if (elements.notice.hidden && document.activeElement instanceof HTMLElement) {
      noticeReturnFocus = document.activeElement;
    }
    elements.noticeTitle.textContent = title;
    elements.noticeMessage.textContent = message;
    elements.notice.hidden = false;
    elements.noticeClose.focus();
  }

  function dismissNotice() {
    elements.notice.hidden = true;
    if (noticeReturnFocus && noticeReturnFocus.isConnected) noticeReturnFocus.focus();
    noticeReturnFocus = null;
  }

  function setOperation(label) {
    elements.operationState.textContent = label;
  }

  function setBusy(busy, label) {
    state.busy = busy;
    elements.app.setAttribute('aria-busy', busy ? 'true' : 'false');
    elements.saveButton.disabled = busy || !state.target || !state.dirty;
    elements.recaptureButton.disabled = busy || !state.target;
    const reviewable = !!(state.target && state.target.reviewable);
    const reviewStatus = state.target && state.target.review ? state.target.review.status : 'not-ready';
    elements.requestChangesButton.disabled = busy || !reviewable || reviewStatus === 'changes-requested';
    elements.approveButton.disabled = busy || !reviewable || reviewStatus === 'approved';
    elements.profileForm.toggleAttribute('inert', busy);
    if (label) setOperation(label);
  }

  function markDirty() {
    if (!state.profile || state.busy) return;
    state.dirty = true;
    delete state.profile.verification;
    elements.profileState.textContent = 'Unsaved';
    elements.profileState.className = 'profile-state is-dirty';
    elements.saveButton.disabled = false;
  }

  const preview = createPreviewController({ elements, state, markDirty });
  const regions = createRegionEditor({ elements, state, markDirty });

  function setProfileState() {
    if (!state.profile) {
      elements.profileState.textContent = 'Read only';
      elements.profileState.className = 'profile-state';
      return;
    }
    const verified = state.target && state.target.verified;
    const persisted = state.target && state.target.hasProfile;
    elements.profileState.textContent = verified ? 'Verified' : persisted ? 'Saved' : 'Draft';
    elements.profileState.className = verified ? 'profile-state is-verified' : 'profile-state';
  }

  function renderTargetStatus() {
    const status = state.target.status;
    const labels = {
      approved: 'Approved',
      'awaiting-approval': 'Ready for review',
      'changes-requested': 'Changes requested',
      'needs-fix': 'Needs fix',
      blocked: 'Blocked',
      'not-requested': 'Not requested',
    };
    elements.targetStatus.textContent = labels[status] || status.replaceAll('-', ' ');
    const tone = status === 'approved' ? 'is-ready'
      : status === 'not-requested' ? 'is-neutral'
        : status === 'changes-requested' || status === 'blocked' ? 'is-error'
          : 'is-warning';
    elements.statusDot.className = `status-dot ${tone}`;
  }

  function renderReview() {
    const review = state.target.review || { status: 'not-ready' };
    const labels = {
      approved: 'Approved',
      'awaiting-approval': 'Awaiting decision',
      'changes-requested': 'Changes requested',
      'not-ready': 'Not ready',
    };
    elements.reviewState.textContent = labels[review.status] || review.status;
    elements.reviewState.className = `review-state ${review.status === 'approved' ? 'is-approved' : review.status === 'changes-requested' ? 'is-changes' : review.status === 'awaiting-approval' ? 'is-awaiting' : ''}`;
    elements.reviewNote.value = review.decision && review.decision.note ? review.decision.note : '';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  async function loadState(preferredKey = state.selectedKey) {
    setBusy(true, 'Loading');
    try {
      const currentUrl = new URL(window.location.href);
      const requestedTarget = new URLSearchParams();
      if (currentUrl.searchParams.get('story')) requestedTarget.set('story', currentUrl.searchParams.get('story'));
      if (currentUrl.searchParams.get('target')) requestedTarget.set('target', currentUrl.searchParams.get('target'));
      const targetQuery = requestedTarget.toString();
      state.document = await api(`/api/state${targetQuery ? `?${targetQuery}` : ''}`);
      elements.projectName.textContent = state.document.project || 'Project';
      elements.targetCount.textContent = String(state.document.targets.length);
      const preferred = state.document.targets.find((target) => keyFor(target) === preferredKey);
      const selected = preferred || state.document.targets.find((target) => (
        state.document.selected && target.story === state.document.selected.story && target.target === state.document.selected.target
      )) || state.document.targets[0];
      if (selected) selectTarget(selected, { force: true });
      else renderEmpty();
      setOperation('Ready');
    } catch (error) {
      showNotice('Could not load project', error.message);
      setOperation('Connection failed');
    } finally {
      elements.app.setAttribute('aria-busy', 'false');
      setBusy(false);
    }
  }

  function renderEmpty() {
    state.target = null;
    state.profile = null;
    elements.targetList.replaceChildren();
    elements.layoutList.replaceChildren();
    elements.captureName.textContent = 'No calibrated target';
    elements.captureIdentity.textContent = 'Add a channel target to take-a-repo.config.js';
    elements.mediaEmpty.hidden = false;
    elements.previewVideo.hidden = true;
    elements.recaptureButton.disabled = true;
    elements.saveButton.disabled = true;
    elements.requestChangesButton.disabled = true;
    elements.approveButton.disabled = true;
  }

  function selectTarget(target, { force = false } = {}) {
    if (!force && state.dirty && !window.confirm('Discard unsaved calibration changes?')) return;
    state.target = target;
    state.selectedKey = keyFor(target);
    state.profile = profileDefaults(target);
    state.selectedRegionId = state.profile.protectedRegions[0] && state.profile.protectedRegions[0].id;
    state.dirty = false;
    renderAll();
  }

  function createTargetButton(target) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'target-item';
    button.dataset.status = target.status;
    button.setAttribute('aria-current', keyFor(target) === state.selectedKey ? 'true' : 'false');
    const title = document.createElement('strong');
    title.textContent = target.story;
    const subtitle = document.createElement('span');
    subtitle.textContent = target.target;
    const dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    button.append(title, subtitle, dot);
    button.addEventListener('click', () => selectTarget(target));
    return button;
  }

  function renderTargets() {
    elements.targetList.replaceChildren(...state.document.targets.map(createTargetButton));
  }

  function renderLayouts() {
    const layouts = state.target.layouts.length ? state.target.layouts : ['default'];
    elements.layoutCount.textContent = String(layouts.length);
    const buttons = layouts.map((layout) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'layout-item';
      button.setAttribute('aria-pressed', state.profile.layoutPreset === layout ? 'true' : 'false');
      button.textContent = layout.replaceAll('-', ' ');
      button.addEventListener('click', () => {
        state.profile.layoutPreset = layout;
        markDirty();
        for (const item of elements.layoutList.querySelectorAll('.layout-item')) {
          item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
        }
      });
      return button;
    });
    elements.layoutList.replaceChildren(...buttons);
  }

  function renderWarnings() {
    const warnings = state.target.warnings || [];
    elements.warningCount.textContent = String(warnings.length);
    elements.warningSummary.setAttribute('aria-label', `View ${warnings.length} target warning${warnings.length === 1 ? '' : 's'}`);
    elements.warningSummary.hidden = warnings.length === 0;
    elements.warningsBadge.textContent = String(warnings.length);
    if (!warnings.length) {
      const item = document.createElement('li');
      item.className = 'no-warnings';
      item.textContent = 'No warnings';
      elements.warningsList.replaceChildren(item);
      return;
    }
    elements.warningsList.replaceChildren(...warnings.map((warning) => {
      const item = document.createElement('li');
      item.textContent = `${warning.message}${warning.fix ? ` - ${warning.fix}` : ''}`;
      return item;
    }));
  }

  function syncControls() {
    const { captionOptions, framing } = state.profile;
    const position = document.querySelector(`input[name="captionPosition"][value="${captionOptions.position}"]`);
    const appearance = document.querySelector(`input[name="captionAppearance"][value="${captionOptions.appearance}"]`);
    if (position) position.checked = true;
    if (appearance) appearance.checked = true;
    const maxOffset = Math.max(0, state.target.viewport.height - 96);
    elements.bottomOffsetRange.max = String(maxOffset);
    elements.bottomOffsetNumber.max = String(maxOffset);
    elements.bottomOffsetRange.value = String(clamp(captionOptions.bottomOffset, 0, maxOffset));
    elements.bottomOffsetNumber.value = elements.bottomOffsetRange.value;
    elements.zoomRange.value = String(framing.scale);
    elements.zoomNumber.value = String(framing.scale);
    elements.focusX.value = String(Math.round(framing.focusX * 100));
    elements.focusY.value = String(Math.round(framing.focusY * 100));
  }

  function renderAll() {
    const target = state.target;
    renderTargets();
    renderLayouts();
    preview.setMedia(target);
    elements.captureName.textContent = target.name;
    elements.captureIdentity.textContent = `${target.story} / ${target.target}`;
    elements.viewportLabel.textContent = `${target.viewport.width} x ${target.viewport.height}`;
    elements.profileName.textContent = `${target.story} / ${target.target}`;
    renderTargetStatus();
    renderReview();
    setProfileState();
    syncControls();
    preview.applyGeometry();
    regions.render();
    renderWarnings();
    preview.renderBeats();
    elements.saveButton.disabled = true;
    elements.recaptureButton.disabled = false;
    setBusy(state.busy);
  }

  function profilePayload() {
    return clone(state.profile);
  }

  async function saveProfile() {
    if (!state.target || !state.dirty) return;
    setBusy(true, 'Saving profile');
    try {
      const result = await api('/api/profile', {
        method: 'POST',
        body: JSON.stringify({
          story: state.target.story,
          target: state.target.target,
          profile: profilePayload(),
        }),
      });
      state.profile = profileDefaults({ ...state.target, profile: result.profile });
      state.target.profile = clone(result.profile);
      state.target.hasProfile = true;
      state.target.verified = false;
      state.target.status = 'needs-fix';
      state.target.reviewable = false;
      state.target.publishable = false;
      state.target.review = { status: 'not-ready', stale: true };
      state.dirty = false;
      setProfileState();
      renderTargetStatus();
      renderReview();
      renderTargets();
      setOperation('Saved');
    } catch (error) {
      showNotice('Profile was not saved', error.message);
      setOperation('Save failed');
    } finally {
      setBusy(false);
      elements.saveButton.disabled = !state.dirty;
    }
  }

  async function recapture() {
    if (!state.target) return;
    if (state.dirty || !state.target.hasProfile) {
      if (!state.dirty) state.dirty = true;
      await saveProfile();
    }
    if (state.dirty) return;
    const selectedKey = state.selectedKey;
    setBusy(true, 'Recapturing with Chromium');
    try {
      const result = await api('/api/recapture', {
        method: 'POST',
        body: JSON.stringify({ story: state.target.story, target: state.target.target }),
      });
      setOperation(result.status === 'publish-ready' ? 'Verified' : result.status || 'Finished');
      elements.previewVideo.dataset.source = '';
      await loadState(selectedKey);
      setOperation(result.machineStatus === 'publish-ready' ? 'Ready for review' : result.status || 'Finished');
    } catch (error) {
      showNotice('Recapture failed', error.message);
      setOperation('Recapture failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(status) {
    if (!state.target || !state.target.reviewable) return;
    const note = elements.reviewNote.value.trim();
    if (status === 'changes-requested' && !note) {
      showNotice('Feedback is required', 'Tell the agent what should change before requesting another pass.');
      elements.reviewNote.focus();
      return;
    }
    const selectedKey = state.selectedKey;
    setBusy(true, status === 'approved' ? 'Approving capture' : 'Sending feedback');
    try {
      await api('/api/review', {
        method: 'POST',
        body: JSON.stringify({
          story: state.target.story,
          target: state.target.target,
          status,
          assetDigest: state.target.assetDigest,
          ...(state.target.profileHash ? { profileHash: state.target.profileHash } : {}),
          ...(status === 'changes-requested' ? { note } : {}),
        }),
      });
      await loadState(selectedKey);
      setOperation(status === 'approved' ? 'Approved by user' : 'Changes requested');
    } catch (error) {
      showNotice('Review decision was not saved', error.message);
      setOperation('Review failed');
    } finally {
      setBusy(false);
    }
  }

  function bindNumberPair(range, number, apply) {
    const update = (source) => {
      if (source.value === '' || !Number.isFinite(Number(source.value))) return;
      const value = clamp(Number(source.value), Number(source.min), Number(source.max));
      range.value = String(value);
      number.value = String(value);
      apply(value);
      markDirty();
      preview.applyGeometry();
    };
    range.addEventListener('input', () => update(range));
    number.addEventListener('input', () => update(number));
  }

  function bindEvents() {
    elements.saveButton.addEventListener('click', saveProfile);
    elements.recaptureButton.addEventListener('click', recapture);
    elements.requestChangesButton.addEventListener('click', () => submitReview('changes-requested'));
    elements.approveButton.addEventListener('click', () => submitReview('approved'));
    elements.noticeClose.addEventListener('click', dismissNotice);
    elements.warningSummary.addEventListener('click', () => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('warningsSection').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    preview.bind();
    regions.bind();

    document.querySelectorAll('input[name="captionPosition"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.profile.captionOptions.position = input.value;
        markDirty();
        preview.applyGeometry();
      });
    });
    document.querySelectorAll('input[name="captionAppearance"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.profile.captionOptions.appearance = input.value;
        markDirty();
        preview.applyGeometry();
      });
    });
    bindNumberPair(elements.bottomOffsetRange, elements.bottomOffsetNumber, (value) => {
      state.profile.captionOptions.bottomOffset = Math.round(value);
    });
    bindNumberPair(elements.zoomRange, elements.zoomNumber, (value) => {
      state.profile.framing.scale = round(value, 2);
    });
    elements.focusX.addEventListener('input', () => {
      if (elements.focusX.value === '' || !Number.isFinite(Number(elements.focusX.value))) return;
      state.profile.framing.focusX = clamp(Number(elements.focusX.value) / 100, 0, 1);
      markDirty();
      preview.applyGeometry();
    });
    elements.focusY.addEventListener('input', () => {
      if (elements.focusY.value === '' || !Number.isFinite(Number(elements.focusY.value))) return;
      state.profile.framing.focusY = clamp(Number(elements.focusY.value) / 100, 0, 1);
      markDirty();
      preview.applyGeometry();
    });
  }

  bindEvents();
  loadState();
})();
