/* Imara Capital landing — calculator, eligibility check and application form.
   Ported from the Claude Design component logic to plain JS. */
(function () {
  'use strict';

  var MONTHLY_RATE = 0.02;      // 2% a month, reducing balance
  var PROCESSING_FEE = 0.03;    // 3% one-time
  var EXCISE_ON_FEE = 0.2;      // 20% excise duty on the fee
  var STOPS = [100000, 150000, 200000, 250000, 300000, 400000, 500000, 600000, 700000, 800000,
    1000000, 1250000, 1500000, 2000000, 2500000, 3000000, 4000000, 5000000, 6000000, 8000000,
    10000000, 12000000];
  var LOCS = ['Nairobi', 'Mombasa', 'Nakuru', 'Eldoret', 'Elsewhere'];
  var REVS = ['Under 200K', '200K – 500K', '500K – 2M', 'Over 2M'];
  var AGES = ['Under 1 year', '1 – 3 years', 'Over 3 years'];
  var LIMITS = ['', 'KSh 1.5M', 'KSh 5M', 'KSh 12M'];

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return 'KSh ' + Math.round(n).toLocaleString('en-KE'); }
  function short(n) {
    return n >= 1e6 ? 'KSh ' + parseFloat((n / 1e6).toFixed(2)) + 'M' : 'KSh ' + Math.round(n / 1000) + 'K';
  }
  function checkedValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? +el.value : null;
  }

  /* ---------- Placeholder links ---------- */
  document.querySelectorAll('a[href="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); });
  });

  /* ---------- Loan calculator ---------- */
  var amt = $('amt'), rev = $('rev');
  var calc = { principal: STOPS[+amt.value], term: 12 };

  function renderCalc() {
    var P = STOPS[+amt.value];
    var n = checkedValue('term') || 12;
    var revenue = +rev.value;
    var r = MONTHLY_RATE;
    var pmt = r > 0 ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
    var total = pmt * n;
    var ratio = pmt / revenue;
    var fit = ratio <= 0.15 ? 'Comfortable' : ratio <= 0.3 ? 'Workable' : 'Tight — try a longer term';
    var fitColor = ratio <= 0.15 ? '#059669' : ratio <= 0.3 ? '#D97706' : '#DC2626';
    var fee = P * PROCESSING_FEE;

    calc.principal = P; calc.term = n;
    $('amt-label').textContent = short(P);
    amt.setAttribute('aria-valuetext', short(P));
    $('rev-label').textContent = short(revenue);
    rev.setAttribute('aria-valuetext', short(revenue));
    $('out-monthly').textContent = fmt(pmt);
    $('out-term').textContent = n + ' months';
    $('out-fit').textContent = Math.round(ratio * 100) + '% · ' + fit;
    var bar = $('fit-bar');
    bar.style.width = Math.min(100, ratio * 100) + '%';
    bar.style.background = fitColor;
    $('out-total').textContent = fmt(total);
    $('out-interest').textContent = fmt(total - P);
    $('out-fee').textContent = fmt(fee);
    $('out-excise').textContent = fmt(fee * EXCISE_ON_FEE);
    $('out-days').textContent = P <= 1e6 ? '10 – 14 days' : P <= 5e6 ? '21 – 30 days' : '45 – 60 days';
    $('apply-amt').textContent = short(P);
  }
  $('rate-label').textContent = parseFloat((MONTHLY_RATE * 100).toFixed(2)) + '%';
  $('fee-label').textContent = parseFloat((PROCESSING_FEE * 100).toFixed(2)) + '%';
  amt.addEventListener('input', renderCalc);
  rev.addEventListener('input', renderCalc);
  document.querySelectorAll('input[name="term"]').forEach(function (el) {
    el.addEventListener('change', renderCalc);
  });
  renderCalc();

  /* ---------- Eligibility check ---------- */
  var pending = $('elig-pending'), ok = $('elig-ok'), no = $('elig-no');
  var dots = document.querySelectorAll('.elig-dot');

  function renderElig() {
    var loc = checkedValue('loc'), rb = checkedValue('revband'), age = checkedValue('age');
    var answered = [loc, rb, age].filter(function (v) { return v !== null; }).length;
    var done = answered === 3;
    var tag = '', title = '', body = '';
    if (done) {
      if (loc === 4) {
        tag = 'Not in your town yet'; title = 'We lend in four cities today.';
        body = 'Imara serves Nairobi, Mombasa, Nakuru and Eldoret. If your business is nearby and you trade into one of them, call us — we can often still help.';
      } else if (rb === 0) {
        tag = 'Not yet'; title = 'Almost there.';
        body = 'We lend to businesses turning over KSh 200,000 a month or more. Run your sales through an M-Pesa till or bank account — that record is what gets you approved when you cross the line.';
      } else if (age === 0) {
        tag = 'Not yet'; title = 'Come back at year one.';
        body = 'We look for at least 12 months of trading. Keep your statements clean for the next few months and check again when you pass your first year.';
      }
    }
    var isNo = done && !!title;
    $('elig-count').textContent = answered;
    dots.forEach(function (d, i) { d.style.background = i < answered ? 'var(--color-accent)' : 'transparent'; });
    pending.hidden = done;
    ok.hidden = !(done && !isNo);
    no.hidden = !isNo;
    if (isNo) {
      $('elig-no-tag').textContent = tag;
      $('elig-no-title').textContent = title;
      $('elig-no-body').textContent = body;
    }
    if (done && !isNo) {
      $('elig-limit').textContent = LIMITS[rb];
      $('elig-city').textContent = loc < 4 ? LOCS[loc] : 'your city';
    }
  }
  ['loc', 'revband', 'age'].forEach(function (name) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (el) {
      el.addEventListener('change', renderElig);
    });
  });
  $('elig-reset').addEventListener('click', function () {
    document.querySelectorAll('input[name="loc"],input[name="revband"],input[name="age"]').forEach(function (el) {
      el.checked = false;
    });
    renderElig();
    var first = document.querySelector('input[name="loc"]');
    if (first) first.focus();
  });
  renderElig();

  /* ---------- Application dialog (Netlify Forms) ---------- */
  var dialog = $('app-dialog'), form = $('app-form'), lastFocus = null;

  function openDialog() {
    var loc = checkedValue('loc'), rb = checkedValue('revband'), age = checkedValue('age');
    $('app-location').value = loc !== null ? LOCS[loc] : '';
    $('app-revband').value = rb !== null ? REVS[rb] : '';
    $('app-age').value = age !== null ? AGES[age] : '';
    $('app-amount').value = fmt(calc.principal);
    $('app-term').value = calc.term + ' months';
    var parts = ['Loan: ' + short(calc.principal) + ' over ' + calc.term + ' months'];
    if (loc !== null) parts.push(LOCS[loc]);
    if (rb !== null) parts.push('revenue ' + REVS[rb]);
    $('app-summary').textContent = parts.join(' · ');
    prefillFromAccount();
    lastFocus = document.activeElement;
    dialog.hidden = false;
    document.body.classList.add('dialog-open');
    $('app-name').focus();
  }
  /* Signed-in visitors: fill empty fields from their profile and say where
     the application will be saved. Works without an account too. */
  function prefillFromAccount() {
    var note = $('app-account-note');
    if (!window.ImaraAccount) return;
    window.ImaraAccount.ready.then(function (acct) {
      if (!acct) {
        note.innerHTML = 'Have an account? <a href="/login.html?next=%2F%23eligibility">Log in</a> to track this application.';
        return;
      }
      var p = acct.profile || {};
      [['app-name', p.full_name], ['app-phone', p.phone], ['app-business', p.business_name]].forEach(function (pair) {
        var input = $(pair[0]);
        if (!input.value && pair[1]) input.value = pair[1];
      });
      if (p.preferred_language) {
        var lang = form.querySelector('input[name="language"][value="' + p.preferred_language + '"]');
        if (lang) lang.checked = true;
      }
      note.textContent = 'Signed in as ' + acct.user.email + '. This application will be saved to your account.';
      if (!p.profile_completed_at) {
        note.appendChild(document.createTextNode(' '));
        var link = document.createElement('a');
        link.href = '/profile.html';
        link.textContent = 'Finish your profile';
        note.appendChild(link);
        note.appendChild(document.createTextNode(' to speed up the call.'));
      }
    });
  }

  function closeDialog() {
    dialog.hidden = true;
    document.body.classList.remove('dialog-open');
    if (lastFocus) lastFocus.focus();
  }
  $('start-app').addEventListener('click', openDialog);
  $('app-close').addEventListener('click', closeDialog);
  $('app-done-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !dialog.hidden) closeDialog();
    if (e.key === 'Tab' && !dialog.hidden) {
      var f = dialog.querySelectorAll('button:not([disabled]),input:not([type=hidden]):not([name=bot-field]),a[href]');
      var vis = Array.prototype.filter.call(f, function (el) { return el.offsetParent !== null; });
      if (!vis.length) return;
      var first = vis[0], last = vis[vis.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  ['app-name', 'app-phone', 'app-business'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var field = this.closest('.app-field');
      if (field.classList.contains('invalid') && this.checkValidity()) field.classList.remove('invalid');
    });
  });
  $('app-consent').addEventListener('change', function () {
    if (this.checked) this.closest('.consent').classList.remove('invalid');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var valid = true, firstBad = null;
    ['app-name', 'app-phone', 'app-business'].forEach(function (id) {
      var input = $(id);
      input.value = input.value.trim();
      if (id === 'app-phone') input.value = input.value.replace(/[\s-]/g, '');
      var good = input.checkValidity();
      input.closest('.app-field').classList.toggle('invalid', !good);
      if (!good) { valid = false; firstBad = firstBad || input; }
    });
    var consent = $('app-consent');
    consent.closest('.consent').classList.toggle('invalid', !consent.checked);
    if (!consent.checked) { valid = false; firstBad = firstBad || consent; }
    if (!valid) { firstBad.focus(); return; }

    var btn = $('app-submit'), err = $('app-error');
    btn.disabled = true; err.hidden = true;
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // The officer is already notified via Netlify; saving to the account is
      // a bonus, so a failure there must not undo the success state.
      var save = window.ImaraAccount ? window.ImaraAccount.saveApplication({
        full_name: $('app-name').value,
        phone: $('app-phone').value,
        business_name: $('app-business').value,
        preferred_language: (form.querySelector('input[name="language"]:checked') || {}).value || 'Kiswahili',
        amount_ksh: calc.principal,
        term_months: calc.term,
        location: $('app-location').value || null,
        revenue_band: $('app-revband').value || null,
        time_trading: $('app-age').value || null
      }) : Promise.resolve(null);
      return save.then(function (id) { return { saved: !!id }; }, function () { return { saved: false, failed: true }; });
    }).then(function (result) {
      var acctMsg = $('app-done-account');
      if (result.saved) {
        acctMsg.innerHTML = 'Saved to your account. <a href="/account.html">Track it in My account</a>.';
        acctMsg.hidden = false;
      } else if (result.failed) {
        acctMsg.textContent = 'We received your request, but couldn\u2019t add it to your account page. Your officer will still call.';
        acctMsg.hidden = false;
      }
      $('app-form-wrap').hidden = true;
      $('app-done').hidden = false;
      $('app-done').focus();
    }).catch(function () {
      btn.disabled = false;
      err.textContent = 'Something went wrong sending your details. Please try again.';
      err.hidden = false;
    });
  });
})();
