import { getCurrentSession } from './supabase';

/*
 * Discord role IDs for the OC-submission role automation, and a small client
 * helper for the manage-discord-roles Netlify function (staff-gated, uses the
 * bot token server-side).
 */

export const DISCORD_ROLES = {
  HAS_CHARACTER: '1473338897944547331',
  NO_CHARACTER:  '1473338897873375472',

  // OC count — a member carries exactly one of these (granting a higher count
  // removes the lower ones).
  OC_COUNT: {
    1: '1492668308439175248',
    2: '1492668420901310659',
    3: '1492668431936393297',
  },

  VILLAGES: {
    Iwagakure:    '1473338897978097681',
    Sunagakure:   '1473338897978097682',
    Konohagakure: '1473338898020175913',
    Kirigakure:   '1473338898020175912',
    Kumogakure:   '1473338897978097683',
  },
  WANDERER: '1473338897978097674',

  RANKS: {
    'Genin':         '1473338898020175916',
    'Chūnin':        '1473338898020175917',
    'Special Jōnin': '1473338898020175918',
    'Jōnin':         '1473338898020175919',
  },
  // Given alongside Jōnin when the submitter picked Councilor.
  COUNCILOR: '1525607638598029322',
};

/*
 * Every Discord role an approved OC entry earns its submitter. Wanderers get
 * the Wanderer role instead of a village role, plus their ninja rank like
 * everyone else. Has Character is (re-)granted here as a safety net in case
 * the final-step grant failed, and No Character is always removed (a no-op
 * when the member doesn't have it).
 */
export const rolesForApprovedOC = (data) => {
  const add = [DISCORD_ROLES.HAS_CHARACTER];
  const remove = [DISCORD_ROLES.NO_CHARACTER];

  if (data?.village === 'Wanderer') add.push(DISCORD_ROLES.WANDERER);
  else if (DISCORD_ROLES.VILLAGES[data?.village]) add.push(DISCORD_ROLES.VILLAGES[data.village]);

  if (DISCORD_ROLES.RANKS[data?.ninja_rank]) add.push(DISCORD_ROLES.RANKS[data.ninja_rank]);
  if (data?.ninja_rank === 'Jōnin' && data?.councilor) add.push(DISCORD_ROLES.COUNCILOR);

  const ocNum = Number(data?.oc_number) || 0;
  if (DISCORD_ROLES.OC_COUNT[ocNum]) {
    add.push(DISCORD_ROLES.OC_COUNT[ocNum]);
    for (let n = 1; n < ocNum; n++) remove.push(DISCORD_ROLES.OC_COUNT[n]);
  }

  return { add, remove };
};

// Calls the staff-gated Netlify function. Throws on a non-ok response so
// callers can surface "grant these manually" to the reviewer.
export const applyDiscordRoles = async ({ discordUserId, add = [], remove = [], reason = '' }) => {
  if (!discordUserId) throw new Error('Submitter has no linked Discord ID');
  const sess = await getCurrentSession();
  const res = await fetch('/.netlify/functions/manage-discord-roles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}),
    },
    body: JSON.stringify({ discordUserId, add, remove, reason }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Role update failed (${res.status})`);
  if (out.failures?.length) throw new Error('Some roles failed: ' + out.failures.join(', '));
  return out;
};
