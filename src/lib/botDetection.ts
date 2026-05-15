// Lightweight bot detection for the capture-page tracker.
//
// Most bots don't execute JS so they never reach /api/capture/track
// at all - their HTML fetch never runs our useEffect. The bots that
// DO execute JS are the link-preview crawlers (Slack, Facebook,
// Twitter, LinkedIn, Discord) and the SEO/monitoring browsers
// (Ahrefs, SemRush, Pingdom, headless Chrome). This regex catches
// those by their User-Agent string so we don't pollute the visits
// + conversion numbers with bot traffic.
//
// Worth knowing:
//   - The list is intentionally conservative. False positives on
//     unique visits matter more than missing a few bots: counting
//     a real human as a bot would suppress their conversion entirely.
//   - We do NOT block bots from rendering the page, just from being
//     counted in analytics. The track endpoint quietly succeeds.

const BOT_PATTERNS = [
  // Standard crawlers
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  // Search engine indexers
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /baiduspider/i,
  /duckduckbot/i,
  // Link previews / social
  /facebookexternalhit/i,
  /facebot/i,
  /twitterbot/i,
  /linkedinbot/i,
  /slackbot/i,
  /discordbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /skypeuripreview/i,
  // SEO / monitoring
  /ahrefsbot/i,
  /semrushbot/i,
  /mj12bot/i,
  /dotbot/i,
  /pingdom/i,
  /uptimerobot/i,
  /statuspage/i,
  // Headless / archive
  /headlesschrome/i,
  /phantomjs/i,
  /puppeteer/i,
  /playwright/i,
  /archive\.org_bot/i,
  // Generic "preview" / "fetch" agents
  /preview/i,
  /chrome-lighthouse/i,
  /google[- ]page[- ]speed/i,
]

/** Returns true when the user-agent string looks like a non-human
 *  visitor we shouldn't count in analytics. Empty / missing UA also
 *  returns true: no real browser ships without one. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true
  return BOT_PATTERNS.some((re) => re.test(userAgent))
}
