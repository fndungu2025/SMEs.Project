/* Imara Capital — account page: applications, profile, password, email, log out. */
(function () {
  'use strict';

  var A = window.ImaraAuth;
  var sb = A.client;
  var params = new URLSearchParams(location.search);
  var user = null;
  var leaving = false;

  function $(id) { return document.getElementById(id); }
  function say(el, kind, text) { el.className = 'notice notice-' + kind; el.textContent = text; }
  function clear(el) { el.className = 'notice'; el.textContent = ''; }
  function mark(input, ok) { input.closest('.auth-field').classList.toggle('invalid', !ok); return ok; }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', String(on)); }
  function goLogin(reason) {
    leaving = true;
    location.replace('/login.html?reason=' + encodeURIComponent(reason) + '&next=' + encodeURIComponent('/account.html'));
  }

  var fmtKsh = function (n) { return 'KSh ' + Number(n).toLocaleString('en-KE'); };
  var fmtDate = function (iso) {
    return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  var STATUS = {
    submitted: 'Submitted', in_review: 'In review', offer_sent: 'Offer sent',
    disbursed: 'Disbursed', declined: 'Declined', withdrawn: 'Withdrawn'
  };
  var PHONE_RE = /^(\+?254|0)[17]\d{8}$/;

  /* ---------- applications ---------- */
  function renderApps(rows) {
    var box = $('apps');
    box.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<p>No applications yet. When you apply while logged in, they appear here.</p>' +
        '<a href="/#calculator" class="btn btn-secondary" style="min-height:44px;padding:0 18px">Run the numbers</a>';
      box.appendChild(empty);
      return;
    }
    var wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    var table = document.createElement('table');
    table.className = 'table apps-table';
    table.innerHTML = '<thead><tr><th scope="col">Sent</th><th scope="col">Amount</th><th scope="col">Term</th>' +
      '<th scope="col">Branch</th><th scope="col">Status</th></tr></thead>';
    var tbody = document.createElement('tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      [fmtDate(r.created_at), fmtKsh(r.amount_ksh), r.term_months + ' months', r.location || '—'].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      });
      var td = document.createElement('td');
      var tag = document.createElement('span');
      tag.className = 'status status-' + r.status;
      tag.textContent = STATUS[r.status] || r.status;
      td.appendChild(tag); tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
  }

  function loadApps() {
    return sb.from('loan_applications')
      .select('id, amount_ksh, term_months, location, status, created_at')
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) { $('apps').innerHTML = ''; say(notice(), 'err', A.friendlyError(res.error)); return; }
        renderApps(res.data || []);
      });
  }
  function notice() { return $('notice'); }

  /* ---------- profile ---------- */
  function fillProfile(p) {
    p = p || {};
    $('pf-name').value = p.full_name || (user.user_metadata && user.user_metadata.full_name) || '';
    $('pf-phone').value = p.phone || '';
    $('pf-business').value = p.business_name || '';
    $('pf-city').value = p.city || '';
    var lang = document.querySelector('input[name="pf-lang"][value="' + (p.preferred_language || 'Kiswahili') + '"]');
    if (lang) lang.checked = true;
    var first = ($('pf-name').value || '').split(/\s+/)[0];
    $('greeting').textContent = first ? 'Habari, ' + first + '.' : 'Karibu.';
  }

  function loadProfile() {
    return sb.from('profiles')
      .select('full_name, phone, business_name, city, preferred_language')
      .eq('id', user.id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) { say(notice(), 'err', A.friendlyError(res.error)); return; }
        fillProfile(res.data);
      });
  }

  $('details-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var dn = $('details-notice'); clear(dn);
    var name = $('pf-name'), phone = $('pf-phone');
    name.value = name.value.trim();
    phone.value = phone.value.replace(/[\s-]/g, '');
    var ok = mark(name, name.value.length > 0) & mark(phone, !phone.value || PHONE_RE.test(phone.value));
    if (!ok) { this.querySelector('.invalid .input').focus(); return; }
    var btn = this.querySelector('button[type="submit"]');
    busy(btn, true);
    sb.from('profiles').update({
      full_name: name.value,
      phone: phone.value || null,
      business_name: $('pf-business').value.trim() || null,
      city: $('pf-city').value || null,
      preferred_language: document.querySelector('input[name="pf-lang"]:checked').value
    }).eq('id', user.id).then(function (res) {
      busy(btn, false);
      if (res.error) { say(dn, 'err', A.friendlyError(res.error)); return; }
      say(dn, 'ok', 'Saved. Your next application will use these details.');
      var first = name.value.split(/\s+/)[0];
      $('greeting').textContent = 'Habari, ' + first + '.';
    });
  });

  /* ---------- password ---------- */
  $('password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var sn = $('security-notice'); clear(sn);
    var pw = $('np-password'), pw2 = $('np-password2');
    var strong = pw.value.length >= A.MIN_PASSWORD && /[A-Za-z]/.test(pw.value) && /\d/.test(pw.value);
    var ok = mark(pw, strong) & mark(pw2, pw2.value === pw.value && pw2.value.length > 0);
    if (!ok) { this.querySelector('.invalid .input').focus(); return; }
    var btn = this.querySelector('button[type="submit"]');
    busy(btn, true);
    sb.auth.updateUser({ password: pw.value }).then(function (res) {
      busy(btn, false);
      if (res.error) { say(sn, 'err', A.friendlyError(res.error)); return; }
      pw.value = ''; pw2.value = '';
      say(sn, 'ok', 'Password changed. Use the new one next time you log in.');
    });
  });

  /* ---------- email ---------- */
  $('email-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var sn = $('security-notice'); clear(sn);
    var input = $('ne-email');
    input.value = input.value.trim();
    var ok = A.validEmail(input.value) && input.value.toLowerCase() !== (user.email || '').toLowerCase();
    if (!mark(input, ok)) { input.focus(); return; }
    var btn = this.querySelector('button[type="submit"]');
    busy(btn, true);
    sb.auth.updateUser({ email: input.value }, { emailRedirectTo: A.siteUrl('/account.html?email-changed=1') }).then(function (res) {
      busy(btn, false);
      if (res.error) { say(sn, 'err', A.friendlyError(res.error)); return; }
      say(sn, 'info', 'Almost done. We sent confirmation links to ' + (user.email || 'your current address') +
        ' and ' + input.value + '. Your email changes once you open them.');
      input.value = '';
    });
  });

  /* ---------- log out ---------- */
  function signOut(scope, btn) {
    busy(btn, true);
    leaving = true; // the SIGNED_OUT event fires before signOut resolves
    sb.auth.signOut({ scope: scope }).then(function () { goLogin('signed-out'); });
  }
  $('signout-btn').addEventListener('click', function () { signOut('local', this); });
  $('signout-here').addEventListener('click', function () { signOut('local', this); });
  $('signout-all').addEventListener('click', function () { signOut('global', this); });

  A.bindPasswordToggles();

  /* ---------- start ---------- */
  var linkError = A.readHashError();
  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (!session) { goLogin(linkError ? 'expired' : 'session'); return; }
    user = session.user;
    // Remove tokens or flags from the address bar.
    if (location.hash || location.search) history.replaceState(null, '', location.pathname);
    $('who').textContent = 'Logged in as ' + user.email;
    $('loading').hidden = true;
    document.body.classList.remove('auth-page-loading');
    if (params.get('welcome')) say(notice(), 'ok', 'Your email is confirmed. Welcome to Imara Capital.');
    else if (params.get('email-changed')) say(notice(), 'ok', 'Email confirmed. If you were asked to confirm on both addresses, open the other link too.');
    else if (linkError) say(notice(), 'err', A.friendlyError({ code: linkError.code }));
    loadProfile();
    loadApps();
  });

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT' && !leaving) goLogin('session');
    if (event === 'USER_UPDATED' && session) {
      user = session.user;
      $('who').textContent = 'Logged in as ' + user.email;
    }
  });
})();
