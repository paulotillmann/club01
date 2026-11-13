/* global process */
import puppeteer from 'puppeteer-core';

async function testChrome() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setContent('<html><body><h1>CLUB 01 TEST HARNESS OK</h1></body></html>');
  const title = await page.$eval('h1', el => el.textContent);
  console.log('SUCCESS: Browser launched and rendered:', title);
  await browser.close();
}

testChrome().catch(err => {
  console.error('ERROR launching browser:', err);
  process.exit(1);
});
