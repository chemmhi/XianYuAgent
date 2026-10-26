import { VerificationError } from './verification-domain.js';
import { VERIFICATION_CSS_PROPERTIES, VERIFICATION_DIAGNOSTIC_TAGS } from './verification-render-diagnostics.js';

const plainCodes = new Set(['VERIFICATION_FRAME_STALE', 'VERIFICATION_INPUT_SEQUENCE', 'VERIFICATION_INPUT_INVALID', 'VERIFICATION_CONTROL_EXPIRED', 'VERIFICATION_POINTER_PRESSED',
  ...['DOM_STYLE', 'DOM_CLASS', 'DOM_STRUCTURE', 'DOM_TEXT', 'DOM_ATTRIBUTE', 'DOCUMENT', 'GEOMETRY', 'OCCLUDED', 'CONTEXT', 'EXPIRED', 'EPOCH']
    .flatMap(reason => [`VERIFICATION_FRAME_STALE_${reason}`, `VERIFICATION_FRAME_STALE_${reason}_PARENT`]),
  ...['SPM_ANCHOR_ID', 'APLUS_AE', 'ARIA_GRABBED', 'ARIA_VALUENOW', 'ARIA_LABEL', 'TABINDEX', 'DISABLED', 'DRAGGABLE', 'TITLE', 'ID', 'OTHER']
    .flatMap(attribute => ['HANDLE', 'PROGRESS', 'REFRESH', 'SLIDER', 'ROOT', 'ANCESTOR', 'OTHER'].flatMap(role =>
      [`VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_${attribute}_${role}`, `VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_${attribute}_${role}_PARENT`]))]);
for (const failure of [
  'UNARMED', 'NODES', 'LATE', 'ANIMATION', 'UNREADABLE',
  ...['HANDLE', 'PROGRESS', 'SLIDER', 'ROOT', 'ANCESTOR', 'OTHER'].flatMap(role => [`RECT_${role}`,
    ...['STYLE', 'PSEUDO'].flatMap(kind => ['BACKGROUND_COLOR', 'OUTLINE_STYLE', 'OUTLINE_WIDTH', 'OUTLINE_COLOR', 'BORDER_STYLE', 'BORDER_COLOR', 'COLOR', 'BOX_SHADOW', 'CURSOR', 'USER_SELECT', 'TOUCH_ACTION', 'POINTER_EVENTS', 'DISPLAY', 'VISIBILITY', 'OPACITY', 'WIDTH', 'HEIGHT', 'LEFT', 'TOP', 'TRANSFORM', 'CONTENT', 'OTHER'].map(property => `${kind}_${property}_${role}`))])
]) for (const target of ['HANDLE', 'REFRESH']) for (const parent of ['', '_PARENT']) plainCodes.add(`VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_SPM_ANCHOR_ID_${target}_GUARD_${failure}${parent}`);
const cssCodes = new Set(['OTHER', ...VERIFICATION_CSS_PROPERTIES.map(property => property.toUpperCase().replace(/-/g, '_'))]);
const diagnosticRoles = new Set(['HANDLE', 'PROGRESS', 'REFRESH', 'SLIDER', 'ROOT', 'ANCESTOR', 'OTHER', ...VERIFICATION_DIAGNOSTIC_TAGS.map(tag => `TAG_${tag}`)]);

function isRenderDiagnostic(code: string): boolean {
  const prefix = /^VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_SPM_ANCHOR_ID_(?:HANDLE|REFRESH)_GUARD_/.exec(code);
  if (!prefix) return false;
  const detail = code.slice(prefix[0].length).replace(/_PARENT$/, '');
  if (detail.startsWith('RECT_')) return diagnosticRoles.has(detail.slice(5));
  const match = /^(STYLE|PSEUDO)_PROPERTY_([A-Z0-9_]+)_NODE_([A-Z0-9_]+)_ANIMATION_(RUNNING|NONE)$/.exec(detail);
  const index = match && /^OTHER_INDEX_(0|[1-9]\d{0,3})$/.exec(match[2]);
  return !!match && (cssCodes.has(match[2]) || !!index && Number(index[1]) <= 1023) && diagnosticRoles.has(match[3]);
}

/** Browser exceptions may contain signed URLs. Only explicit static codes
 * are eligible for the wire/log; an arbitrary exception is never echoed. */
export function verificationInputRejectionCode(error: unknown): string {
  if (error instanceof VerificationError) return error.code;
  return error instanceof Error && (plainCodes.has(error.message) || isRenderDiagnostic(error.message)) ? error.message : 'VERIFICATION_INPUT_REJECTED';
}
