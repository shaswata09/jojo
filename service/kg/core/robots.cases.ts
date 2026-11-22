/**
 * The cases `robots.ts` is held to, as data, so two implementations can be
 * run through the same table: the package's own (`robots.test.ts`) and the
 * extension's hand transcription (`web/src/lib/extension-crawl-rules.test.ts`).
 * A case added here is a case both have to pass.
 */

export type RobotsCase = {
  readonly name: string
  readonly robots: string
  readonly urls: readonly (readonly [string, boolean])[]
  readonly crawlDelay?: number | undefined
}

export const ROBOTS_CASES: readonly RobotsCase[] = [
  {
    // careercenter.cra.org/robots.txt, the lines that matter (measured 2026-11-20).
    name: 'the CRA career centre: its search is closed to crawlers, its job list is not',
    robots: 'User-agent: *\nDisallow: /search/\nDisallow: /search?*\nDisallow: /jobtype/*\n',
    urls: [
      ['https://careercenter.cra.org/jobs', true],
      ['https://careercenter.cra.org/jobs?page=2', true],
      ['https://careercenter.cra.org/search/?keywords=faculty', false],
      ['https://careercenter.cra.org/search?keywords=faculty', false],
      ['https://careercenter.cra.org/jobtype/faculty/', false],
      ['https://careercenter.cra.org/job/lecturer/71012/', true],
    ],
  },
  {
    // academicjobsonline.org asks for five seconds between requests.
    name: 'a Crawl-delay is read from the group that applies',
    robots: 'User-agent: *\nCrawl-delay: 5\nDisallow: /ajo/admin\n',
    urls: [
      ['https://academicjobsonline.org/ajo/jobs', true],
      ['https://academicjobsonline.org/ajo/admin/x', false],
    ],
    crawlDelay: 5,
  },
  {
    name: 'only the * group applies to a crawler with no name of its own',
    robots:
      'User-agent: Googlebot\nDisallow: /\nCrawl-delay: 99\n\nUser-agent: *\nDisallow: /private\n',
    urls: [
      ['https://a.test/jobs', true],
      ['https://a.test/private/1', false],
    ],
    crawlDelay: undefined,
  },
  {
    name: 'several user-agent lines share one group, and a rule line ends it',
    robots: 'User-agent: bingbot\nUser-agent: *\nDisallow: /a\nUser-agent: other\nDisallow: /b\n',
    urls: [
      ['https://a.test/a', false],
      ['https://a.test/b', true],
    ],
  },
  {
    name: 'two * groups are merged',
    robots: 'User-agent: *\nDisallow: /a\n\nUser-agent: x\nDisallow: /\n\nUser-agent: *\nDisallow: /b\n',
    urls: [
      ['https://a.test/a', false],
      ['https://a.test/b', false],
      ['https://a.test/c', true],
    ],
  },
  {
    name: 'the longest match wins, and Allow wins a tie',
    robots: 'User-agent: *\nDisallow: /jobs\nAllow: /jobs/view\nDisallow: /p\nAllow: /p\n',
    urls: [
      ['https://a.test/jobs/search', false],
      ['https://a.test/jobs/view/1', true],
      ['https://a.test/p/1', true],
    ],
  },
  {
    name: 'a wildcard and an end anchor',
    robots: 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?sort=\n',
    urls: [
      ['https://a.test/files/a.pdf', false],
      ['https://a.test/files/a.pdf?x=1', true],
      ['https://a.test/jobs?sort=new', false],
      ['https://a.test/jobs?page=2', true],
    ],
  },
  {
    name: 'an empty Disallow allows everything, and comments and case are ignored',
    robots: '# hello\nUSER-AGENT: *   # everyone\nDisallow:\nCrawl-Delay: 2 # seconds\n',
    urls: [['https://a.test/anything', true]],
    crawlDelay: 2,
  },
  {
    name: 'Disallow: / closes the whole site',
    robots: 'User-agent: *\r\nDisallow: /\r\n',
    urls: [
      ['https://a.test/', false],
      ['https://a.test/jobs', false],
    ],
  },
  {
    name: 'a malformed Crawl-delay asks for nothing',
    robots: 'User-agent: *\nCrawl-delay: soon\nCrawl-delay: -3\n',
    urls: [['https://a.test/', true]],
    crawlDelay: undefined,
  },
]

export type BotWallCase = {
  readonly name: string
  readonly page: { title?: string; html?: string; links?: number }
  readonly wall: boolean
}

const BOARD = `<html><head><title>Jobs</title><script src="/_Incapsula_Resource?SWJIYLWA=1"></script>
<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body>
${Array.from({ length: 30 }, (_, i) => `<a href="/jobs/${String(1000 + i)}">Job ${String(i)}</a>`).join('')}
<form><div class="g-recaptcha"></div></form></body></html>`

export const BOT_WALL_CASES: readonly BotWallCase[] = [
  { name: 'Cloudflare’s "Just a moment…"', page: { title: 'Just a moment...', html: '' }, wall: true },
  {
    name: 'Cloudflare’s challenge markup, whatever the title',
    page: { title: 'careercenter.cra.org', html: '<script>window._cf_chl_opt={cvId:"3"}</script>' },
    wall: true,
  },
  { name: 'Cloudflare’s block page', page: { title: 'Attention Required! | Cloudflare' }, wall: true },
  {
    name: 'an Imperva interstitial: its resource and nothing else',
    page: {
      title: '',
      html: '<html><head><meta name="robots" content="noindex"></head><body><iframe src="/_Incapsula_Resource?CWUDNSAI=9"></iframe></body></html>',
    },
    wall: true,
  },
  {
    name: 'an Imperva incident page',
    page: { html: '<p>Request unsuccessful. Incapsula incident ID: 123-456</p>' },
    wall: true,
  },
  {
    name: 'an hCaptcha interstitial',
    page: { title: 'Verify', html: '<div class="h-captcha" data-sitekey="x"></div><script src="https://hcaptcha.com/1/api.js"></script>' },
    wall: true,
  },
  {
    name: 'a reCAPTCHA interstitial, counted from the DOM',
    page: { title: 'One more step', html: '<div class="g-recaptcha"></div>', links: 1 },
    wall: true,
  },
  {
    name: 'a board on a protected site, with the same scripts on it, is a board',
    page: { title: 'Jobs', html: BOARD },
    wall: false,
  },
  {
    name: 'a board with a captcha on a form, counted from the DOM',
    page: { title: 'Jobs', html: '<div class="g-recaptcha"></div>', links: 60 },
    wall: false,
  },
  { name: 'an ordinary page', page: { title: 'Faculty positions', html: '<a href="/x">x</a>' }, wall: false },
  { name: 'nothing at all', page: {}, wall: false },
]
