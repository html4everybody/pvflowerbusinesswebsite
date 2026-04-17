export const environment = {
  production: false,
  apiUrl: '',
  // ── OAuth credentials ──────────────────────────────────────────────────────
  // Google: https://console.cloud.google.com → APIs & Services → Credentials
  //         Create OAuth 2.0 Client ID (Web application)
  //         Add Authorised JavaScript origins: http://localhost:4200
  googleClientId: '446077785747-51ofd16mdj7i07dtfh38d3uufbu9jgck.apps.googleusercontent.com',
  // Facebook: https://developers.facebook.com → My Apps → Create App
  //           Add Facebook Login product, set Valid OAuth Redirect URIs
  //           Also add localhost:4200 to App Domains
  facebookAppId: 'YOUR_FACEBOOK_APP_ID'
};
