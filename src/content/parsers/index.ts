import type { SiteParser } from './base';
import { RoyalRoadParser } from './royalroad';
import { ScribbleHubParser } from './scribblehub';
import { WebnovelParser } from './webnovel';
import { WattpadParser, AO3Parser, FanFictionParser, XenForoParser } from './wattpad';
import { NovelBinParser, RanobesParser, WordPressParser, WtrLabParser } from './additional';
import { GenericParser } from './generic';
import type { ParsedChapter } from '../../shared/types';
import type { ParserOptions } from './base';
import {
  DEFAULT_ENABLED_SITE_HOSTS,
  DEFAULT_ENABLED_SITES,
  detectSiteMatchFromUrl,
} from '../../shared/sites';

/** Ordered list — specific parsers before the generic fallback */
const PARSERS: SiteParser[] = [
  RoyalRoadParser,
  ScribbleHubParser,
  WebnovelParser,
  WattpadParser,
  AO3Parser,
  FanFictionParser,
  XenForoParser,
  NovelBinParser,
  RanobesParser,
  WtrLabParser,
  WordPressParser,
  GenericParser,
];

/**
 * Returns the extracted chapter for the current page,
 * or null if no parser produced usable text.
 */
export function extractCurrentPage(options?: ParserOptions): ParsedChapter | null {
  const url = location.href;
  const enabledSites = new Set(options?.enabledSites ?? DEFAULT_ENABLED_SITES);
  const enabledSiteHosts = new Set(options?.enabledSiteHosts ?? DEFAULT_ENABLED_SITE_HOSTS);
  const matchingSpecificParsers = PARSERS.filter(parser => parser.id !== 'generic' && parser.canHandle(url));
  const siteMatch = detectSiteMatchFromUrl(url);

  if (matchingSpecificParsers.some(parser => !enabledSites.has(parser.id))) {
    return null;
  }

  if (siteMatch && !enabledSiteHosts.has(siteMatch.variant.id)) {
    return null;
  }

  for (const parser of PARSERS) {
    if (!enabledSites.has(parser.id)) continue;
    if (parser.canHandle(url)) {
      try {
        const result = parser.extract(options);
        if (result && result.text.length >= 100) return result;
      } catch (err) {
        console.warn('[RSVP] Parser error:', err);
      }
    }
  }
  return null;
}
