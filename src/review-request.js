class ReviewRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ReviewRequestError';
    this.status = status;
  }
}

function validateReviewDecision(body) {
  if (!['approved', 'changes-requested'].includes(body.status)) {
    throw new ReviewRequestError(400, 'review status must be approved or changes-requested');
  }
  if (body.status === 'changes-requested' && (typeof body.note !== 'string' || !body.note.trim())) {
    throw new ReviewRequestError(400, 'review feedback is required when changes are requested');
  }
  if (typeof body.note === 'string' && body.note.trim().length > 2000) {
    throw new ReviewRequestError(400, 'review feedback must be at most 2000 characters');
  }
}

function isStale(candidate, target) {
  return candidate.assetDigest !== target.assetDigest
    || (candidate.profileHash || null) !== (target.profileHash || null);
}

function decisionFor(body, target) {
  return {
    status: body.status,
    assetDigest: target.assetDigest,
    ...(target.profileHash ? { profileHash: target.profileHash } : {}),
    note: body.note,
  };
}

function validateCampaignReview({ body, recipes, current }) {
  validateReviewDecision(body);
  const recipe = recipes.find((item) => item.id === body.recipeId);
  if (!recipe) throw new ReviewRequestError(400, 'take-a-repo: campaign recipe was not found');
  if (!Array.isArray(body.candidates) || !body.candidates.length) {
    throw new ReviewRequestError(400, 'review candidates must be a non-empty array');
  }
  const availableTargets = new Set(recipe.targets.map((target) => target.id));
  const candidateTargets = body.candidates.map((candidate) => candidate && candidate.target);
  if (candidateTargets.some((target) => typeof target !== 'string' || !availableTargets.has(target))
    || new Set(candidateTargets).size !== candidateTargets.length) {
    throw new ReviewRequestError(400, 'review candidates contain an unavailable or duplicate target');
  }
  const selected = candidateTargets.map((target) => current.targets.find((item) => (
    item.story === recipe.story && item.target === target
  )));
  if (selected.some((target) => !target)) {
    throw new ReviewRequestError(404, 'configured story/target was not found');
  }
  if (selected.some((target) => !target.reviewable)) {
    throw new ReviewRequestError(409, 'every selected target must be ready for user review');
  }
  if (selected.some((target, index) => isStale(body.candidates[index], target))) {
    throw new ReviewRequestError(409, 'review candidate is stale; reload the final media before deciding');
  }
  return {
    recipe,
    selected,
    decisions: selected.map((target) => ({
      story: recipe.story,
      target: target.target,
      decision: decisionFor(body, target),
    })),
  };
}

function validateSingleReview({ body, current }) {
  validateReviewDecision(body);
  const selected = current.targets.find((item) => (
    item.story === body.story && item.target === body.target
  ));
  if (!selected) throw new ReviewRequestError(404, 'configured story/target was not found');
  if (!selected.reviewable) {
    throw new ReviewRequestError(409, 'target must pass machine QA and recapture verification before user review');
  }
  if (isStale(body, selected)) {
    throw new ReviewRequestError(409, 'review candidate is stale; reload the final media before deciding');
  }
  return { selected, decision: decisionFor(body, selected) };
}

module.exports = {
  ReviewRequestError,
  validateCampaignReview,
  validateReviewDecision,
  validateSingleReview,
};
