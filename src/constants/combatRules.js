/*
 * Combat tracker rules, as data (Phase 1: 1-post technique costs only).
 *
 * Base cost by technique rank — the "Technique Rank" table in the chakra
 * system rules (also used as the continuous per-turn cost, once continuous
 * techniques are implemented). Mirrors public.technique_base_cost() in
 * supabase/add-combat-tracker.sql; keep both in sync if the rules change.
 *
 * NOT here yet: the Multi-Post Min CU Cost / Battery Drain table, the
 * defensive hit-threshold table, elemental advantage cycle, and the
 * genjutsu cost-flip rule — those arrive with their respective phases.
 */

export const TECHNIQUE_BASE_COST = { E: 1, D: 2, C: 4, B: 6, A: 8, S: 10 };
