/* Imara Capital — connects the landing page's application dialog to the
   visitor's account. The Supabase library is only downloaded for visitors
   who already have a session, so the landing page stays light for everyone else.
   Exposes window.ImaraAccount = { ready, saveApplication }. */
(function () {
  'use strict';

  var SCRIPTS = [
    '/assets/vendor/supabase-js-2.117.2.js',
    '/assets/js/supabase-config.js',
    '/assets/js/imara-auth.js'
  ];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadAuth() {
    var needed = SCRIPTS.filter(function (src) {
      return !(src.indexOf('supabase-config') !== -1 && window.IMARA_SUPABASE);
    });
    return needed.reduce(function (p, src) {
      return p.then(function () { return loadScript(src); });
    }, Promise.resolve()).then(function () { return window.ImaraAuth; });
  }

  /* Resolves to { user, profile } for a signed-in visitor, or null. */
  var ready = !window.IMARA_SIGNED_IN_HINT ? Promise.resolve(null) : loadAuth()
    .then(function (auth) {
      return auth.client.auth.getSession().then(function (res) {
        var session = res.data && res.data.session;
        if (!session) return null;
        return auth.client.from('profiles')
          .select('full_name, phone, business_name, preferred_language, profile_completed_at')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(function (p) {
            return { user: session.user, profile: p.data || {} };
          });
      });
    })
    .catch(function () { return null; });

  /* Save an application to the signed-in user's account.
     Resolves to the new row id, or null when nobody is signed in. */
  function saveApplication(app) {
    return ready.then(function (acct) {
      if (!acct) return null;
      return window.ImaraAuth.client.from('loan_applications')
        .insert({
          full_name: app.full_name,
          phone: app.phone,
          business_name: app.business_name,
          preferred_language: app.preferred_language,
          amount_ksh: app.amount_ksh,
          term_months: app.term_months,
          location: app.location,
          revenue_band: app.revenue_band,
          time_trading: app.time_trading
        })
        .select('id')
        .single()
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data.id;
        });
    });
  }

  window.ImaraAccount = { ready: ready, saveApplication: saveApplication };

  /* Keep the nav honest if the stored session turned out to be invalid. */
  ready.then(function (acct) {
    if (acct || !window.IMARA_SIGNED_IN_HINT) return;
    document.querySelectorAll('[data-auth-link]').forEach(function (a) {
      a.setAttribute('href', '/login.html');
      a.textContent = 'Log in';
    });
  });
})();
