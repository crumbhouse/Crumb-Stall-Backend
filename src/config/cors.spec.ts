import { getAllowedOrigins } from './cors';

describe('CORS config', () => {
  const originalClientOrigin = process.env.CLIENT_ORIGIN;

  afterEach(() => {
    process.env.CLIENT_ORIGIN = originalClientOrigin;
  });

  it('parses comma-separated origins and removes trailing slashes', () => {
    process.env.CLIENT_ORIGIN =
      'https://crumbstall.com/, https://www.crumbstall.com';

    expect(getAllowedOrigins()).toEqual([
      'https://crumbstall.com',
      'https://www.crumbstall.com',
    ]);
  });

  it('returns an empty list when CLIENT_ORIGIN is not configured', () => {
    delete process.env.CLIENT_ORIGIN;

    expect(getAllowedOrigins()).toEqual([]);
  });
});
