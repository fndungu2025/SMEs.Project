/* Imara Capital — create / edit borrower profile (two steps, saved as you go). */
(function () {
  'use strict';

  var A = window.ImaraAuth, P = window.ImaraProfile, sb = A.client;
  var O = P.OPTIONS;
  var params = new URLSearchParams(location.search);
  var PHONE_RE = /^(\+?254|0)[17]\d{8}$/;
  var REG_RE = /^[A-Za-z0-9/ -]{3,40}$/;
  var user = null, profile = {}, editMode = false, step = 1, leaving = false;

  function $(id) { return document.getElementById(id); }
  function say(el, kind, text) { el.className = 'notice notice-' + kind; el.textContent = text; }
  function clear(el) { el.className = 'notice'; el.textContent = ''; }
  function fieldOf(el) { return el.closest('.auth-field'); }
  function mark(el, ok) { fieldOf(el).classList.toggle('invalid', !ok); return ok; }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', String(on)); }
  function checked(name) { var el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; }

  /* ---------- build option controls ---------- */
  function fillSelect(sel, list) {
    list.forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
  }
  function fillSeg(box, name, list) {
    list.forEach(function (v) {
      var label = document.createElement('label');
      label.className = 'seg-opt';
      var input = document.createElement('input');
      input.type = 'radio'; input.name = name; input.value = v;
      label.appendChild(input);
      label.appendChild(document.createTextNode(v));
      box.appendChild(label);
    });
  }
  fillSelect($('pf-type'), O.businessTypes);
  fillSelect($('pf-sector'), O.sectors);
  fillSelect($('pf-employees'), O.employees);
  fillSeg($('pf-city'), 'pf-city', O.cities);
  fillSeg($('pf-years'), 'pf-years', O.years);
  fillSeg($('pf-revenue'), 'pf-revenue', O.revenue);

  function setRadio(name, value) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) { r.checked = r.value === value; });
  }

  /* ---------- form <-> profile ---------- */
  function fill(p) {
    $('pf-name').value = p.full_name || (user.user_metadata && user.user_metadata.full_name) || '';
    $('pf-phone').value = p.phone || '';
    $('pf-email').value = user.email || '';
    setRadio('pf-lang', p.preferred_language || 'Kiswahili');
    $('pf-business').value = p.business_name || '';
    $('pf-type').value = p.business_type || '';
    $('pf-sector').value = p.sector || '';
    setRadio('pf-city', p.city);
    $('pf-town').value = p.town || '';
    $('pf-reg').value = p.registration_number || '';
    setRadio('pf-years', p.years_trading);
    setRadio('pf-revenue', p.monthly_revenue);
    $('pf-employees').value = p.employees || '';
    $('pf-desc').value = p.business_description || '';
    $('desc-count').textContent = $('pf-desc').value.length;
    showAvatar(p);
  }
  function current() {
    return {
      full_name: $('pf-name').value.trim(), phone: $('pf-phone').value.replace(/[\s-]/g, ''),
      business_name: $('pf-business').value.trim(), business_type: $('pf-type').value,
      sector: $('pf-sector').value, city: checked('pf-city'),
      years_trading: checked('pf-years'), monthly_revenue: checked('pf-revenue')
    };
  }
  function updateMeter() {
    var c = P.completion(current());
    $('completion-pct').textContent = c.pct;
    $('completion-bar').style.width = c.pct + '%';
  }
  document.querySelectorAll('.profile-step input, .profile-step select, .profile-step textarea').forEach(function (el) {
    el.addEventListener('input', function () { if (fieldOf(el)) fieldOf(el).classList.remove('invalid'); updateMeter(); });
    el.addEventListener('change', function () { if (fieldOf(el)) fieldOf(el).classList.remove('invalid'); updateMeter(); });
  });
  $('pf-desc').addEventListener('input', function () { $('desc-count').textContent = this.value.length; });

  /* ---------- steps ---------- */
  function goStep(n, focus) {
    step = n;
    document.querySelectorAll('[data-step-panel]').forEach(function (el) { el.hidden = el.getAttribute('data-step-panel') !== String(n); });
    document.querySelectorAll('.step-tab').forEach(function (t) {
      if (t.getAttribute('data-step') === String(n)) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
    });
    $('eyebrow').textContent = editMode ? 'My profile' : 'Step ' + n + ' of 2';
    if (focus) {
      var h = document.querySelector('[data-step-panel="' + n + '"] h2');
      h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true });
      window.scrollTo({ top: $('main').offsetTop, behavior: 'smooth' });
    }
  }
  document.querySelectorAll('.step-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var n = +t.getAttribute('data-step');
      if (n === 2 && step === 1) { $('step-1').requestSubmit(); return; }
      goStep(n, true);
    });
  });
  $('back-1').addEventListener('click', function () { goStep(1, true); });

  function validate1() {
    var name = $('pf-name'), phone = $('pf-phone');
    name.value = name.value.trim();
    phone.value = phone.value.replace(/[\s-]/g, '');
    return [mark(name, name.value.length > 0), mark(phone, PHONE_RE.test(phone.value))];
  }
  function validate2() {
    var biz = $('pf-business'), reg = $('pf-reg');
    biz.value = biz.value.trim(); reg.value = reg.value.trim();
    return [
      mark(biz, biz.value.length > 0),
      mark($('pf-type'), !!$('pf-type').value),
      mark($('pf-sector'), !!$('pf-sector').value),
      mark($('pf-city'), !!checked('pf-city')),
      mark(reg, !reg.value || REG_RE.test(reg.value)),
      mark($('pf-years'), !!checked('pf-years')),
      mark($('pf-revenue'), !!checked('pf-revenue'))
    ];
  }
  function focusFirstInvalid(form) {
    var bad = form.querySelector('.auth-field.invalid');
    if (!bad) return;
    var el = bad.querySelector('input:not([type=hidden]), select, textarea');
    if (el) el.focus();
  }

  $('step-1').addEventListener('submit', function (e) {
    e.preventDefault();
    clear($('notice'));
    if (validate1().indexOf(false) !== -1) { focusFirstInvalid(this); return; }
    var btn = this.querySelector('.step-next'); busy(btn, true);
    P.save(user.id, {
      full_name: $('pf-name').value,
      phone: $('pf-phone').value,
      preferred_language: checked('pf-lang') || 'Kiswahili'
    }).then(function (p) {
      busy(btn, false);
      profile = p; updateMeter(); showAvatar(p);
      goStep(2, true);
    }).catch(function (err) { busy(btn, false); say($('notice'), 'err', A.friendlyError(err)); });
  });

  $('step-2').addEventListener('submit', function (e) {
    e.preventDefault();
    clear($('notice'));
    if (validate2().indexOf(false) !== -1) { focusFirstInvalid(this); return; }
    var btn = $('finish-btn'); busy(btn, true);
    P.save(user.id, {
      business_name: $('pf-business').value,
      business_type: $('pf-type').value,
      sector: $('pf-sector').value,
      city: checked('pf-city'),
      town: $('pf-town').value.trim() || null,
      registration_number: $('pf-reg').value || null,
      years_trading: checked('pf-years'),
      monthly_revenue: checked('pf-revenue'),
      employees: $('pf-employees').value || null,
      business_description: $('pf-desc').value.trim() || null
    }).then(function (p) {
      busy(btn, false);
      profile = p; updateMeter();
      if (!p.profile_completed_at) {
        // Step 1 was skipped or cleared: send them back to it.
        say($('notice'), 'err', 'Almost there. Add your name and mobile number to finish your profile.');
        goStep(1, true); validate1(); return;
      }
      if (editMode) { say($('notice'), 'ok', 'Profile saved.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      document.querySelectorAll('[data-step-panel], .stepper').forEach(function (el) { el.hidden = true; });
      $('eyebrow').textContent = 'Profile created';
      $('page-title').textContent = 'You’re all set.';
      $('page-lede').textContent = 'Your profile is saved. You can change it any time from My account.';
      $('done').hidden = false; $('done').focus();
    }).catch(function (err) { busy(btn, false); say($('notice'), 'err', A.friendlyError(err)); });
  });

  /* ---------- photo ---------- */
  function showAvatar(p) {
    var img = $('avatar-img'), ini = $('avatar-initials');
    ini.textContent = P.initials(p.full_name || $('pf-name').value);
    $('avatar-remove').hidden = !p.avatar_path;
    $('avatar-pick').textContent = p.avatar_path ? 'Change photo' : 'Choose photo';
    if (!p.avatar_path) { img.hidden = true; img.removeAttribute('src'); ini.hidden = false; return; }
    P.avatarUrl(p.avatar_path).then(function (url) {
      if (!url) { img.hidden = true; ini.hidden = false; return; }
      img.src = url; img.alt = 'Your profile photo'; img.hidden = false; ini.hidden = true;
    });
  }
  $('avatar-input').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var an = $('avatar-notice'); clear(an);
    var pick = $('avatar-pick');
    pick.classList.add('is-busy'); pick.setAttribute('aria-busy', 'true');
    say(an, 'info', 'Uploading photo…');
    P.uploadAvatar(user.id, file, profile.avatar_path).then(function (p) {
      profile = p; showAvatar(p);
      say(an, 'ok', 'Photo saved.');
    }).catch(function (err) {
      say(an, 'err', P.photoError(err));
    }).then(function () { pick.classList.remove('is-busy'); pick.removeAttribute('aria-busy'); });
  });
  $('avatar-remove').addEventListener('click', function () {
    var btn = this; busy(btn, true);
    P.removeAvatar(user.id, profile.avatar_path).then(function (p) {
      busy(btn, false); profile = p; showAvatar(p);
      say($('avatar-notice'), 'ok', 'Photo removed.');
    }).catch(function (err) { busy(btn, false); say($('avatar-notice'), 'err', A.friendlyError(err)); });
  });

  /* ---------- start ---------- */
  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (!session) {
      leaving = true;
      location.replace('/login.html?reason=session&next=' + encodeURIComponent('/profile.html'));
      return;
    }
    user = session.user;
    return P.load(user.id).then(function (p) {
      profile = p || {};
      editMode = !!profile.profile_completed_at;
      fill(profile);
      updateMeter();
      if (editMode) {
        document.title = 'My profile — Imara Capital';
        $('page-title').textContent = 'Your profile.';
        $('page-lede').textContent = 'Keep these details current. Your officer sees them before every call.';
        $('finish-btn').lastChild.textContent = 'Save profile';
      }
      $('loading').hidden = true;
      document.body.classList.remove('auth-page-loading');
      var start = (!editMode && profile.full_name && profile.phone) || params.get('step') === '2' ? 2 : 1;
      goStep(start, false);
      if (params.get('welcome')) say($('notice'), 'ok', 'Your email is confirmed. Now let’s create your profile.');
      if (location.search) history.replaceState(null, '', location.pathname);
    });
  }).catch(function (err) {
    $('loading').textContent = A.friendlyError(err);
  });

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT' && !leaving) {
      leaving = true;
      location.replace('/login.html?reason=session&next=' + encodeURIComponent('/profile.html'));
    }
  });
})();
