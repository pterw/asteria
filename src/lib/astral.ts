/**
 * The journal's public vocabulary.
 *
 * This barrel is the surface the interface imports from: components should not need to
 * know that feelings, placements, filters and calendar arithmetic live in separate
 * modules. Server code is encouraged to import the narrower module directly
 * (`@/lib/stars`, `@/lib/time`, …) so that a component never accidentally pulls
 * database-adjacent code into a client bundle.
 *
 * The dependency direction is one-way and enforced by review: `moods` and `time` are
 * leaves, `stars` depends on both, `filters` depends on all three, and nothing here
 * imports from `journal`, `session` or anything else that touches the database.
 */
export * from "./moods";
export * from "./stars";
export * from "./filters";
export * from "./time";
export * from "./validation";

/* `formatNight` / `shortNight` are the names the interface has used since the first
   build. They are kept as aliases rather than renamed across a dozen components. */
export { formatDay as formatNight, shortDay as shortNight } from "./time";
