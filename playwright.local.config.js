import config from './playwright.config.js';

export default {
  ...config,
  globalSetup: undefined,
  globalTeardown: undefined
};
