import { RankLogo } from './RankLogo';
import { getNetlifyImageUrl, getNetlifyImageSrcSet } from '../../utils/helpers';

/* ============================================================================
   COMPONENT: ProfileAvatar
   A Discord avatar routed through the Netlify image CDN at the size the
   className implies; anything else falls back to the tier's RankLogo.
   ============================================================================ */

export function ProfileAvatar({ profile, className = "w-10 h-10 rounded-lg shrink-0 object-cover" }) {
  const isDiscordAvatar = profile?.avatar_url && (profile.avatar_url.includes('discord') || profile.avatar_url.includes('discordapp'));
  if (isDiscordAvatar) {
    let width = 40;
    let height = 40;
    if (className.includes('w-6') || className.includes('h-6')) {
      width = 24;
      height = 24;
    } else if (className.includes('w-8') || className.includes('h-8')) {
      width = 32;
      height = 32;
    } else if (className.includes('w-5') || className.includes('h-5')) {
      width = 20;
      height = 20;
    } else if (className.includes('w-3.5') || className.includes('h-3.5')) {
      width = 14;
      height = 14;
    }
    return (
      <img
        src={getNetlifyImageUrl(profile.avatar_url, width)}
        srcSet={getNetlifyImageSrcSet(profile.avatar_url)}
        alt={profile.username || 'Avatar'}
        className={className}
        width={width}
        height={height}
        loading="lazy"
      />
    );
  }
  return <RankLogo role={profile?.role} className={className} />;
}

export default ProfileAvatar;
