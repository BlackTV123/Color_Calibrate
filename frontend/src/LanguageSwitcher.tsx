import { t, useLanguage } from './i18n';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return <div className="language-switcher" role="group" aria-label={t('Language')}>
    <button type="button" lang="th" aria-label="ภาษาไทย" aria-pressed={language === 'th'}
      onClick={() => setLanguage('th')}>ไทย</button>
    <button type="button" lang="en" aria-label="English" aria-pressed={language === 'en'}
      onClick={() => setLanguage('en')}>EN</button>
  </div>;
}
