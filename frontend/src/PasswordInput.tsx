import { t, useLanguage } from './i18n';
import { useState, type InputHTMLAttributes } from 'react';
import Icon from './Icon';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string };

export default function PasswordInput({ id, ...props }: PasswordInputProps) {
  useLanguage();
  const [visible, setVisible] = useState(false);
  const description = id.endsWith('-confirm') ? 'รหัสผ่านยืนยัน' : 'รหัสผ่าน';
  const action = (visible ? 'ซ่อน' : 'แสดง') + description;

  return (
    <div className="password-field">
      <input {...props} id={id} type={visible ? 'text' : "password"} />
      <button type="button" className="password-toggle" aria-controls={id}
        aria-label={t(action)} title={t(action)} aria-pressed={visible}
        onClick={() => setVisible(value => !value)}>
        <Icon name={visible ? 'eye-off' : 'eye'} />
      </button>
    </div>
  );
}
