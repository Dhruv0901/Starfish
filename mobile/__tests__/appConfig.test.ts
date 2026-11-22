const { checkLiveOrigin } = require('../app.config');

test('demo builds need no origin', () => {
  expect(() => checkLiveOrigin('demo', '')).not.toThrow();
  expect(() => checkLiveOrigin(undefined, undefined)).not.toThrow();
});

test('live builds accept only a real HTTPS origin', () => {
  expect(() => checkLiveOrigin('live', 'https://starfish-api.onrender.com')).not.toThrow();
  expect(() => checkLiveOrigin('live', 'https://starfish-api.onrender.com/')).not.toThrow();
  for (const bad of ['', '   ', 'http://starfish-api.onrender.com', 'https://YOUR-HOST', '<HTTPS_ORIGIN>', 'https://api.example.com',
    'https://localhost:8000', 'starfish-api.onrender.com', 'https://starfish-api.onrender.com/recommendations', 'https://x.onrender.com?a=1']) {
    expect(() => checkLiveOrigin('live', bad)).toThrow(/EXPO_PUBLIC_API_BASE_URL/);
  }
});
