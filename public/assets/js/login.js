/* Imara Capital — log in, create account, reset password, magic link. */
(function () {
  'use strict';

  var A = window.ImaraAuth;
  var sb = A.client;
  var params = new URLSearchParams(location.search);
  var next = A.safeNext(params.get('next'));
  var MODES = ['signin', 'signup', 'forgot', 'link', 'sent'];
  var notice = document.getElementById('notice');
  var lastSend = null; // { kind: 'signup' | 'link' | 'forgot', email }

  function $(id) { return document.getElementById(id); }

  /* ---------- notices ---------- */
  function say(kind, text, html) {
    notice.className = 'notice notice-' + kind;
    if (html) notice.innerHTML = html; else notice.textContent = text;
  }
  function clearNotice() { notice.className = 'notice'; notice.textContent = ''; }

  /* ---------- modes ---------- */
  function setMode(mode, keepNotice) {
    if (MODES.indexOf(mode) === -1) mode = 'signin';
    document.querySelectorAll('[data-mode]').forEach(function (el) {
      el.hidden = el.getAttribute('data-mode') !== mode;
    });
    var tab = document.querySelector('input[name="mode-tab"][value="' + (mode === 'signup' ? 'signup' : 'signin') + '"]');
    if (tab) tab.checked = true;
    if (!keepNotice) clearNotice();
    // Carry the email across forms so people don't retype it.
    var email = currentEmail();
    ['si-email', 'su-email', 'fp-email', 'ml-email'].forEach(function (id) {
      if (email && !$(id).value) $(id).value = email;
    });
    var focusEl = mode === 'sent' ? $('panel-sent') : document.querySelector('[data-mode="' + mode + '"] input:not([type=hidden])');
    if (focusEl && document.readyState === 'complete') focusEl.focus({ preventScroll: true });
    document.title = ({ signin: 'Log in', signup: 'Create account', forgot: 'Reset password', link: 'Email me a link', sent: 'Check your email' })[mode] + ' — Imara Capital';
  }
  function currentEmail() {
    var ids = ['si-email', 'su-email', 'fp-email', 'ml-email'];
    for (var i = 0; i < ids.length; i++) { var v = $(ids[i]).value.trim(); if (v) return v; }
    return '';
  }
  function modeFromHash() { return location.hash.replace(/^#/, '') || 'signin'; }

  window.addEventListener('hashchange', function () {
    var m = modeFromHash();
    if (m === 'sent' && !lastSend) m = 'signin';
    setMode(m);
  });
  document.querySelectorAll('input[name="mode-tab"]').forEach(function (r) {
    r.addEventListener('change', function () { location.hash = r.value; });
  });

  /* ---------- field validation ---------- */
  function mark(input, ok) {
    input.closest('.auth-field').classList.toggle('invalid', !ok);
    return ok;
  }
  document.querySelectorAll('.auth-field .input').forEach(function (input) {
    input.addEventListener('input', function () { input.closest('.auth-field').classList.remove('invalid'); });
  });
  function checkEmail(input) {
    input.value = input.value.trim();
    return mark(input, A.validEmail(input.value));
  }
  function strongEnough(pw) {
    return pw.length >= A.MIN_PASSWORD && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  }

  /* Password strength meter on sign-up. */
  $('su-password').addEventListener('input', function () {
    var pw = this.value, score = 0;
    if (pw.length >= A.MIN_PASSWORD) score++;
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) score++;
    if (pw.length >= 12) score++;
    if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
    var m = $('su-meter');
    m.style.width = (score * 25) + '%';
    m.style.background = score <= 1 ? '#DC2626' : score === 2 ? '#D97706' : '#059669';
  });

  function busy(form, on) {
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
  }

  function showSent(kind, email) {
    lastSend = { kind: kind, email: email };
    var text = {
      signup: 'We sent a confirmation link to ' + email + '. Open it on this phone or computer to activate your account.',
      link: 'If ' + email + ' can receive email, a one-time log-in link is on its way. It expires in one hour.',
      forgot: 'If there is an account for ' + email + ', a password reset link is on its way. It expires in one hour.'
    }[kind];
    $('sent-text').textContent = text;
    if (location.hash !== '#sent') history.replaceState(null, '', location.pathname + location.search + '#sent');
    setMode('sent');
    A.cooldown($('resend-btn'), 60);
  }

  /* ---------- log in ---------- */
  $('form-signin').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('si-email'), pw = $('si-password');
    var ok = checkEmail(email) & mark(pw, pw.value.length > 0);
    if (!ok) { (email.closest('.invalid') ? email : pw).focus(); return; }
    busy(this, true); clearNotice();
    var form = this;
    sb.auth.signInWithPassword({ email: email.value, password: pw.value }).then(function (res) {
      if (res.error) {
        busy(form, false);
        if (res.error.code === 'email_not_confirmed') {
          say('err', '', 'Please confirm your email first. <button type="button" class="link-btn" id="resend-confirm">Send the confirmation link again</button>');
          $('resend-confirm').addEventListener('click', function () {
            resend('signup', email.value);
          });
        } else {
          say('err', A.friendlyError(res.error));
        }
        pw.select();
        return;
      }
      location.replace(next);
    });
  });

  /* ---------- create account ---------- */
  $('form-signup').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('su-name'), email = $('su-email'), pw = $('su-password'), pw2 = $('su-password2');
    name.value = name.value.trim();
    var ok = mark(name, name.value.length > 0) & checkEmail(email) &
      mark(pw, strongEnough(pw.value)) & mark(pw2, pw2.value === pw.value && pw2.value.length > 0);
    if (!ok) { this.querySelector('.invalid .input').focus(); return; }
    busy(this, true); clearNotice();
    var form = this;
    sb.auth.signUp({
      email: email.value,
      password: pw.value,
      options: {
        emailRedirectTo: A.siteUrl('/account.html?welcome=1'),
        data: { full_name: name.value }
      }
    }).then(function (res) {
      busy(form, false);
      if (res.error) { say('err', A.friendlyError(res.error)); return; }
      // Email confirmation switched off in Supabase: we already have a session.
      if (res.data.session) { location.replace(A.safeNext(params.get('next'), '/account.html?welcome=1')); return; }
      // Supabase returns a user with no identities when the email is already
      // registered (it won't say so directly, to protect privacy).
      var u = res.data.user;
      if (u && Array.isArray(u.identities) && u.identities.length === 0) {
        $('si-email').value = email.value;
        // replaceState doesn't fire hashchange, so the notice below survives.
        history.replaceState(null, '', location.pathname + location.search + '#signin');
        setMode('signin');
        say('info', '', 'There is already an account for this email. Log in below, or <a href="#forgot">reset your password</a>.');
        return;
      }
      pw.value = ''; pw2.value = '';
      showSent('signup', email.value);
    });
  });

  /* ---------- forgot password ---------- */
  $('form-forgot').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('fp-email');
    if (!checkEmail(email)) { email.focus(); return; }
    busy(this, true); clearNotice();
    var form = this;
    sb.auth.resetPasswordForEmail(email.value, { redirectTo: A.siteUrl('/reset-password.html') }).then(function (res) {
      busy(form, false);
      // Rate limits and outages are worth reporting; "no such user" is not
      // (Supabase doesn't reveal it, and neither do we).
      if (res.error && res.error.status !== 400 && res.error.status !== 404) { say('err', A.friendlyError(res.error)); return; }
      showSent('forgot', email.value);
    });
  });

  /* ---------- magic link ---------- */
  function sendLink(email) {
    return sb.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: A.siteUrl('/account.html'), shouldCreateUser: true }
    });
  }
  $('form-link').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('ml-email');
    if (!checkEmail(email)) { email.focus(); return; }
    busy(this, true); clearNotice();
    var form = this;
    sendLink(email.value).then(function (res) {
      busy(form, false);
      if (res.error) { say('err', A.friendlyError(res.error)); return; }
      showSent('link', email.value);
    });
  });

  /* ---------- resend ---------- */
  function resend(kind, email) {
    var p;
    if (kind === 'signup') p = sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: A.siteUrl('/account.html?welcome=1') } });
    else if (kind === 'link') p = sendLink(email);
    else p = sb.auth.resetPasswordForEmail(email, { redirectTo: A.siteUrl('/reset-password.html') });
    return p.then(function (res) {
      if (res.error && res.error.status >= 429) { say('err', A.friendlyError(res.error)); return; }
      if (res.error && kind !== 'forgot') { say('err', A.friendlyError(res.error)); return; }
      if (modeFromHash() !== 'sent') { showSent(kind, email); return; }
      say('ok', 'Sent again. Use the newest email: older links stop working.');
      A.cooldown($('resend-btn'), 60);
    });
  }
  $('resend-btn').addEventListener('click', function () {
    if (lastSend) resend(lastSend.kind, lastSend.email);
  });

  A.bindPasswordToggles();

  /* ---------- start ---------- */
  var reason = params.get('reason');
  var initial = modeFromHash();
  if (initial === 'sent') initial = 'signin';
  setMode(initial, true);
  if (reason === 'expired') say('err', 'That email link has expired or was already used. Request a new one below.');
  else if (reason === 'signed-out') say('ok', 'You’ve been logged out.');
  else if (reason === 'session') say('info', 'Please log in to continue.');
  else if (reason === 'password-updated') say('ok', 'Your password was changed. Log in with the new one.');

  // Already logged in? Go straight on.
  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session && reason !== 'signed-out') location.replace(next);
  });
})();
