/** Fixed diagnostic names. All other non-custom CSS properties use a bounded
 * declaration index; property values and custom names are never exported. */
export const VERIFICATION_CSS_PROPERTIES = `background-position background-position-x background-position-y
background-color background-image background-clip -webkit-background-clip -webkit-text-fill-color
outline-style outline-width outline-color color box-shadow cursor user-select touch-action
pointer-events display visibility opacity width height left top transform content`.split(/\s+/);

export const VERIFICATION_DIAGNOSTIC_TAGS = ['HTML', 'BODY', 'DIV', 'SPAN', 'A', 'STYLE', 'IMG', 'SCRIPT', 'HEAD', 'LINK', 'META', 'CANVAS', 'SVG', 'PATH', 'IFRAME', 'BUTTON', 'INPUT', 'P', 'H1', 'H2', 'SECTION', 'LABEL', 'TABLE', 'TD', 'TR', 'UL', 'LI'] as const;
