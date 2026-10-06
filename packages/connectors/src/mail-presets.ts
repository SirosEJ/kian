export type MailSecurity = 'ssl' | 'starttls';
export type MailPreset = {
  id: string; label: string;
  /** The mail server, or null for "Other server" (the person types it). */
  host: string | null; port: number; security: MailSecurity;
  /** Plain-words steps shown in Settings: where to get the password Kian must use. */
  help: string;
  /** Whether this provider normally needs an app password instead of the account password. */
  appPassword: boolean;
};

/** Ports a custom server may use: the standard mail submission ports only. */
export const ALLOWED_MAIL_PORTS = [25, 465, 587, 2587] as const;

export const MAIL_PRESETS: MailPreset[] = [
  { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, security: 'ssl', appPassword: true,
    help: 'Gmail needs an app password, not your normal password. Turn on 2-Step Verification for your Google account, then open Google account, Security, 2-Step Verification, App passwords, create one called Kian and paste the 16 letters here.' },
  { id: 'outlook', label: 'Outlook.com or Hotmail', host: 'smtp-mail.outlook.com', port: 587, security: 'starttls', appPassword: true,
    help: 'Use your full address. Microsoft asks for an app password when two-step verification is on: Microsoft account, Security, Advanced security options, App passwords. If Microsoft says password sign-in is switched off for your account, this connection cannot work yet.' },
  { id: 'microsoft365', label: 'Microsoft 365 (work or school)', host: 'smtp.office365.com', port: 587, security: 'starttls', appPassword: false,
    help: 'Use your work address and password. Your Microsoft 365 administrator must allow "Authenticated SMTP" for your mailbox; many companies switch it off. If it is off, ask your administrator or wait for the Microsoft sign-in option.' },
  { id: 'yahoo', label: 'Yahoo Mail', host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl', appPassword: true,
    help: 'Yahoo needs an app password: Yahoo account, Account security, Generate app password, choose Other app, name it Kian and paste it here.' },
  { id: 'icloud', label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, security: 'starttls', appPassword: true,
    help: 'Use your full iCloud address. Apple needs an app-specific password: appleid.apple.com, Sign-In and Security, App-Specific Passwords, create one called Kian and paste it here.' },
  { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, security: 'ssl', appPassword: true,
    help: 'Zoho accounts with two-factor sign-in need an application-specific password: Zoho account, Security, App Passwords. Use "Zoho Mail (EU)" if your account is on zoho.eu.' },
  { id: 'zoho-eu', label: 'Zoho Mail (EU)', host: 'smtp.zoho.eu', port: 465, security: 'ssl', appPassword: true,
    help: 'Zoho accounts with two-factor sign-in need an application-specific password: Zoho account, Security, App Passwords.' },
  { id: 'fastmail', label: 'Fastmail', host: 'smtp.fastmail.com', port: 465, security: 'ssl', appPassword: true,
    help: 'Fastmail needs an app password with SMTP access: Settings, Privacy and Security, Integrations, New app password, choose Mail (IMAP/POP/SMTP).' },
  { id: 'gmx', label: 'GMX', host: 'mail.gmx.com', port: 587, security: 'starttls', appPassword: false,
    help: 'In GMX, open Settings, POP3 and IMAP access, and allow external programs to send mail. Then use your GMX address and password.' },
  { id: 'mailcom', label: 'mail.com', host: 'smtp.mail.com', port: 587, security: 'starttls', appPassword: false,
    help: 'In mail.com, open Settings, POP3 and IMAP, and allow external programs to send mail. Then use your address and password.' },
  { id: 'ionos-uk', label: 'IONOS (UK)', host: 'smtp.ionos.co.uk', port: 465, security: 'ssl', appPassword: false,
    help: 'Use your IONOS mailbox address and its password.' },
  { id: 'ionos-com', label: 'IONOS (US)', host: 'smtp.ionos.com', port: 465, security: 'ssl', appPassword: false,
    help: 'Use your IONOS mailbox address and its password.' },
  { id: 'ionos-de', label: 'IONOS (Germany)', host: 'smtp.ionos.de', port: 465, security: 'ssl', appPassword: false,
    help: 'Use your IONOS mailbox address and its password.' },
  { id: 'other', label: 'Other server', host: null, port: 587, security: 'starttls', appPassword: false,
    help: 'Ask your email provider for the outgoing (SMTP) server name, the port (465 with SSL, or 587 with STARTTLS) and whether you need an app password. Only public mail servers are accepted.' },
];

export const presetById = (id: unknown): MailPreset | undefined => (typeof id === 'string' ? MAIL_PRESETS.find(p => p.id === id) : undefined);
