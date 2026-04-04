import type { SiteId } from './types';

export interface SupportedSiteVariantDefinition {
  id: string;
  label: string;
  hostPattern: RegExp;
  homeUrl?: string;
}

export interface SupportedSiteDefinition {
  id: SiteId;
  label: string;
  description: string;
  group: string;
  homeUrl?: string;
  variants: SupportedSiteVariantDefinition[];
}

export interface SupportedSiteMatch {
  site: SupportedSiteDefinition;
  variant: SupportedSiteVariantDefinition;
}

export interface FavoriteSiteDefinition extends SupportedSiteDefinition {
  homeUrl: string;
}

export const SUPPORTED_SITES: SupportedSiteDefinition[] = [
  {
    id: 'royalroad',
    label: 'Royal Road',
    description: 'Chapter pages on Royal Road',
    group: 'Primary platforms',
    homeUrl: 'https://www.royalroad.com/fictions/latest-updates',
    variants: [
      {
        id: 'royalroad.com',
        label: 'www.royalroad.com',
        hostPattern: /^www\.royalroad\.com$/i,
        homeUrl: 'https://www.royalroad.com/fictions/latest-updates',
      },
    ],
  },
  {
    id: 'scribblehub',
    label: 'Scribble Hub',
    description: 'Scribble Hub reader and chapter pages',
    group: 'Primary platforms',
    homeUrl: 'https://www.scribblehub.com/series-finder/',
    variants: [
      {
        id: 'scribblehub.com',
        label: 'www.scribblehub.com',
        hostPattern: /^www\.scribblehub\.com$/i,
        homeUrl: 'https://www.scribblehub.com/series-finder/',
      },
    ],
  },
  {
    id: 'webnovel',
    label: 'Webnovel',
    description: 'Webnovel chapter pages',
    group: 'Primary platforms',
    homeUrl: 'https://www.webnovel.com/',
    variants: [
      {
        id: 'webnovel.com',
        label: 'www.webnovel.com',
        hostPattern: /^www\.webnovel\.com$/i,
        homeUrl: 'https://www.webnovel.com/',
      },
    ],
  },
  {
    id: 'wattpad',
    label: 'Wattpad',
    description: 'Wattpad story part pages',
    group: 'Primary platforms',
    homeUrl: 'https://www.wattpad.com/',
    variants: [
      {
        id: 'wattpad.com',
        label: 'www.wattpad.com',
        hostPattern: /^www\.wattpad\.com$/i,
        homeUrl: 'https://www.wattpad.com/',
      },
    ],
  },
  {
    id: 'ao3',
    label: 'AO3',
    description: 'Archive of Our Own works and chapters',
    group: 'Community archives',
    homeUrl: 'https://archiveofourown.org/works',
    variants: [
      {
        id: 'archiveofourown.org',
        label: 'archiveofourown.org',
        hostPattern: /^archiveofourown\.org$/i,
        homeUrl: 'https://archiveofourown.org/works',
      },
    ],
  },
  {
    id: 'fanfiction',
    label: 'FanFiction.net',
    description: 'FanFiction.net story chapters',
    group: 'Community archives',
    homeUrl: 'https://www.fanfiction.net/',
    variants: [
      {
        id: 'fanfiction.net',
        label: 'www.fanfiction.net',
        hostPattern: /^www\.fanfiction\.net$/i,
        homeUrl: 'https://www.fanfiction.net/',
      },
    ],
  },
  {
    id: 'xenforo',
    label: 'SpaceBattles / SufficientVelocity',
    description: 'Threadmarks and XenForo post views',
    group: 'Community archives',
    homeUrl: 'https://forums.spacebattles.com/',
    variants: [
      {
        id: 'spacebattles.com',
        label: 'forums.spacebattles.com',
        hostPattern: /^forums\.spacebattles\.com$/i,
        homeUrl: 'https://forums.spacebattles.com/',
      },
      {
        id: 'sufficientvelocity.com',
        label: 'forums.sufficientvelocity.com',
        hostPattern: /^forums\.sufficientvelocity\.com$/i,
        homeUrl: 'https://forums.sufficientvelocity.com/',
      },
    ],
  },
  {
    id: 'novelbin',
    label: 'NovelBin',
    description: 'NovelBin chapter pages',
    group: 'Reader mirrors',
    homeUrl: 'https://novelbin.org/',
    variants: [
      {
        id: 'novelbin.com',
        label: 'novelbin.com',
        hostPattern: /(^|\.)novelbin\.com$/i,
        homeUrl: 'https://novelbin.com/',
      },
      {
        id: 'novelbin.org',
        label: 'novelbin.org',
        hostPattern: /(^|\.)novelbin\.org$/i,
        homeUrl: 'https://novelbin.org/',
      },
      {
        id: 'novelbin.cc',
        label: 'novelbin.cc',
        hostPattern: /(^|\.)novelbin\.cc$/i,
        homeUrl: 'https://novelbin.cc/',
      },
    ],
  },
  {
    id: 'ranobes',
    label: 'Ranobes',
    description: 'Ranobes chapter pages across supported mirrors',
    group: 'Reader mirrors',
    homeUrl: 'https://ranobes.top/',
    variants: [
      {
        id: 'ranobes.com',
        label: 'ranobes.com',
        hostPattern: /(^|\.)ranobes\.com$/i,
        homeUrl: 'https://ranobes.com/',
      },
      {
        id: 'ranobes.my',
        label: 'ranobes.my',
        hostPattern: /(^|\.)ranobes\.my$/i,
        homeUrl: 'https://ranobes.my/',
      },
      {
        id: 'ranobes.world',
        label: 'ranobes.world',
        hostPattern: /(^|\.)ranobes\.world$/i,
        homeUrl: 'https://ranobes.world/',
      },
      {
        id: 'ranobes.top',
        label: 'ranobes.top',
        hostPattern: /(^|\.)ranobes\.top$/i,
        homeUrl: 'https://ranobes.top/',
      },
    ],
  },
  {
    id: 'wtrlab',
    label: 'WTR-LAB',
    description: 'WTR-LAB reader pages, preferring web+ view',
    group: 'Reader mirrors',
    homeUrl: 'https://wtr-lab.com/en?service=webplus',
    variants: [
      {
        id: 'wtr-lab.com',
        label: 'wtr-lab.com / www.wtr-lab.com',
        hostPattern: /^(www\.)?wtr-lab\.com$/i,
        homeUrl: 'https://wtr-lab.com/en?service=webplus',
      },
      {
        id: 'echo.wtr-lab.com',
        label: 'echo.wtr-lab.com',
        hostPattern: /^echo\.wtr-lab\.com$/i,
        homeUrl: 'https://echo.wtr-lab.com/en?service=webplus',
      },
    ],
  },
  {
    id: 'wordpress',
    label: 'WordPress blogs',
    description: 'Official author-hosted chapter posts on WordPress',
    group: 'Author-hosted sites',
    variants: [
      {
        id: 'wordpress.com',
        label: '*.wordpress.com',
        hostPattern: /^[^.]+\.wordpress\.com$/i,
      },
    ],
  },
  {
    id: 'generic',
    label: 'Generic fallback',
    description: 'Article/main-content fallback for unsupported sites',
    group: 'Fallbacks',
    variants: [
      {
        id: 'generic:any',
        label: 'Unknown article pages',
        hostPattern: /.*/i,
      },
    ],
  },
];

export const DEFAULT_ENABLED_SITES = SUPPORTED_SITES.map(site => site.id);
export const DEFAULT_ENABLED_SITE_HOSTS = SUPPORTED_SITES
  .flatMap(site => site.variants)
  .filter(variant => variant.id !== 'generic:any')
  .map(variant => variant.id);
export const DEFAULT_FAVORITE_SITES: SiteId[] = [];

export function getSiteDefinition(siteId: string): SupportedSiteDefinition | undefined {
  return SUPPORTED_SITES.find(site => site.id === siteId);
}

export function getSiteVariantDefinitions(siteId: SiteId): SupportedSiteVariantDefinition[] {
  return getSiteDefinition(siteId)?.variants ?? [];
}

export function getEnabledSiteVariants(siteId: SiteId, enabledSiteHosts: string[]): SupportedSiteVariantDefinition[] {
  return getSiteVariantDefinitions(siteId).filter(variant => enabledSiteHosts.includes(variant.id));
}

export function resolveSiteHomeUrl(siteId: SiteId, enabledSiteHosts: string[]): string | undefined {
  const site = getSiteDefinition(siteId);
  if (!site) return undefined;
  return getEnabledSiteVariants(siteId, enabledSiteHosts).find(variant => variant.homeUrl)?.homeUrl ?? site.homeUrl;
}

export function favoriteSiteDefinitions(siteIds: SiteId[], enabledSiteHosts: string[]): FavoriteSiteDefinition[] {
  return siteIds
    .map(id => {
      const site = getSiteDefinition(id);
      const homeUrl = site ? resolveSiteHomeUrl(site.id, enabledSiteHosts) : undefined;
      if (!site || !homeUrl) return null;
      return {
        ...site,
        homeUrl,
      };
    })
    .filter((site): site is FavoriteSiteDefinition => Boolean(site));
}

export function detectSiteMatchFromUrl(url: string): SupportedSiteMatch | null {
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  for (const site of SUPPORTED_SITES) {
    if (site.id === 'generic') continue;
    const variant = site.variants.find(entry => entry.hostPattern.test(hostname));
    if (variant) {
      return { site, variant };
    }
  }

  return null;
}

export function detectSiteFromUrl(url: string): SiteId | null {
  return detectSiteMatchFromUrl(url)?.site.id ?? null;
}

export function detectSiteVariantFromUrl(url: string): string | null {
  return detectSiteMatchFromUrl(url)?.variant.id ?? null;
}

export function isSiteEnabledForUrl(
  url: string,
  enabledSites: SiteId[],
  enabledSiteHosts: string[],
): boolean {
  const match = detectSiteMatchFromUrl(url);
  if (!match) return enabledSites.includes('generic');
  return enabledSites.includes(match.site.id) && enabledSiteHosts.includes(match.variant.id);
}

export function withPreferredReaderUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const siteId = detectSiteFromUrl(parsed.href);
    if (siteId === 'wtrlab' && parsed.searchParams.get('service') !== 'webplus') {
      parsed.searchParams.set('service', 'webplus');
    }
    return parsed.href;
  } catch {
    return url;
  }
}
