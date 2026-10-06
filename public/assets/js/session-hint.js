/* Swap "Log in" for "My account" when this browser holds a session.
   Reads the stored session only — no network, no Supabase library needed.
   The account page itself verifies the session with Supabase. */
(function () {
  'use strict';
  var signedIn = false;
  try {
    var raw = localStorage.getItem((window.IMARA_SUPABASE && window.IMARA_SUPABASE.storageKey) || 'imara-auth');
    if (raw) {
      var s = JSON.parse(raw);
      signedIn = !!(s && s.refresh_token);
    }
  } catch (e) { /* storage blocked: treat as signed out */ }
  window.IMARA_SIGNED_IN_HINT = signedIn;
  if (!signedIn) return;
  document.querySelectorAll('[data-auth-link]').forEach(function (a) {
    a.setAttribute('href', '/account.html');
    a.textContent = 'My account';
  });
})();
