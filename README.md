# Imara Capital — Landing page

Landing page for **Imara Capital**, business loans for problem-aware Kenyan SMEs (KSh 100K – 12M, no collateral, every fee shown upfront). It is a static site built from the Claude Design file *Imara Capital Landing* on the "Industry" design system, and deployed on Netlify.

## Features

- **Standard terms sheet** and a **side-by-side comparison** (bank vs. mobile loan app vs. Imara)
- **Loan calculator**: reducing-balance installment at 2%/month, 3% processing fee plus 20% excise duty, an affordability ratio against monthly revenue, and time-to-money
- **30-second eligibility check** by location, revenue band and time trading, with a tailored answer
- **Application call-back form** via [Netlify Forms](https://docs.netlify.com/forms/setup/) (`loan-application`). It captures the calculator and eligibility answers and uses a honeypot for spam.
- Stories, FAQ, final CTA, plus privacy, thank-you and 404 pages
- Responsive down to 320px, keyboard accessible (focus-trapped dialog, skip link), with security headers and a CSP in `netlify.toml`

## Structure

```
public/                 ← Netlify publish directory
  index.html
  privacy.html  thanks.html  404.html
  assets/css/industry.css   design-system tokens and components
  assets/css/site.css       page-level styles
  assets/js/main.js         calculator, eligibility and form logic
  assets/img/               optimized photos (WebP + JPEG)
netlify.toml            build, headers and redirects
```

Tune the loan pricing with the constants at the top of `public/assets/js/main.js` (`MONTHLY_RATE`, `PROCESSING_FEE`).

## Deploy on Netlify

1. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick `fndungu2025/SMEs.Project`.
2. Branch: `main`. Leave the build command empty. The publish directory (`public`) is read from `netlify.toml`.
3. Deploy. Form submissions appear under **Site → Forms**, where you can also turn on email notifications.

## Local preview

```sh
cd public && python3 -m http.server 8000
```
