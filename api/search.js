// Vercel serverless function: proxies YouTube Data API v3 so the key stays private.
// Env var required: YOUTUBE_API_KEY

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

function parseDuration(iso) {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!match) return 0;
  const [, h = 0, m = 0, s = 0] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function decodeEntities(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export default async function handler(req, res) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured on the server.' });
  }

  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing search query.' });
  if (query.length > 120) return res.status(400).json({ error: 'Query too long.' });

  const maxResults = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 25);

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      safeSearch: 'moderate',
      maxResults: String(maxResults),
      q: /karaoke/i.test(query) ? query : `${query} karaoke`,
      key: apiKey
    });

    const searchRes = await fetch(`${SEARCH_URL}?${searchParams}`);
    const searchData = await searchRes.json();
    if (!searchRes.ok) {
      const message = searchData?.error?.message || 'YouTube search failed.';
      return res.status(searchRes.status === 403 ? 429 : 502).json({ error: message });
    }

    const ids = (searchData.items || []).map((item) => item.id.videoId).filter(Boolean);
    if (!ids.length) return res.status(200).json({ results: [] });

    const detailParams = new URLSearchParams({
      part: 'contentDetails',
      id: ids.join(','),
      key: apiKey
    });
    const detailRes = await fetch(`${VIDEOS_URL}?${detailParams}`);
    const detailData = detailRes.ok ? await detailRes.json() : { items: [] };
    const durations = new Map(
      (detailData.items || []).map((v) => [v.id, parseDuration(v.contentDetails?.duration)])
    );

    const results = searchData.items.map((item) => ({
      id: item.id.videoId,
      title: decodeEntities(item.snippet.title),
      channel: decodeEntities(item.snippet.channelTitle),
      thumbnail:
        item.snippet.thumbnails?.high?.url ||
        item.snippet.thumbnails?.medium?.url ||
        `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
      duration: durations.get(item.id.videoId) || 0
    }));

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(502).json({ error: 'Could not reach YouTube.' });
  }
}
