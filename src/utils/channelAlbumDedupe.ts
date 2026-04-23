/**
 * Telegram sends one update per item in a channel media group (shared media_group_id).
 * Only the first update in an album should get a bot reply; others are skipped.
 *
 * Uses Cache API on Workers when available; no-op (always allow) in environments without it.
 */
const DEDUPE_ORIGIN = 'https://internal/vpn-master/channel-album/';

/** @returns true if this handler should send a reply; false if another item in the same album already claimed it */
export async function claimChannelAlbumReply(
    chatId: number | undefined,
    mediaGroupId: string | undefined
): Promise<boolean> {
    if (mediaGroupId === undefined || chatId === undefined) return true;
    const cache = typeof caches !== 'undefined' ? caches.default : undefined;
    if (!cache) return true;
    const req = new Request(`${DEDUPE_ORIGIN}${chatId}/${encodeURIComponent(mediaGroupId)}`);
    if ((await cache.match(req)) !== undefined) return false;
    await cache.put(
        req,
        new Response('1', {
            headers: { 'Cache-Control': 'public, max-age=300' },
        })
    );
    return true;
}
