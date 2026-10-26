import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationInputRejectionCode } from '../src/verification-input-error.js';
import { VerificationError } from '../src/verification-domain.js';

test('input diagnosis exposes static rejection codes without echoing browser URLs or exception text', () => {
  for (const code of ['VERIFICATION_INPUT_INVALID', 'VERIFICATION_FRAME_STALE_DOM_CLASS', 'VERIFICATION_FRAME_STALE_DOM_STYLE_PARENT', 'VERIFICATION_FRAME_STALE_EXPIRED', 'VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_SPM_ANCHOR_ID_HANDLE', 'VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_OTHER_ANCESTOR_PARENT', 'VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_SPM_ANCHOR_ID_HANDLE_GUARD_STYLE_OUTLINE_WIDTH_HANDLE', 'VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_SPM_ANCHOR_ID_HANDLE_GUARD_UNARMED']) assert.equal(verificationInputRejectionCode(new Error(code)), code);
  assert.equal(verificationInputRejectionCode(new VerificationError('VERIFICATION_CONTROL_EXPIRED')), 'VERIFICATION_CONTROL_EXPIRED');
  for (const error of [new Error('navigation failed https://fixture.invalid/?x5secdata=private'), new Error('VERIFICATION_FRAME_STALE_token-private'), 'private exception']) assert.equal(verificationInputRejectionCode(error), 'VERIFICATION_INPUT_REJECTED');
});

test('render diagnosis permits fixed CSS names and tag roles while excluding custom properties, identifiers and values', () => {
  const prefix = 'VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_SPM_ANCHOR_ID_HANDLE_GUARD_';
  for (const detail of ['STYLE_PROPERTY_BACKGROUND_POSITION_X_NODE_TAG_SPAN_ANIMATION_RUNNING', 'PSEUDO_PROPERTY__WEBKIT_TEXT_FILL_COLOR_NODE_TAG_DIV_ANIMATION_NONE', 'STYLE_PROPERTY_OTHER_INDEX_512_NODE_TAG_HTML_ANIMATION_NONE', 'RECT_TAG_BODY']) {
    const code = prefix + detail; assert.equal(verificationInputRejectionCode(new Error(code)), code);
  }
  for (const detail of ['STYLE_PROPERTY___PRIVATE_COOKIE_NODE_TAG_DIV_ANIMATION_NONE', 'STYLE_PROPERTY_COLOR_NODE_SECRET_CLASS_ANIMATION_NONE', 'STYLE_PROPERTY_COLOR_VALUE_PRIVATE_NODE_TAG_DIV_ANIMATION_NONE', 'STYLE_PROPERTY_OTHER_INDEX_1024_NODE_TAG_HTML_ANIMATION_NONE']) assert.equal(verificationInputRejectionCode(new Error(prefix + detail)), 'VERIFICATION_INPUT_REJECTED');
});
