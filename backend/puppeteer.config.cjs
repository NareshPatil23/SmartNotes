const { join } = require('path');

/**
 * Configuration for Puppeteer to cache Chrome inside the project directory
 * so it survives builds and is located reliably on Linux containers like Render.
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
