import { toArray } from './helpers';
import { getCurrentSession } from '../lib/supabase';

/* ---------------------------------------------------------------------------
   DISCORD WEBHOOK LOGGING
   Routes an approval/denial event to the correct Discord Forum thread and
   formats it to match the staff log embed design. Battlemode entries land in
   their own thread; everything else goes to the general jutsu thread.

   The submitter / reviewer pair encodes the workflow:
     • staff queue (double-approver)  → submitter !== reviewer
     • admin direct write (single)    → submitter === reviewer (same user id)

   This is the only copy. utils/helpers.jsx used to carry a stale one that
   still attached a chat transcript and re-exported a Google Doc as a PDF —
   both of those were removed from the workflow, and that copy was dead.
   --------------------------------------------------------------------------- */
export async function sendDiscordLog(itemData, actionType, submitterProfile, firstReviewerProfile, finalApproverProfile, config = {}) {
  const baseUrl = import.meta.env.VITE_DISCORD_LOG_WEBHOOK_URL;
  if (!baseUrl) return; // Logging not configured — skip silently.

  const isCharacter = itemData?.type === 'Character';

  // Route to the correct forum thread — prefer DB config, fall back to env vars.
  let threadId = toArray(itemData?.types).includes('Battlemode')
    ? (config.discord_battlemode_thread_id || import.meta.env.VITE_DISCORD_BATTLEMODE_THREAD_ID)
    : (config.discord_jutsu_thread_id     || import.meta.env.VITE_DISCORD_JUTSU_THREAD_ID);

  if (isCharacter) {
    threadId = config.discord_oc_thread_id || import.meta.env.VITE_DISCORD_OC_THREAD_ID;
  } else if (itemData?.type === 'Summon') {
    threadId = config.discord_summon_thread_id || import.meta.env.VITE_DISCORD_SUMMON_THREAD_ID;
  } else if (itemData?.type === 'Custom Item') {
    threadId = config.discord_custom_item_thread_id || import.meta.env.VITE_DISCORD_CUSTOM_ITEM_THREAD_ID;
  }

  // Format a profile into a Discord mention, falling back to plain @username.
  const ping = (profile) => {
    if (!profile) return 'Unknown';
    if (profile.discord_id) return `<@${profile.discord_id}>`;
    return `@${profile.username || 'unknown'}`;
  };

  // Determine pings
  const creatorPing = ping(submitterProfile);
  const reviewerPing = firstReviewerProfile ? ping(firstReviewerProfile) : ping(submitterProfile);
  const secondEyes = ping(finalApproverProfile);

  // Decision + colour: green for approvals/creates, red for denials/deletes.
  const isNegative = /den|reject|delet|cancel/i.test(actionType || '');
  const decision = isNegative ? 'Denied' : 'Approved';
  const color = isNegative ? 15158332 : 3066993;

  // Extract other field values
  const natureVal = itemData?.nature || 'N/A';
  const rankVal = Array.isArray(itemData?.rank) ? itemData.rank.join(', ') : (itemData?.rank || 'N/A');
  const typeVal = Array.isArray(itemData?.types) ? itemData.types.join(', ') : (itemData?.types || 'N/A');
  const specVal = Array.isArray(itemData?.spec) ? itemData.spec.join(', ') : (itemData?.spec || 'N/A');
  const bloodlineVal = itemData?.bloodline || 'N/A';
  // Summon/Custom Item still capture a plain doc link; Character and Jutsu
  // both keep their full write-up in the app now, so there's no URL to show.
  const linkVal = itemData?.link || 'N/A';

  const creationDate = itemData?._createdAt ? new Date(itemData._createdAt).toLocaleString() : 'N/A';
  const approvalDate = new Date().toLocaleString();

  const isSummonOrItem = itemData?.type === 'Summon' || itemData?.type === 'Custom Item';

  let description;
  if (isCharacter) {
    const characterDesc = [
      `**Name Entry Creator:** ${creatorPing}`,
      `**Name Reviewer:** ${reviewerPing}`,
      `**Name 2nd pair of eyes reviewer:** ${secondEyes}`,
      '',
      `**Decision:** ${decision}`,
      '',
      '**OC Details:**',
      `Type of Submission: Character`,
      `Sheet: view in the app (Roster → click the character's name)`,
    ];
    if (itemData?.myCharactersLink) {
      characterDesc.push(`My-Characters Link: ${itemData.myCharactersLink}`);
    }
    if (itemData?.upgradesLink) {
      characterDesc.push(`Upgrades Link: ${itemData.upgradesLink}`);
    }
    characterDesc.push(
      '',
      '**Dates:**',
      `Creation Date: ${creationDate}`,
      `Approval Date: ${approvalDate}`
    );
    description = characterDesc.join('\n');
  } else if (isSummonOrItem) {
    const entryLabel = itemData.type === 'Summon' ? 'Summon Contract Names' : 'Item Names';
    description = [
      `**Name Entry Creator:** ${creatorPing}`,
      `**${entryLabel}:** ${itemData?.name || 'N/A'}`,
      `**Name Reviewer:** ${reviewerPing}`,
      `**Name 2nd pair of eyes reviewer:** ${secondEyes}`,
      '',
      `**Decision:** ${decision}`,
      '',
      '**Link to sheet:**',
      `${linkVal}`,
      '',
      '**Dates:**',
      `Creation Date: ${creationDate}`,
      `Approval Date: ${approvalDate}`,
    ].join('\n');
  } else {
    description = [
      `**Name Entry Creator:** ${creatorPing}`,
      `**Name Reviewer:** ${reviewerPing}`,
      `**Name 2nd pair of eyes reviewer:** ${secondEyes}`,
      '',
      `**Decision:** ${decision}`,
      '',
      '**Entry Details:**',
      `Nature: ${natureVal}`,
      `Rank: ${rankVal}`,
      `Type: ${typeVal}`,
      `Spec: ${specVal}`,
      `Bloodline: ${bloodlineVal}`,
      '',
      '**Dates:**',
      `Creation Date: ${creationDate}`,
      `Approval Date: ${approvalDate}`
    ].join('\n');
  }

  const embedTitle = isSummonOrItem
    ? `${itemData.type}${itemData?.name ? `: ${itemData.name}` : ''}`
    : (isCharacter ? 'OC Submission' : (itemData?.name || 'Jutsu Entry'));

  const payload = {
    embeds: [{
      title: embedTitle,
      description,
      color,
    }],
  };

  try {
    const sess = await getCurrentSession();
    const authHdr = sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {};

    const res = await fetch('/.netlify/functions/send-discord-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHdr },
      body: JSON.stringify({ threadId, payload }),
    });

    if (!res.ok) throw new Error(`Discord log function returned ${res.status}`);
    const data = await res.json();
    return { messageId: data.messageId, threadId: data.threadId ?? threadId };
  } catch (err) {
    // Never let a logging failure block the underlying database action.
    console.warn('[NARP] Discord log failed:', err);
    return null;
  }
}
