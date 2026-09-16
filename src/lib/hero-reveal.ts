/**
 * The hero reveals each word from inside its own `overflow-hidden` inline-block, so two
 * numbers are load-bearing and coupled: the mask's bottom padding and the reveal's travel.
 * They live here, in one place, because the component and its mask test both need the same
 * values — a copy in either one silently drifts the moment the display face changes.
 *
 * `MASK_PB_EM` must clear the display face's italic descender in ink, not in font metrics:
 * metrics overstate it. Measured for daith-vf Italic at 500 (96px): g descends 0.3021em,
 * y 0.2813em. Too shallow slices the descenders flat at a position that scales with the
 * type, so it survives a single-viewport rig; too deep and the word peeks above the mask
 * before the reveal starts.
 *
 * `TRAVEL_PCT` is the initial offset as a percentage of the inner box. The mask depth is
 * the inner box plus MASK_PB_EM, so travel must stay >1.05x that or the word is visible
 * above the mask at rest-before-reveal. 1.45 against a 1.327em-deep mask leaves ~9%.
 */
export const MASK_PB_EM = 0.32;
export const TRAVEL_PCT = 1.45;