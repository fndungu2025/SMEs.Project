/* Imara Capital — borrower profile: option lists, completeness and photo helpers.
   The option lists must match the CHECK constraints in
   supabase/migrations/20261006200000_user_created_profiles.sql. */
(function () {
  'use strict';

  var A = window.ImaraAuth;
  var sb = A.client;
  var BUCKET = 'avatars';

  var OPTIONS = {
    businessTypes: ['Sole proprietor', 'Partnership', 'Limited company', 'Cooperative / Sacco', 'Other'],
    sectors: ['Retail shop', 'Wholesale & distribution', 'Hardware & building materials', 'Agribusiness & farming',
      'Manufacturing', 'Transport & logistics', 'Hospitality & food', 'Textiles & tailoring',
      'Health & pharmacy', 'Services', 'Other'],
    cities: ['Nairobi', 'Mombasa', 'Nakuru', 'Eldoret', 'Elsewhere'],
    years: ['Under 1 year', '1 – 3 years', 'Over 3 years'],
    revenue: ['Under 200K', '200K – 500K', '500K – 2M', 'Over 2M'],
    employees: ['Just me', '2 – 5', '6 – 20', '21 – 50', 'Over 50']
  };

  /* Same required set the database uses to set profile_completed_at. */
  var REQUIRED = ['full_name', 'phone', 'business_name', 'business_type', 'sector', 'city', 'years_trading', 'monthly_revenue'];
  var COLUMNS = 'full_name, phone, business_name, city, preferred_language, avatar_path, business_type, sector, ' +
    'registration_number, town, years_trading, monthly_revenue, employees, business_description, profile_completed_at';

  function completion(p) {
    p = p || {};
    var done = REQUIRED.filter(function (k) { return p[k] !== null && p[k] !== undefined && p[k] !== ''; }).length;
    return { done: done, total: REQUIRED.length, pct: Math.round(done / REQUIRED.length * 100), complete: done === REQUIRED.length };
  }

  function load(userId) {
    return sb.from('profiles').select(COLUMNS).eq('id', userId).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  /* Update the user's profile row, creating it if it doesn't exist yet. */
  function save(userId, fields) {
    return sb.from('profiles').update(fields).eq('id', userId).select(COLUMNS).then(function (res) {
      if (res.error) throw res.error;
      if (res.data && res.data.length) return res.data[0];
      var row = Object.assign({ id: userId }, fields);
      return sb.from('profiles').insert(row).select(COLUMNS).single().then(function (ins) {
        if (ins.error) throw ins.error;
        return ins.data;
      });
    });
  }

  /* Short-lived URL for a private photo; null when there is no photo. */
  function avatarUrl(path) {
    if (!path) return Promise.resolve(null);
    return sb.storage.from(BUCKET).createSignedUrl(path, 3600).then(function (res) {
      return res.error ? null : res.data.signedUrl;
    });
  }

  /* Shrink and crop a picked image to a square WebP (JPEG fallback). */
  function squareImage(file, size) {
    size = size || 512;
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) { reject(new Error('type')); return; }
      if (file.size > 15 * 1024 * 1024) { reject(new Error('big')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(img.naturalWidth, img.naturalHeight);
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob && blob.type === 'image/webp') { resolve({ blob: blob, ext: 'webp', type: 'image/webp' }); return; }
          canvas.toBlob(function (jpg) {
            jpg ? resolve({ blob: jpg, ext: 'jpg', type: 'image/jpeg' }) : reject(new Error('encode'));
          }, 'image/jpeg', 0.86);
        }, 'image/webp', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  /* Upload a new photo, point the profile at it, then delete the old file. */
  function uploadAvatar(userId, file, oldPath) {
    return squareImage(file).then(function (img) {
      var path = userId + '/avatar-' + Date.now() + '.' + img.ext;
      return sb.storage.from(BUCKET).upload(path, img.blob, { contentType: img.type, upsert: false, cacheControl: '3600' })
        .then(function (up) {
          if (up.error) throw up.error;
          return save(userId, { avatar_path: path });
        })
        .then(function (profile) {
          if (oldPath && oldPath !== path) sb.storage.from(BUCKET).remove([oldPath]);
          return profile;
        });
    });
  }

  function removeAvatar(userId, path) {
    return save(userId, { avatar_path: null }).then(function (profile) {
      if (path) sb.storage.from(BUCKET).remove([path]);
      return profile;
    });
  }

  function photoError(err) {
    var m = err && err.message;
    if (m === 'type') return 'Choose a JPG, PNG or WebP photo.';
    if (m === 'big') return 'That photo is too large. Choose one under 15 MB.';
    if (m === 'decode' || m === 'encode') return 'We couldn’t read that photo. Try a different one.';
    return A.friendlyError(err);
  }

  /* Initials for the placeholder when there's no photo. */
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  window.ImaraProfile = {
    OPTIONS: OPTIONS, REQUIRED: REQUIRED,
    completion: completion, load: load, save: save,
    avatarUrl: avatarUrl, uploadAvatar: uploadAvatar, removeAvatar: removeAvatar,
    photoError: photoError, initials: initials
  };
})();
