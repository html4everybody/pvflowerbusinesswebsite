export const environment = {
  production: false,
  apiUrl: '',
  // ── OAuth credentials ──────────────────────────────────────────────────────
  // Google: https://console.cloud.google.com → APIs & Services → Credentials
  //         Create OAuth 2.0 Client ID (Web application)
  //         Add Authorised JavaScript origins: http://localhost:4200
  googleClientId: '457325958919-v0aqd7r9c6kuenb20rjb7g0foctposi9.apps.googleusercontent.com',
  // Facebook: https://developers.facebook.com → My Apps → Create App
  //           Add Facebook Login product, set Valid OAuth Redirect URIs
  //           Also add localhost:4200 to App Domains
  facebookAppId: 'YOUR_FACEBOOK_APP_ID'
};
