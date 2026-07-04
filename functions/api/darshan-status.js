// functions/api/darshan-status.js
// Cloudflare Pages Function — runs server-side, never shipped to the browser.
// Requires an environment variable YOUTUBE_API_KEY set in:
// Cloudflare dashboard → Pages project → Settings → Environment variables
// (add it as Production, and Preview too if you want previews to work).

const CHANNEL_HANDLE = "saimandirnoida";
const LIVE_CACHE_SECONDS = 60;          // how long a live/not-live result is trusted
const CHANNEL_ID_CACHE_SECONDS = 86400; // the channel's internal ID never changes

async function ytGet(path, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `YouTube API error ${res.status}`);
  }
  return res.json();
}

async function getChannelId(apiKey, cache) {
  const cacheKey = new Request("https://cache.internal/channel-id");
  const cached = await cache.match(cacheKey);
  if (cached) return (await cached.json()).channelId;

  const data = await ytGet("channels", { part: "id", forHandle: CHANNEL_HANDLE }, apiKey);
  const channelId = data.items?.[0]?.id;
  if (!channelId) throw new Error("Channel handle not found");

  await cache.put(cacheKey, new Response(JSON.stringify({ channelId }), {
    headers: { "Cache-Control": `max-age=${CHANNEL_ID_CACHE_SECONDS}` }
  }));
  return channelId;
}

export async function onRequestGet(context) {
  const { env } = context;
  const apiKey = env.YOUTUBE_API_KEY;
  const cache = caches.default;

  const statusCacheKey = new Request("https://cache.internal/darshan-status");
  const cached = await cache.match(statusCacheKey);
  if (cached) {
    return new Response(await cached.text(), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set in Pages environment variables");

    const channelId = await getChannelId(apiKey, cache);

    const liveData = await ytGet("search", {
      part: "snippet", channelId, eventType: "live", type: "video", maxResults: 1
    }, apiKey);

    let result;
    if (liveData.items && liveData.items.length) {
      result = { live: true, videoId: liveData.items[0].id.videoId };
    } else {
      const chData = await ytGet("channels", { part: "contentDetails", id: channelId }, apiKey);
      const playlistId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
      result = { live: false, playlistId };
    }

    const body = JSON.stringify(result);
    const response = new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${LIVE_CACHE_SECONDS}`,
        "Access-Control-Allow-Origin": "*"
      }
    });
    await cache.put(statusCacheKey, response.clone());
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
