/* Swap "Log in" for "My account" when this browser holds a session.
   Reads the stored session only — no network, no Supabase library needed.
   The account page itself verifies the session with Supabase. */
(function () {
  'use strict';

  /* If Supabase sent an email link back to this page (it falls back to the
     Site URL when the requested page isn't on its Redirect URLs list),
     forward it to the page that knows how to finish logging in. */
  var h = location.hash;
  if (/[#&](access_token|error_code|error)=/.test(h)) {
    var type = (h.match(/[#&]type=([a-z_]+)/) || [])[1];
    var target = type === 'recovery' || type === 'invite' ? '/reset-password.html'
      : type === 'signup' ? '/account.html?welcome=1' : '/account.html';
    location.replace(target + h);
    return;
  }

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
