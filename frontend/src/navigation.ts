export type Page = 'home' | 'dashboard' | 'analysis' | 'history' | 'profile' | 'login' | 'register';
export type WorkspacePage = Exclude<Page, 'home' | 'login' | 'register'>;

export function readPage(hash: string): Page {
  const page = hash.replace(/^#\/?/, '');
  return ['home', 'dashboard', 'analysis', 'history', 'profile', 'login', 'register'].includes(page) ? page as Page : 'home';
}

export function isWorkspacePage(page: Page): page is WorkspacePage {
  return page !== 'home' && page !== 'login' && page !== 'register';
}
