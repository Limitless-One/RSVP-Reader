import {
  detectSiteMatchFromUrl,
  favoriteSiteDefinitions,
  isSiteEnabledForUrl,
} from '../../src/shared/sites';

describe('site families', () => {
  it('maps WordPress chapter URLs to the WordPress family and wildcard host variant', () => {
    const match = detectSiteMatchFromUrl('https://practicalguidetoevil.wordpress.com/2015/11/11/chapter-1-supply/');

    expect(match?.site.id).toBe('wordpress');
    expect(match?.variant.id).toBe('wordpress.com');
  });

  it('maps Ranobes mirrors to the matching family variant', () => {
    const match = detectSiteMatchFromUrl('https://ranobes.com/novels/example/chapters/18');

    expect(match?.site.id).toBe('ranobes');
    expect(match?.variant.id).toBe('ranobes.com');
  });

  it('resolves favorite quick links from the enabled variant inside a family', () => {
    const favorites = favoriteSiteDefinitions(['ranobes'], ['ranobes.com']);

    expect(favorites).toHaveLength(1);
    expect(favorites[0]?.homeUrl).toBe('https://ranobes.com/');
  });

  it('can disable one host variant without disabling the entire family model', () => {
    expect(isSiteEnabledForUrl(
      'https://ranobes.com/novels/example/chapters/18',
      ['ranobes'],
      ['ranobes.top'],
    )).toBe(false);
  });
});
