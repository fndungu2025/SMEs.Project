/* Imara Capital — set a new password after following a reset email link. */
(function () {
  'use strict';

  var A = window.ImaraAuth;
  var sb = A.client;
  var form = document.getElementById('reset-form');
  var notice = document.getElementById('notice');
  var shown = false;

  function $(id) { return document.getElementById(id); }
  function mark(input, ok) { input.closest('.auth-field').classList.toggle('invalid', !ok); return ok; }

  function showForm(session) {
    if (shown) return;
    shown = true;
    $('checking').hidden = true;
    $('expired').hidden = true;
    form.hidden = false;
    $('reset-for').textContent = 'For ' + session.user.email + '.';
    history.replaceState(null, '', location.pathname);
    $('rp-password').focus();
  }
  function showExpired() {
    if (shown) return;
    $('checking').hidden = true;
    $('expired').hidden = false;
  }

  // The recovery link signs the user in and fires PASSWORD_RECOVERY.
  sb.auth.onAuthStateChange(function (event, session) {
    if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) showForm(session);
  });

  var linkError = A.readHashError();
  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (session && !linkError) showForm(session);
    else showExpired();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('rp-password'), pw2 = $('rp-password2');
    var strong = pw.value.length >= A.MIN_PASSWORD && /[A-Za-z]/.test(pw.value) && /\d/.test(pw.value);
    var ok = mark(pw, strong) & mark(pw2, pw2.value === pw.value && pw2.value.length > 0);
    if (!ok) { form.querySelector('.invalid .input').focus(); return; }
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    sb.auth.updateUser({ password: pw.value }).then(function (res) {
      btn.disabled = false; btn.setAttribute('aria-busy', 'false');
      if (res.error) {
        notice.className = 'notice notice-err';
        notice.textContent = A.friendlyError(res.error);
        return;
      }
      notice.className = 'notice notice-ok';
      notice.textContent = 'Password saved. Taking you to your account…';
      form.hidden = true;
      setTimeout(function () { location.replace('/account.html'); }, 1200);
    });
  });

  A.bindPasswordToggles();
  document.querySelectorAll('.auth-field .input').forEach(function (input) {
    input.addEventListener('input', function () { input.closest('.auth-field').classList.remove('invalid'); });
  });
})();
