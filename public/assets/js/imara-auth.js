/* Imara Capital — shared Supabase Auth client and helpers.
   Load order: vendor/supabase-js → supabase-config.js → this file. */
(function () {
  'use strict';

  var cfg = window.IMARA_SUPABASE;
  // Captured before the client starts, because it may tidy the URL hash
  // while reading a session (or an error) out of an email link.
  var initialHash = location.hash;
  var client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: {
      storageKey: cfg.storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit flow: email links work even when opened in a different
      // browser than the one that requested them (common with mail apps).
      flowType: 'implicit'
    }
  });

  var MIN_PASSWORD = 8;

  /* Only allow redirects to paths on this site, never to other origins. */
  function safeNext(raw, fallback) {
    fallback = fallback || '/account.html';
    if (!raw || typeof raw !== 'string') return fallback;
    if (raw.charAt(0) !== '/' || raw.charAt(1) === '/' || raw.charAt(1) === '\\') return fallback;
    try {
      var u = new URL(raw, location.origin);
      if (u.origin !== location.origin) return fallback;
      return u.pathname + u.search + u.hash;
    } catch (e) { return fallback; }
  }

  function siteUrl(path) { return location.origin + path; }

  /* Errors Supabase puts in the URL hash when an email link fails. */
  function readHashError() {
    var h = initialHash.replace(/^#/, '');
    if (!h || h.indexOf('error') === -1) return null;
    var p = new URLSearchParams(h);
    if (!p.get('error') && !p.get('error_code')) return null;
    return { code: p.get('error_code') || p.get('error'), description: p.get('error_description') || '' };
  }

  var MESSAGES = {
    invalid_credentials: 'That email and password don’t match. Check them, or reset your password.',
    email_not_confirmed: 'Please confirm your email first. We can send the confirmation link again.',
    user_already_exists: 'An account with this email already exists. Sign in instead, or reset your password.',
    email_exists: 'An account with this email already exists. Sign in instead, or reset your password.',
    weak_password: 'Choose a stronger password: at least ' + MIN_PASSWORD + ' characters, mixing letters and numbers.',
    same_password: 'Your new password must be different from the old one.',
    over_email_send_rate_limit: 'Too many emails sent. Please wait a few minutes and try again.',
    over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
    email_address_invalid: 'That email address doesn’t look right. Please check it.',
    email_address_not_authorized: 'We can’t send email to that address yet. Please contact Imara Capital.',
    signup_disabled: 'New accounts are not open right now. Please contact your Imara officer.',
    otp_expired: 'That link has expired or was already used. Request a new one below.',
    otp_disabled: 'Sign-in links are switched off. Please sign in with your password.',
    reauthentication_needed: 'For your security, sign out and sign in again before changing your password.',
    session_not_found: 'Your session has ended. Please sign in again.',
    refresh_token_not_found: 'Your session has ended. Please sign in again.',
    user_not_found: 'Your session has ended. Please sign in again.',
    validation_failed: 'Please check the details you entered.'
  };

  function friendlyError(err) {
    if (!err) return '';
    if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    var msg = String(err.message || err);
    if (/fetch|network|Failed to fetch|NetworkError/i.test(msg) || err.status === 0) {
      return 'We couldn’t reach the server. Check your connection and try again.';
    }
    if (/rate limit/i.test(msg)) return MESSAGES.over_request_rate_limit;
    if (/Too many applications/i.test(msg)) return 'You’ve sent several applications today. Please call your officer instead.';
    return 'Something went wrong. Please try again.';
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  /* Disable a button for `seconds`, showing a countdown, then restore it. */
  function cooldown(btn, seconds) {
    var label = btn.dataset.label || btn.textContent;
    btn.dataset.label = label;
    btn.disabled = true;
    var left = seconds;
    btn.textContent = label + ' (' + left + 's)';
    var t = setInterval(function () {
      left -= 1;
      if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = label; }
      else { btn.textContent = label + ' (' + left + 's)'; }
    }, 1000);
  }

  /* Wire a show/hide toggle button to a password input. */
  function bindPasswordToggles(root) {
    (root || document).querySelectorAll('[data-toggle-password]').forEach(function (btn) {
      var input = document.getElementById(btn.getAttribute('data-toggle-password'));
      btn.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', String(show));
      });
    });
  }

  window.ImaraAuth = {
    client: client,
    MIN_PASSWORD: MIN_PASSWORD,
    safeNext: safeNext,
    siteUrl: siteUrl,
    readHashError: readHashError,
    friendlyError: friendlyError,
    validEmail: validEmail,
    cooldown: cooldown,
    bindPasswordToggles: bindPasswordToggles
  };
})();
