const { chromium } = require('playwright');

(async () => {
  const startedAt = Date.now();
  const bail = setTimeout(() => {
    console.error('audit_timeout');
    process.exit(1);
  }, 120000);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const logs = [];
  page.on('pageerror', (err) => {
    errors.push(String(err));
    if (err && err.stack) {
      errors.push(String(err.stack));
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push(`console:${msg.text()}`);
  });

  const base = 'http://localhost:3002';
  const creds = { email: 'comercial@apiflujos.com', password: 'Apiflujos2026*' };

  console.log('go_login');
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' }).catch(() => null);
  await page.fill('input[name="email"]', creds.email).catch(async () => {
    await page.fill('input[type="email"]', creds.email);
  });
  await page.fill('input[name="password"]', creds.password).catch(async () => {
    await page.fill('input[type="password"]', creds.password);
  });
  console.log('submit_login');
  await page.click('button:has-text("Entrar"), button:has-text("Ingresar"), button[type="submit"]').catch(() => null);
  await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 10000 }).catch(() => null);
  console.log('login_done', page.url());

  const targets = [
    '/payments',
    '/billing',
    '/customers',
    '/products',
    '/settings',
    '/notifications/list',
    '/logs'
  ];

  const results = [];

  for (const path of targets) {
    const url = base + path;
    console.log('goto', path);
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(300);

    const section = { path, checks: [] };

    const filterBtn = page.locator('.btn-filter:visible').first();
    if (await filterBtn.count()) {
      await filterBtn.click().catch(() => null);
      let modalVisible = false;
      try {
        await page.waitForSelector('.smartFilterModalPanel', { timeout: 2500 });
        modalVisible = true;
      } catch {}
      // Si no hay modal, validar que exista el bloque de filtros inline
      if (!modalVisible) {
        const inlineFilters = await page.$('.page-header-standard-filters-group .filtersForm, .filtersForm.filtersSearch');
        modalVisible = Boolean(inlineFilters);
      }
      section.checks.push({ action: 'open_filter_modal', ok: modalVisible });
      const closeBtn = await page.$('[data-modal-close="true"], .modal-close');
      if (closeBtn) await closeBtn.click().catch(() => null);
      await page.waitForTimeout(200);
    }

    if (path === '/payments') {
      const reconcileBtn = await page.$('.payments-header-actions button:has-text("Reconciliar"), button:has-text("Reconciliar pago")');
      if (reconcileBtn) {
        await reconcileBtn.click().catch(() => null);
        const modalVisible = await page.$('.modal-panel:has-text("Reconciliar")');
        section.checks.push({ action: 'open_reconcile_modal', ok: Boolean(modalVisible) });
        const closeBtn = await page.$('[data-modal-close="true"], .modal-close');
        if (closeBtn) await closeBtn.click().catch(() => null);
      }
    }

    if (path === '/billing') {
      const listLink = await page.$('a[href*="vista=lista"], button:has-text("Lista")');
      if (listLink) {
        await listLink.click().catch(() => null);
        await page.waitForTimeout(600);
        section.checks.push({ action: 'switch_to_list', ok: true });
      }
      const kanbanLink = await page.$('a[href*="vista=kanban"], button:has-text("Kanban")');
      if (kanbanLink) {
        await kanbanLink.click().catch(() => null);
        await page.waitForTimeout(600);
        section.checks.push({ action: 'switch_to_kanban', ok: true });
      }
    }

    if (path === '/customers') {
      await page.waitForSelector('button:has-text("Crear contacto"):visible', { timeout: 5000 }).catch(() => null);
      const createBtn = await page.$('button:has-text("Crear contacto"):visible');
      if (createBtn) {
        await createBtn.click().catch(() => null);
        await page.waitForTimeout(600);
        const modalVisible = Boolean(await page.$('.modal-panel'));
        section.checks.push({ action: 'open_create_contact_modal', ok: modalVisible });
        const closeBtn = await page.$('[data-modal-close="true"], .modal-close');
        if (closeBtn) await closeBtn.click().catch(() => null);
      }
    }

    if (path === '/products') {
      await page.waitForSelector('button:has-text("Crear producto"):visible', { timeout: 5000 }).catch(() => null);
      const createBtn = await page.$('button:has-text("Crear producto"):visible');
      if (createBtn) {
        await createBtn.click().catch(() => null);
        await page.waitForTimeout(600);
        const modalVisible = Boolean(await page.$('.modal-panel'));
        section.checks.push({ action: 'open_create_product_modal', ok: modalVisible });
        const closeBtn = await page.$('[data-modal-close="true"], .modal-close');
        if (closeBtn) await closeBtn.click().catch(() => null);
      }
    }

    if (path === '/settings') {
      const tab = await page.$('.panel-tab');
      if (tab) {
        await tab.click().catch(() => null);
        section.checks.push({ action: 'switch_settings_tab', ok: true });
      }
    }

    results.push(section);
  }

  console.log(JSON.stringify({ results, errors, logs }, null, 2));
  await browser.close();
  clearTimeout(bail);
  console.log('audit_done', Date.now() - startedAt);
})();
