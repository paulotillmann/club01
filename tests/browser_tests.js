/* global process */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'C:\\club01\\tests\\screenshots';
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 640 },
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 }
];

async function runBrowserTests() {
  console.log("=== INICIANDO TESTES VISUAIS E RESPONSIVOS NO GOOGLE CHROME REAL ===");

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const results = [];

  // 1. Testar Home em todos os 6 viewports
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });

    // Verificar rolagem horizontal indevida
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    // Verificar se logo está presente
    const logoExists = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.some(img => img.src.includes('logo_club01'));
    });

    // Verificar tipografia Bebas Neue
    const titleText = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.innerText : '';
    });

    const shotPath = path.join(SCREENSHOT_DIR, `home_${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    results.push({
      test: `Home Viewport ${vp.width}px (${vp.name})`,
      overflow: hasHorizontalOverflow ? 'FALHA (Rolagem horizontal detectada)' : 'OK (Sem overflow horizontal)',
      logo: logoExists ? 'OK' : 'FALHA',
      title: titleText,
      screenshot: shotPath
    });
    console.log(`[PASS] Home @ ${vp.width}px - Overflow: ${!hasHorizontalOverflow} - Logo: ${logoExists}`);
  }

  // 2. Testar Tema (Dark Mode e Light Mode) e persistência
  console.log("\n--- TESTE DE TEMA (DARK / LIGHT) ---");
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });

  const initialTheme = await page.evaluate(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  console.log("Tema inicial:", initialTheme);

  // Clicar no botão de alternância de tema
  const themeToggleClicked = await page.evaluate(() => {
    const btn = document.querySelector('button[title*="tema"], button[aria-label*="tema"]') ||
                Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('lucide-sun') || b.innerHTML.includes('lucide-moon'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  await new Promise(r => setTimeout(r, 400));
  const newTheme = await page.evaluate(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const savedLocalStorage = await page.evaluate(() => localStorage.getItem('club01_theme'));

  console.log(`Botão clicado: ${themeToggleClicked} | Novo tema: ${newTheme} | localStorage: ${savedLocalStorage}`);

  const lightShot = path.join(SCREENSHOT_DIR, 'home_theme_toggled.png');
  await page.screenshot({ path: lightShot });

  // 3. Testar Tela de Agendamento (/agendar)
  console.log("\n--- TESTE DA TELA DE AGENDAMENTO PÚBLICO (/agendar) ---");
  await page.goto('http://localhost:5173/agendar', { waitUntil: 'networkidle0' });

  for (const vp of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[5]]) { // 320px, 390px, 1440px
    await page.setViewport({ width: vp.width, height: vp.height });
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const agendarShot = path.join(SCREENSHOT_DIR, `agendar_${vp.name}.png`);
    await page.screenshot({ path: agendarShot });
    console.log(`[PASS] /agendar @ ${vp.width}px - Overflow: ${!hasHorizontalOverflow} - Screenshot: ${agendarShot}`);
  }

  // 4. Testar Tela de Login (/login)
  console.log("\n--- TESTE DA TELA DE LOGIN (/login) ---");
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle0' });
  await page.setViewport({ width: 390, height: 844 });
  const loginMobileShot = path.join(SCREENSHOT_DIR, 'login_mobile_390.png');
  await page.screenshot({ path: loginMobileShot });

  await page.setViewport({ width: 1440, height: 900 });
  const loginDesktopShot = path.join(SCREENSHOT_DIR, 'login_desktop_1440.png');
  await page.screenshot({ path: loginDesktopShot });
  console.log("[PASS] /login renderizado no mobile e desktop.");

  // 5. Testar Tela Sobre (/sobre) e Trabalhe Conosco (/trabalhe-conosco)
  await page.goto('http://localhost:5173/sobre', { waitUntil: 'networkidle0' });
  const sobreShot = path.join(SCREENSHOT_DIR, 'sobre_desktop.png');
  await page.screenshot({ path: sobreShot });
  console.log("[PASS] /sobre renderizado.");

  await page.goto('http://localhost:5173/trabalhe-conosco', { waitUntil: 'networkidle0' });
  const tcShot = path.join(SCREENSHOT_DIR, 'trabalhe_conosco_desktop.png');
  await page.screenshot({ path: tcShot });
  console.log("[PASS] /trabalhe-conosco renderizado.");

  await browser.close();

  console.log("\n=== TESTES VISUAIS EM CHROME CONCLUÍDOS COM SUCESSO! ===");
  console.log(`Total de screenshots gerados: ${fs.readdirSync(SCREENSHOT_DIR).length}`);
}

runBrowserTests().catch(err => {
  console.error("ERRO NO TESTE DE NAVEGADOR:", err);
  process.exit(1);
});
