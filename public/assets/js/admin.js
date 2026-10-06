/* Imara Capital — staff console (employees and administrators).
   Data access is enforced by the database (RLS + role-checking functions) and the
   admin-users Edge Function; this page only decides what to show. */
(function () {
  'use strict';

  var A = window.ImaraAuth, P = window.ImaraProfile, sb = A.client, cfg = window.IMARA_SUPABASE;
  var me = null, role = 'user', isAdmin = false, leaving = false;
  var PAGE = 25;
  var state = { usersPage: 0, usersTotal: 0, appsPage: 0, appsTotal: 0, users: [], current: null, notesApp: null, sys: null };

  var STATUS = { submitted: 'Submitted', in_review: 'In review', offer_sent: 'Offer sent', disbursed: 'Disbursed', declined: 'Declined', withdrawn: 'Withdrawn' };
  var STATUS_ORDER = ['submitted', 'in_review', 'offer_sent', 'disbursed', 'declined', 'withdrawn'];
  var ROLE_LABEL = { admin: 'Administrator', employee: 'Employee', user: 'Customer' };
  var ACTION_LABEL = {
    'role.changed': 'changed the role of',
    'application.status_changed': 'updated an application for',
    'user.password_set': 'set a new password for',
    'user.password_reset_sent': 'sent a password reset link to',
    'user.email_confirmed': 'confirmed the email of',
    'user.email_changed': 'changed the email of',
    'user.suspended': 'suspended',
    'user.unsuspended': 'restored',
    'user.sessions_revoked': 'logged out everywhere:',
    'user.created': 'created an account for',
    'user.invited': 'invited',
    'user.deleted': 'deleted'
  };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function say(node, kind, text) { node.className = 'notice notice-' + kind; node.textContent = text; }
  function clear(node) { node.className = 'notice'; node.textContent = ''; }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; btn.setAttribute('aria-busy', String(on)); }
  var nf = new Intl.NumberFormat('en-KE');
  function num(n) { return nf.format(Number(n) || 0); }
  function ksh(n) { return 'KSh ' + num(n); }
  function kshShort(n) { n = Number(n) || 0; return n >= 1e6 ? 'KSh ' + parseFloat((n / 1e6).toFixed(1)) + 'M' : n >= 1e3 ? 'KSh ' + Math.round(n / 1e3) + 'K' : 'KSh ' + n; }
  function date(iso) { return iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
  function dateTime(iso) { return iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function ago(iso) {
    if (!iso) return 'Never';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
    return date(iso);
  }
  function bytes(n) { n = Number(n) || 0; var u = ['B', 'KB', 'MB', 'GB']; var i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; }
  function err(e) {
    var m = e && (e.message || e.error_description || e.error) || String(e);
    if (/cannot remove the last administrator|always stays an administrator/i.test(m)) return 'The site owner always stays an administrator.';
    if (/Only the site owner can be an administrator/i.test(m)) return 'Only the site owner can be an administrator.';
    if (/Not allowed|Only administrators|permission denied/i.test(m)) return 'Your role doesn’t allow this.';
    return A.friendlyError(e) === 'Something went wrong. Please try again.' && m ? m : A.friendlyError(e);
  }
  function isSuspended(u) { return u.banned_until && new Date(u.banned_until) > new Date(); }

  /* Call the admin-users Edge Function and surface its error message. */
  function adminAction(body) {
    return sb.functions.invoke('admin-users', { body: body }).then(function (res) {
      if (!res.error) return res.data;
      var ctx = res.error.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().then(function (j) { throw new Error(j && j.error || res.error.message); }, function () { throw res.error; });
      }
      throw res.error;
    });
  }

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var loaded = {};
  function visibleTabs() { return tabs.filter(function (t) { return t.offsetParent !== null; }); }
  function showTab(name, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    if (history.replaceState) history.replaceState(null, '', '#' + name);
    if (!loaded[name]) { loaded[name] = true; LOADERS[name](); }
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
    t.addEventListener('keydown', function (e) {
      var vis = visibleTabs(), i = vis.indexOf(t);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var n = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length];
        showTab(n.getAttribute('data-tab'), true);
      }
    });
  });

  /* ---------- tooltip (charts) ---------- */
  var tip = $('tooltip');
  function showTip(target, text) {
    tip.textContent = text; tip.hidden = false;
    var r = target.getBoundingClientRect(), t = tip.getBoundingClientRect();
    var left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, r.top - t.height - 8) + window.scrollY + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function hoverable(node, text) {
    node.tabIndex = 0;
    node.setAttribute('aria-label', text);
    node.addEventListener('mouseenter', function () { showTip(node, text); });
    node.addEventListener('focus', function () { showTip(node, text); });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('blur', hideTip);
  }

  /* ---------- overview ---------- */
  function kpi(label, value, sub) {
    var card = el('div', 'kpi blueprint');
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) { card.appendChild(el('i', 'corner ' + c)); });
    card.appendChild(el('span', 'kpi-label', label));
    card.appendChild(el('span', 'kpi-value', value));
    if (sub) card.appendChild(el('span', 'kpi-sub', sub));
    return card;
  }

  function tableView(rows, headers) {
    var d = el('details', 'table-view');
    d.appendChild(el('summary', null, 'Show as table'));
    var t = el('table', 'table');
    var tr = el('tr'); headers.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    var th = el('thead'); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    rows.forEach(function (r) { var row = el('tr'); r.forEach(function (c) { row.appendChild(el('td', null, c)); }); tb.appendChild(row); });
    t.appendChild(tb); d.appendChild(t);
    return d;
  }

  function renderSignups(series) {
    var box = $('chart-signups'); box.textContent = '';
    var max = Math.max.apply(null, series.map(function (d) { return d.n; }).concat([1]));
    var total = series.reduce(function (s, d) { return s + d.n; }, 0);
    box.setAttribute('aria-label', 'Column chart of new sign-ups per day for the last 14 days. ' + total + ' in total.');
    var plot = el('div', 'col-plot');
    var maxShown = false;
    series.forEach(function (d) {
      var day = new Date(d.day + 'T00:00:00');
      var label = day.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
      var col = el('div', 'col');
      var bar = el('div', 'col-bar');
      bar.style.height = d.n ? Math.max(4, d.n / max * 100) + '%' : '0';
      if (d.n === max && d.n > 0 && !maxShown) { col.appendChild(el('span', 'col-val', String(d.n))); maxShown = true; }
      col.appendChild(bar);
      hoverable(col, label + ': ' + d.n + ' sign-up' + (d.n === 1 ? '' : 's'));
      plot.appendChild(col);
    });
    box.appendChild(plot);
    var axis = el('div', 'col-axis');
    var first = new Date(series[0].day + 'T00:00:00');
    axis.appendChild(el('span', null, first.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })));
    axis.appendChild(el('span', null, 'Today'));
    box.appendChild(axis);
    box.appendChild(tableView(series.map(function (d) { return [d.day, String(d.n)]; }), ['Day', 'Sign-ups']));
  }

  function renderStatusBars(byStatus) {
    var box = $('chart-status'); box.textContent = '';
    var max = Math.max.apply(null, STATUS_ORDER.map(function (s) { return byStatus[s] || 0; }).concat([1]));
    STATUS_ORDER.forEach(function (s) {
      var n = byStatus[s] || 0;
      var row = el('div', 'bar-row');
      row.appendChild(el('span', 'bar-label', STATUS[s]));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = n ? Math.max(2, n / max * 100) + '%' : '0';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'bar-value', num(n)));
      hoverable(row, STATUS[s] + ': ' + n + ' application' + (n === 1 ? '' : 's'));
      box.appendChild(row);
    });
    box.appendChild(tableView(STATUS_ORDER.map(function (s) { return [STATUS[s], String(byStatus[s] || 0)]; }), ['Status', 'Applications']));
  }

  function loadOverview() {
    if (isAdmin) runHealth();
    return sb.rpc('staff_stats').then(function (res) {
      if (res.error) { say($('notice'), 'err', err(res.error)); return; }
      var s = res.data;
      var k = $('kpis'); k.textContent = '';
      k.appendChild(kpi('Users', num(s.users), num(s.new_users_7d) + ' new this week'));
      k.appendChild(kpi('Active today', num(s.active_24h), 'logged in, last 24 h'));
      k.appendChild(kpi('Profiles complete', num(s.profiles_complete), s.users ? Math.round(s.profiles_complete / s.users * 100) + '% of users' : ''));
      k.appendChild(kpi('Applications', num(s.applications), num(s.applications_7d) + ' this week'));
      k.appendChild(kpi('Awaiting review', num((s.applications_by_status || {}).submitted || 0), 'status: submitted'));
      k.appendChild(kpi('Amount requested', kshShort(s.amount_requested_ksh), 'all applications'));
      renderSignups(s.signups_by_day || []);
      renderStatusBars(s.applications_by_status || {});
      $('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
    });
  }

  /* ---------- health checks (admin) ---------- */
  var CHECKS = [
    { key: 'site', name: 'Website', what: 'This site on Netlify' },
    { key: 'db', name: 'Database', what: 'Postgres, via the Supabase API' },
    { key: 'auth', name: 'Log-in service', what: 'Supabase Auth' },
    { key: 'fn', name: 'Admin functions', what: 'admin-users Edge Function' }
  ];
  function timed(p) {
    var t0 = performance.now();
    return p.then(function (v) { return { ok: true, ms: Math.round(performance.now() - t0), v: v }; },
      function (e) { return { ok: false, ms: Math.round(performance.now() - t0), e: e }; });
  }
  function healthTile(c, r) {
    var tile = el('div', 'health blueprint');
    ['tl', 'tr', 'bl', 'br'].forEach(function (x) { tile.appendChild(el('i', 'corner ' + x)); });
    var state = !r ? 'checking' : !r.ok ? 'down' : r.ms > 1500 ? 'slow' : 'ok';
    var label = { checking: 'Checking…', ok: 'Operational', slow: 'Slow', down: 'Down' }[state];
    var icon = { checking: '…', ok: '✓', slow: '!', down: '✕' }[state];
    tile.classList.add('health-' + state);
    var top = el('div', 'health-top');
    top.appendChild(el('span', 'health-name', c.name));
    var badge = el('span', 'health-badge');
    badge.appendChild(el('span', 'health-icon', icon));
    badge.appendChild(document.createTextNode(label));
    top.appendChild(badge);
    tile.appendChild(top);
    tile.appendChild(el('span', 'health-what', c.what));
    var detail = r ? (r.ok ? r.ms + ' ms' : (r.msg || 'No response')) : '';
    tile.appendChild(el('span', 'health-ms', detail));
    return tile;
  }
  function renderHealth(results) {
    var box = $('health'); box.textContent = '';
    CHECKS.forEach(function (c) { box.appendChild(healthTile(c, results[c.key])); });
  }
  var healthBusy = false;
  function runHealth() {
    if (healthBusy) return; healthBusy = true;
    var results = {};
    renderHealth(results);
    var checks = {
      site: timed(fetch('/', { method: 'HEAD', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r; })),
      db: timed(sb.rpc('admin_system_status').then(function (r) { if (r.error) throw r.error; state.sys = r.data; return r.data; })),
      auth: timed(fetch(cfg.url + '/auth/v1/health', { headers: { apikey: cfg.publishableKey }, cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r; })),
      fn: timed(adminAction({ action: 'ping' }))
    };
    Object.keys(checks).forEach(function (k) {
      checks[k].then(function (r) {
        if (!r.ok) r.msg = (r.e && (r.e.message || String(r.e)) || 'Error').slice(0, 80);
        results[k] = r; renderHealth(results);
      });
    });
    Promise.all(Object.keys(checks).map(function (k) { return checks[k]; })).then(function () {
      healthBusy = false;
      if (loaded.system) renderSystem();
    });
  }
  setInterval(function () {
    if (isAdmin && $('auto-refresh').checked && !$('panel-overview').hidden && !document.hidden) runHealth();
  }, 60000);

  /* ---------- users ---------- */
  function roleTag(r) { return el('span', 'role-tag role-' + r, ROLE_LABEL[r] || r); }
  function statusTag(u) {
    if (isSuspended(u)) return el('span', 'status status-declined', 'Suspended');
    if (!u.email_confirmed_at) return el('span', 'status status-in_review', 'Unconfirmed');
    return el('span', 'status status-disbursed', 'Active');
  }
  function loadUsers() {
    var tbody = $('users-table').querySelector('tbody');
    tbody.textContent = '';
    var tr = el('tr'); var td = el('td', 'loading', 'Loading…'); td.colSpan = 7; tr.appendChild(td); tbody.appendChild(tr);
    return sb.rpc('admin_list_users', {
      p_search: $('user-search').value.trim() || null,
      p_role: $('user-role-filter').value || null,
      p_limit: PAGE, p_offset: state.usersPage * PAGE
    }).then(function (res) {
      tbody.textContent = '';
      if (res.error) { say($('notice'), 'err', err(res.error)); return; }
      var rows = res.data || [];
      state.users = rows;
      state.usersTotal = rows.length ? Number(rows[0].total_count) : 0;
      if (!rows.length) { var e1 = el('tr'); var c1 = el('td', 'empty-cell', 'No users match.'); c1.colSpan = 7; e1.appendChild(c1); tbody.appendChild(e1); }
      rows.forEach(function (u) {
        var row = el('tr', 'clickable');
        row.tabIndex = 0;
        row.setAttribute('aria-label', 'Open ' + (u.full_name || u.email));
        var who = el('td');
        who.appendChild(el('span', 'cell-main', u.full_name || '—'));
        who.appendChild(el('span', 'cell-sub', u.email));
        row.appendChild(who);
        var r1 = el('td'); r1.appendChild(roleTag(u.role)); row.appendChild(r1);
        var s1 = el('td'); s1.appendChild(statusTag(u)); row.appendChild(s1);
        row.appendChild(el('td', null, u.profile_completed_at ? 'Complete' : (u.business_name || u.phone ? 'Started' : 'Not started')));
        row.appendChild(el('td', 'num', num(u.applications)));
        row.appendChild(el('td', null, date(u.created_at)));
        row.appendChild(el('td', null, ago(u.last_sign_in_at)));
        row.addEventListener('click', function () { openUser(u); });
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUser(u); } });
        tbody.appendChild(row);
      });
      pager('users', state.usersPage, state.usersTotal);
    });
  }
  function pager(prefix, page, total) {
    var pages = Math.max(1, Math.ceil(total / PAGE));
    $(prefix + '-page').textContent = total ? 'Page ' + (page + 1) + ' of ' + pages + ' · ' + num(total) + ' total' : '';
    $(prefix + '-prev').disabled = page <= 0;
    $(prefix + '-next').disabled = page + 1 >= pages;
  }
  var searchTimer;
  $('user-search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { state.usersPage = 0; loadUsers(); }, 300); });
  $('user-role-filter').addEventListener('change', function () { state.usersPage = 0; loadUsers(); });
  $('users-prev').addEventListener('click', function () { state.usersPage--; loadUsers(); });
  $('users-next').addEventListener('click', function () { state.usersPage++; loadUsers(); });

  /* ---------- dialogs ---------- */
  var openDialogEl = null, returnFocus = null;
  function openDialog(d) {
    returnFocus = document.activeElement;
    d.hidden = false; openDialogEl = d;
    document.body.classList.add('dialog-open');
    var f = d.querySelector('[data-close]'); if (f) f.focus();
  }
  function closeDialog() {
    if (!openDialogEl) return;
    openDialogEl.hidden = true; openDialogEl = null;
    document.body.classList.remove('dialog-open');
    if (returnFocus) returnFocus.focus();
  }
  document.querySelectorAll('.dialog-backdrop').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) closeDialog(); });
    d.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeDialog); });
  });
  document.addEventListener('keydown', function (e) {
    if (!openDialogEl) return;
    if (e.key === 'Escape') closeDialog();
    if (e.key === 'Tab') {
      var f = Array.prototype.filter.call(openDialogEl.querySelectorAll('button:not([disabled]),input,select,textarea,a[href]'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ---------- user details ---------- */
  function fact(dl, k, v) { if (v === null || v === undefined || v === '') return; dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
  function openUser(u) {
    state.current = u;
    clear($('ud-notice'));
    $('ud-name').textContent = u.full_name || u.email;
    $('ud-email').textContent = u.email;
    var tags = $('ud-tags'); tags.textContent = ''; tags.appendChild(roleTag(u.role)); tags.appendChild(document.createTextNode(' ')); tags.appendChild(statusTag(u));
    $('ud-initials').textContent = P.initials(u.full_name || u.email); $('ud-initials').hidden = false;
    $('ud-img').hidden = true;
    $('ud-role').value = u.role;
    // The administrator role belongs to the site owner only; it can't be given or taken away here.
    var ownerRow = u.role === 'admin';
    $('ud-role').disabled = ownerRow; $('ud-role-save').disabled = ownerRow;
    $('ud-role-hint').textContent = ownerRow
      ? 'Site owner. This account is always the administrator, and no one else can be.'
      : 'Employees see all customers and applications and can change application status. Only the site owner is an administrator.';
    $('ud-confirm').hidden = !!u.email_confirmed_at;
    $('ud-suspend').hidden = isSuspended(u); $('ud-unsuspend').hidden = !isSuspended(u);
    $('ud-password').value = ''; $('ud-new-email').value = ''; $('ud-delete-confirm').value = '';
    var self = me && u.id === me.id;
    $('ud-suspend').disabled = self; $('ud-delete-form').querySelector('button').disabled = self;
    var dl = $('ud-facts'); dl.textContent = '';
    fact(dl, 'Joined', date(u.created_at)); fact(dl, 'Last log-in', ago(u.last_sign_in_at));
    fact(dl, 'Email confirmed', u.email_confirmed_at ? date(u.email_confirmed_at) : 'Not yet');
    openDialog($('user-dialog'));
    P.load(u.id).then(function (p) {
      if (!p) return;
      fact(dl, 'Phone', p.phone); fact(dl, 'Business', p.business_name); fact(dl, 'Type', p.business_type);
      fact(dl, 'Sector', p.sector); fact(dl, 'Location', [p.town, p.city].filter(Boolean).join(', '));
      fact(dl, 'Registration no.', p.registration_number); fact(dl, 'Trading', p.years_trading);
      fact(dl, 'Monthly revenue', p.monthly_revenue ? 'KSh ' + p.monthly_revenue : null); fact(dl, 'Employees', p.employees);
      fact(dl, 'Language', p.preferred_language); fact(dl, 'About', p.business_description);
      fact(dl, 'Profile', p.profile_completed_at ? 'Complete' : P.completion(p).pct + '% complete');
      if (p.avatar_path) P.avatarUrl(p.avatar_path).then(function (url) {
        if (url && state.current === u) { $('ud-img').src = url; $('ud-img').alt = 'Photo of ' + (p.full_name || u.email); $('ud-img').hidden = false; $('ud-initials').hidden = true; }
      });
    }).catch(function () {});
    var box = $('ud-apps'); box.textContent = ''; box.appendChild(el('p', 'loading', 'Loading…'));
    sb.from('loan_applications').select('id, amount_ksh, term_months, location, status, created_at').eq('user_id', u.id).order('created_at', { ascending: false })
      .then(function (res) {
        box.textContent = '';
        if (res.error) { box.appendChild(el('p', 'hint', err(res.error))); return; }
        if (!res.data.length) { box.appendChild(el('p', 'hint', 'No applications yet.')); return; }
        var ul = el('ul', 'mini-list');
        res.data.forEach(function (a) {
          var li = el('li');
          li.appendChild(el('span', null, date(a.created_at) + ' · ' + ksh(a.amount_ksh) + ' · ' + a.term_months + ' mo'));
          li.appendChild(el('span', 'status status-' + a.status, STATUS[a.status]));
          ul.appendChild(li);
        });
        box.appendChild(ul);
      });
  }

  function afterUserChange(msg) {
    say($('ud-notice'), 'ok', msg);
    loadUsers().then(function () {
      var fresh = state.users.filter(function (x) { return state.current && x.id === state.current.id; })[0];
      if (fresh) {
        state.current = fresh;
        var tags = $('ud-tags'); tags.textContent = ''; tags.appendChild(roleTag(fresh.role)); tags.appendChild(document.createTextNode(' ')); tags.appendChild(statusTag(fresh));
        $('ud-suspend').hidden = isSuspended(fresh); $('ud-unsuspend').hidden = !isSuspended(fresh);
        $('ud-confirm').hidden = !!fresh.email_confirmed_at;
        $('ud-email').textContent = fresh.email;
      }
    });
    if (loaded.activity) loadActivity();
  }

  $('ud-role-save').addEventListener('click', function () {
    var u = state.current, btn = this, newRole = $('ud-role').value;
    if (newRole === u.role) { say($('ud-notice'), 'info', 'That’s already their role.'); return; }
    if (u.id === me.id && newRole !== 'admin' && !confirm('Remove your own administrator access? You’ll lose access to this console.')) return;
    busy(btn, true);
    sb.rpc('admin_set_role', { p_user: u.id, p_role: newRole }).then(function (res) {
      busy(btn, false);
      if (res.error) { say($('ud-notice'), 'err', err(res.error)); $('ud-role').value = u.role; return; }
      afterUserChange('Role changed to ' + ROLE_LABEL[newRole] + '.');
      if (u.id === me.id && newRole !== 'admin') setTimeout(function () { location.reload(); }, 800);
    });
  });

  var CONFIRM = {
    suspend: 'Suspend this account? They’ll be logged out everywhere and can’t log in until restored.',
    sign_out_everywhere: 'Log this user out on every device?'
  };
  var DONE = {
    send_password_reset: 'Password reset link sent.',
    confirm_email: 'Email marked as confirmed.',
    sign_out_everywhere: 'Logged out everywhere.',
    suspend: 'Account suspended.',
    unsuspend: 'Account restored.'
  };
  document.querySelectorAll('#user-dialog [data-action]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var action = btn.getAttribute('data-action'), u = state.current;
      if (CONFIRM[action] && !confirm(CONFIRM[action])) return;
      busy(btn, true); clear($('ud-notice'));
      adminAction({ action: action, user_id: u.id, redirect_to: A.siteUrl('/reset-password.html') }).then(function (r) {
        busy(btn, false);
        var extra = r && typeof r.sessions_ended === 'number' ? ' (' + r.sessions_ended + ' session' + (r.sessions_ended === 1 ? '' : 's') + ' ended)' : '';
        afterUserChange(DONE[action] + extra);
      }, function (e) { busy(btn, false); say($('ud-notice'), 'err', err(e)); });
    });
  });

  $('ud-password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('ud-password').value, btn = this.querySelector('button');
    if (!(pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw))) { say($('ud-notice'), 'err', 'Use at least 8 characters with letters and numbers.'); $('ud-password').focus(); return; }
    busy(btn, true);
    adminAction({ action: 'set_password', user_id: state.current.id, password: pw }).then(function () {
      busy(btn, false); $('ud-password').value = '';
      afterUserChange('Password changed. Share it with them privately.');
    }, function (er) { busy(btn, false); say($('ud-notice'), 'err', err(er)); });
  });

  $('ud-email-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('ud-new-email').value.trim(), btn = this.querySelector('button');
    if (!A.validEmail(v)) { say($('ud-notice'), 'err', 'Enter a valid email address.'); return; }
    busy(btn, true);
    adminAction({ action: 'update_email', user_id: state.current.id, email: v }).then(function () {
      busy(btn, false); $('ud-new-email').value = '';
      afterUserChange('Email changed to ' + v.toLowerCase() + '.');
    }, function (er) { busy(btn, false); say($('ud-notice'), 'err', err(er)); });
  });

  $('ud-delete-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = state.current, typed = $('ud-delete-confirm').value.trim(), btn = this.querySelector('button');
    if (typed.toLowerCase() !== (u.email || '').toLowerCase()) { say($('ud-notice'), 'err', 'Type ' + u.email + ' exactly to confirm.'); $('ud-delete-confirm').focus(); return; }
    if (!confirm('Permanently delete ' + u.email + ' and all their applications?')) return;
    busy(btn, true);
    adminAction({ action: 'delete_user', user_id: u.id, confirm_email: typed }).then(function () {
      busy(btn, false); closeDialog();
      say($('notice'), 'ok', u.email + ' was deleted.');
      loadUsers(); if (loaded.activity) loadActivity();
    }, function (er) { busy(btn, false); say($('ud-notice'), 'err', err(er)); });
  });

  /* ---------- add user ---------- */
  function addMode() { return document.querySelector('input[name="add-mode"]:checked').value; }
  document.querySelectorAll('input[name="add-mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var create = addMode() === 'create';
      $('add-pw-field').hidden = !create;
      $('add-submit').lastChild.textContent = create ? 'Create account' : 'Send invite';
    });
  });
  $('add-user-btn').addEventListener('click', function () {
    clear($('add-notice')); $('add-form').reset(); $('add-role').value = 'employee'; $('add-pw-field').hidden = true;
    $('add-submit').lastChild.textContent = 'Send invite';
    openDialog($('add-dialog'));
  });
  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('add-email'), pw = $('add-password'), create = addMode() === 'create';
    var okEmail = A.validEmail(email.value.trim());
    email.closest('.auth-field').classList.toggle('invalid', !okEmail);
    var okPw = !create || (pw.value.length >= 8 && /[A-Za-z]/.test(pw.value) && /\d/.test(pw.value));
    pw.closest('.auth-field').classList.toggle('invalid', !okPw);
    if (!okEmail || !okPw) return;
    var btn = $('add-submit'); busy(btn, true);
    adminAction({
      action: create ? 'create_user' : 'invite_user',
      email: email.value.trim(), full_name: $('add-name').value.trim(), role: $('add-role').value,
      password: create ? pw.value : undefined,
      redirect_to: A.siteUrl('/reset-password.html?invited=1')
    }).then(function () {
      busy(btn, false);
      say($('add-notice'), 'ok', create ? 'Account created. Share the password with them privately.' : 'Invite sent to ' + email.value.trim() + '.');
      state.usersPage = 0; loadUsers(); if (loaded.activity) loadActivity();
      $('add-form').reset(); $('add-pw-field').hidden = true;
    }, function (er) { busy(btn, false); say($('add-notice'), 'err', err(er)); });
  });

  /* ---------- applications ---------- */
  function cleanSearch(q) { return q.replace(/[,()*%\\]/g, ' ').trim(); }
  function loadApps() {
    var tbody = $('apps-table').querySelector('tbody');
    tbody.textContent = '';
    var lr = el('tr'); var lc = el('td', 'loading', 'Loading…'); lc.colSpan = 8; lr.appendChild(lc); tbody.appendChild(lr);
    var q = sb.from('loan_applications')
      .select('id, user_id, full_name, business_name, phone, amount_ksh, term_months, location, status, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(state.appsPage * PAGE, state.appsPage * PAGE + PAGE - 1);
    var st = $('app-status-filter').value; if (st) q = q.eq('status', st);
    var s = cleanSearch($('app-search').value);
    if (s) q = q.or('full_name.ilike.*' + s + '*,business_name.ilike.*' + s + '*,phone.ilike.*' + s + '*');
    return q.then(function (res) {
      tbody.textContent = '';
      if (res.error) { say($('notice'), 'err', err(res.error)); return; }
      state.appsTotal = res.count || 0;
      if (!res.data.length) { var er = el('tr'); var ec = el('td', 'empty-cell', 'No applications match.'); ec.colSpan = 8; er.appendChild(ec); tbody.appendChild(er); }
      res.data.forEach(function (a) {
        var row = el('tr');
        row.appendChild(el('td', null, date(a.created_at)));
        var who = el('td'); who.appendChild(el('span', 'cell-main', a.full_name)); who.appendChild(el('span', 'cell-sub', a.business_name)); row.appendChild(who);
        row.appendChild(el('td', null, a.phone));
        row.appendChild(el('td', 'num', ksh(a.amount_ksh)));
        row.appendChild(el('td', null, a.term_months + ' mo'));
        row.appendChild(el('td', null, a.location || '—'));
        var sc = el('td');
        var sel = el('select', 'input select status-select status-' + a.status);
        sel.setAttribute('aria-label', 'Status for ' + a.full_name);
        STATUS_ORDER.forEach(function (k) { var o = el('option', null, STATUS[k]); o.value = k; if (k === a.status) o.selected = true; sel.appendChild(o); });
        sel.addEventListener('change', function () {
          var prev = a.status, next = sel.value;
          sel.disabled = true;
          sb.from('loan_applications').update({ status: next }).eq('id', a.id).select('id').then(function (r) {
            sel.disabled = false;
            if (r.error || !r.data || !r.data.length) { sel.value = prev; say($('notice'), 'err', r.error ? err(r.error) : 'Not saved.'); return; }
            a.status = next; sel.className = 'input select status-select status-' + next;
            say($('notice'), 'ok', a.full_name + ': ' + STATUS[prev] + ' → ' + STATUS[next] + '.');
            if (loaded.overview) loadOverview();
          });
        });
        sc.appendChild(sel); row.appendChild(sc);
        var nc = el('td');
        var nb = el('button', 'btn btn-ghost', 'Notes'); nb.type = 'button';
        nb.addEventListener('click', function () { openNotes(a); });
        nc.appendChild(nb); row.appendChild(nc);
        tbody.appendChild(row);
      });
      pager('apps', state.appsPage, state.appsTotal);
    });
  }
  var appTimer;
  $('app-search').addEventListener('input', function () { clearTimeout(appTimer); appTimer = setTimeout(function () { state.appsPage = 0; loadApps(); }, 300); });
  $('app-status-filter').addEventListener('change', function () { state.appsPage = 0; loadApps(); });
  $('apps-prev').addEventListener('click', function () { state.appsPage--; loadApps(); });
  $('apps-next').addEventListener('click', function () { state.appsPage++; loadApps(); });

  /* ---------- notes ---------- */
  function openNotes(a) {
    state.notesApp = a;
    clear($('notes-notice')); $('notes-body').value = '';
    $('notes-sub').textContent = a.full_name + ' · ' + ksh(a.amount_ksh) + ' · ' + date(a.created_at);
    openDialog($('notes-dialog'));
    loadNotes();
  }
  function loadNotes() {
    var a = state.notesApp, list = $('notes-list');
    list.textContent = ''; list.appendChild(el('li', 'loading', 'Loading…'));
    sb.from('application_notes').select('id, body, created_at, author_id').eq('application_id', a.id).order('created_at', { ascending: false }).then(function (res) {
      list.textContent = '';
      if (res.error) { list.appendChild(el('li', 'hint', err(res.error))); return; }
      if (!res.data.length) { list.appendChild(el('li', 'hint', 'No notes yet.')); return; }
      var ids = res.data.map(function (n) { return n.author_id; }).filter(Boolean);
      sb.from('profiles').select('id, full_name, email').in('id', ids).then(function (pr) {
        var names = {}; (pr.data || []).forEach(function (p) { names[p.id] = p.full_name || p.email; });
        res.data.forEach(function (n) {
          var li = el('li');
          li.appendChild(el('p', 'note-body', n.body));
          li.appendChild(el('span', 'note-meta', (names[n.author_id] || 'Staff') + ' · ' + dateTime(n.created_at)));
          list.appendChild(li);
        });
      });
    });
  }
  $('notes-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = $('notes-body').value.trim(), btn = this.querySelector('button');
    if (!body) { $('notes-body').focus(); return; }
    busy(btn, true);
    sb.from('application_notes').insert({ application_id: state.notesApp.id, body: body }).then(function (res) {
      busy(btn, false);
      if (res.error) { say($('notes-notice'), 'err', err(res.error)); return; }
      $('notes-body').value = ''; clear($('notes-notice'));
      loadNotes();
    });
  });

  /* ---------- activity (admin) ---------- */
  function loadActivity() {
    var list = $('activity'); list.textContent = ''; list.appendChild(el('li', 'loading', 'Loading…'));
    var q = sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(150);
    var f = $('activity-filter').value;
    if (f.indexOf(',') !== -1) q = q.in('action', f.split(','));
    else if (f) q = q.like('action', f + '%');
    return q.then(function (res) {
      list.textContent = '';
      if (res.error) { list.appendChild(el('li', 'hint', err(res.error))); return; }
      if (!res.data.length) { list.appendChild(el('li', 'hint', 'No activity yet.')); return; }
      res.data.forEach(function (r) {
        var li = el('li');
        var line = el('p', 'act-line');
        line.appendChild(el('strong', null, r.actor_email || 'System'));
        line.appendChild(document.createTextNode(' ' + (ACTION_LABEL[r.action] || r.action) + ' '));
        line.appendChild(el('strong', null, r.target_email || (r.details && r.details.email) || '—'));
        var d = r.details || {};
        var extra = '';
        if (r.action === 'role.changed') extra = ROLE_LABEL[d.from] + ' → ' + ROLE_LABEL[d.to];
        else if (r.action === 'application.status_changed') extra = (STATUS[d.from] || d.from) + ' → ' + (STATUS[d.to] || d.to) + (d.amount_ksh ? ' · ' + ksh(d.amount_ksh) : '');
        else if (r.action === 'user.email_changed') extra = d.from + ' → ' + d.to;
        else if (typeof d.sessions_ended === 'number') extra = d.sessions_ended + ' session(s) ended';
        else if (d.role) extra = 'as ' + (ROLE_LABEL[d.role] || d.role);
        else if (d.via) extra = d.via;
        li.appendChild(line);
        if (extra) li.appendChild(el('span', 'act-extra', extra));
        var t = el('time', 'act-time', dateTime(r.created_at)); t.dateTime = r.created_at;
        li.appendChild(t);
        list.appendChild(li);
      });
    });
  }
  $('activity-filter').addEventListener('change', loadActivity);

  /* ---------- system (admin) ---------- */
  function sysCard(title, rows, note) {
    var c = el('section', 'blueprint acct-section sys-card');
    ['tl', 'tr', 'bl', 'br'].forEach(function (x) { c.appendChild(el('i', 'corner ' + x)); });
    c.appendChild(el('h2', null, title));
    var dl = el('dl', 'pc-facts');
    rows.forEach(function (r) { fact(dl, r[0], r[1]); });
    c.appendChild(dl);
    if (note) c.appendChild(note);
    return c;
  }
  function uptime(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600);
    return (d ? d + ' d ' : '') + h + ' h';
  }
  function renderSystem() {
    var s = state.sys, box = $('system');
    box.textContent = '';
    if (!s) { box.appendChild(el('p', 'loading', 'Loading…')); return; }
    var ref = (cfg.url.match(/https:\/\/([^.]+)/) || [])[1];
    box.appendChild(sysCard('Database', [
      ['Status', 'Connected'], ['Engine', s.postgres], ['Running for', uptime(s.started_at)],
      ['Size', bytes(s.db_size_bytes)], ['Connections', s.connections + ' of ' + s.max_connections],
      ['Checked', dateTime(s.checked_at)]
    ]));
    var u = s.users || {};
    box.appendChild(sysCard('Accounts', [
      ['Total', num(u.total)], ['Email confirmed', num(u.confirmed)], ['Unconfirmed', num(u.unconfirmed)],
      ['Suspended', num(u.suspended)], ['Active, last 7 days', num(u.active_7d)], ['Open sessions', num(u.open_sessions)],
      ['Administrators', num(u.admins)], ['Employees', num(u.employees)]
    ]));
    box.appendChild(sysCard('Storage', [
      ['Profile photos', num((s.storage || {}).avatars)], ['Photo storage used', bytes((s.storage || {}).avatar_bytes)]
    ]));
    var tcard = el('section', 'blueprint acct-section sys-card sys-wide');
    ['tl', 'tr', 'bl', 'br'].forEach(function (x) { tcard.appendChild(el('i', 'corner ' + x)); });
    tcard.appendChild(el('h2', null, 'Tables'));
    var wrap = el('div', 'table-wrap'); var t = el('table', 'table');
    var hr = el('tr'); ['Table', 'Rows', 'Size', 'Row-level security'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    (s.tables || []).forEach(function (r) {
      var row = el('tr');
      row.appendChild(el('td', null, r.name));
      row.appendChild(el('td', 'num', num(r.exact_rows !== null && r.exact_rows !== undefined ? r.exact_rows : r.rows)));
      row.appendChild(el('td', 'num', bytes(r.size_bytes)));
      var rc = el('td'); rc.appendChild(el('span', 'status ' + (r.rls ? 'status-disbursed' : 'status-declined'), r.rls ? '✓ On' : '✕ Off')); row.appendChild(rc);
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); tcard.appendChild(wrap);
    box.appendChild(tcard);
    var mcard = el('section', 'blueprint acct-section sys-card');
    ['tl', 'tr', 'bl', 'br'].forEach(function (x) { mcard.appendChild(el('i', 'corner ' + x)); });
    mcard.appendChild(el('h2', null, 'Database migrations'));
    var ol = el('ol', 'mini-list');
    (s.migrations || []).forEach(function (m) { var li = el('li'); li.appendChild(el('span', null, m.name)); li.appendChild(el('span', 'cell-sub', m.version)); ol.appendChild(li); });
    mcard.appendChild(ol);
    box.appendChild(mcard);
    var lcard = el('section', 'blueprint acct-section sys-card');
    ['tl', 'tr', 'bl', 'br'].forEach(function (x) { lcard.appendChild(el('i', 'corner ' + x)); });
    lcard.appendChild(el('h2', null, 'Supabase dashboard'));
    lcard.appendChild(el('p', 'sub', 'Detailed logs, backups and settings live in Supabase.'));
    var links = el('ul', 'link-list');
    [['Logs explorer', 'logs/explorer'], ['Auth settings', 'auth/providers'], ['Database tables', 'editor'],
     ['Edge Functions', 'functions'], ['Security advisor', 'advisors/security'], ['Backups', 'database/backups/scheduled']].forEach(function (l) {
      var li = el('li'); var a = el('a', null, l[0]);
      a.href = 'https://supabase.com/dashboard/project/' + ref + '/' + l[1]; a.target = '_blank'; a.rel = 'noopener';
      li.appendChild(a); links.appendChild(li);
    });
    lcard.appendChild(links);
    box.appendChild(lcard);
  }
  function loadSystem() {
    renderSystem();
    return sb.rpc('admin_system_status').then(function (res) {
      if (res.error) { say($('notice'), 'err', err(res.error)); return; }
      state.sys = res.data; renderSystem();
    });
  }

  var LOADERS = { overview: loadOverview, users: loadUsers, apps: loadApps, activity: loadActivity, system: loadSystem };

  // Links like /admin.html#apps switch tabs even when the console is already open.
  window.addEventListener('hashchange', function () {
    if (!me || role === 'user') return;
    var want = location.hash.replace('#', '');
    var t = tabs.filter(function (x) { return x.getAttribute('data-tab') === want && x.offsetParent !== null; })[0];
    if (t) showTab(want);
  });

  $('refresh-btn').addEventListener('click', function () {
    Object.keys(loaded).forEach(function (k) { if (loaded[k]) LOADERS[k](); });
  });

  /* ---------- log out ---------- */
  $('signout-btn').addEventListener('click', function () {
    leaving = true;
    sb.auth.signOut().then(function () { location.replace('/login.html?reason=signed-out'); });
  });

  /* ---------- start ---------- */
  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (!session) { leaving = true; location.replace('/login.html?reason=session&next=' + encodeURIComponent('/admin.html')); return; }
    me = session.user;
    return sb.rpc('my_role').then(function (r) {
      role = (r && r.data) || 'user';
      $('loading').hidden = true;
      if (role !== 'admin' && role !== 'employee') {
        $('console').hidden = true; $('denied').hidden = false;
        document.body.classList.remove('auth-page-loading');
        return;
      }
      isAdmin = role === 'admin';
      document.body.classList.toggle('is-admin', isAdmin);
      $('role-eyebrow').textContent = ROLE_LABEL[role];
      $('who').textContent = 'Logged in as ' + me.email;
      document.body.classList.remove('auth-page-loading');
      var want = location.hash.replace('#', '');
      var tab = tabs.filter(function (t) { return t.getAttribute('data-tab') === want && t.offsetParent !== null; })[0];
      showTab(tab ? want : 'overview');
    });
  }).catch(function (e) { $('loading').textContent = err(e); });

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT' && !leaving) { leaving = true; location.replace('/login.html?reason=session&next=' + encodeURIComponent('/admin.html')); }
  });
})();
