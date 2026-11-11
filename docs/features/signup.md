# Signup and captcha

New accounts sign up with a username and a password and solve a Cap captcha. [invites.md](invites.md) covers invite-only signup, and [automod.md](automod.md) covers join reasons, manual approval, signup scoring and the limits per address.

## Cap verification

Registration needs a solved [Cap](https://trycap.dev/guide/capjs-core) proof by default, and an instance invite doesn't replace it. The Captcha card in Site settings has these settings:

| Setting                                   | Default | Effect                                                                 |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `register.requireCaptcha`                 | true    | Registration needs a captcha.                                          |
| `security.captcha.enabled`                | false   | Allows the optional captcha on sign-in and password reset.             |
| `login.requireCaptcha`                    | false   | Sign-in needs a captcha, when `security.captcha.enabled` is on.        |
| `passwordReset.requireCaptcha`            | false   | Password reset needs a captcha, when `security.captcha.enabled` is on. |
| `security.captcha.capMode`                | `core`  | `core` or `standalone`.                                                |
| `security.captcha.blockAutomatedBrowsers` | true    | Refuse solves from automated browsers, see below.                      |

In `core` mode the server runs Cap itself, with no API key or outside request. In `standalone` mode it uses a Cap Standalone server and needs its URL in `security.captcha.instance`, its `sitekey` and its `secret`. Site settings refuses to save standalone mode without all three, and with incomplete standalone settings the server refuses every captcha instead of falling back to core.

Challenges and solved tokens expire after 5 minutes, and each token works once. The challenge and redeem routes each allow 30 requests per IP per minute.

## Challenge work per place

A Cap core solve is a set of SHA-256 proof of work challenges. `count` is how many challenges one solve has, `size` is the length of each salt and `difficulty` is how many leading hex digits each hash has to match. Each step of difficulty multiplies the work by 16.

| Place          | Key                                         | Default                              |
| -------------- | ------------------------------------------- | ------------------------------------ |
| Registration   | `security.captcha.challenges.register`      | 64 challenges, size 32, difficulty 5 |
| Sign-in        | `security.captcha.challenges.login`         | 16 challenges, size 32, difficulty 5 |
| Password reset | `security.captcha.challenges.passwordReset` | 16 challenges, size 32, difficulty 5 |

The server clamps `count` to 1 through 500, `size` to 16 through 64 and `difficulty` to 1 through 8. A Cap Standalone server ignores these. A registration solve takes 3 to 6 seconds on an Apple M3 MacBook and longer on phones, and `difficulty` 4 cuts the work to a sixteenth.

## Refusing automated browsers

While `security.captcha.blockAutomatedBrowsers` is on, a Cap core challenge also inspects the browser. The server refuses a solve that shows one strong sign, such as `navigator.webdriver`, a headless user agent or a 0 by 0 window, or 2 weak signs, such as a software WebGL renderer or missing Chromium plugins. It logs `[Cap] refused an automated browser for <place>: <reasons>`.

This stops headless Chromium driven by Playwright, Puppeteer or Selenium with their default settings. A real browser or a paid solving service gets through and still pays the proof of work and the rate limits.

## Email

The signup form has no email field by default, because `assets/client_patches/55-simple-signup.js` removes Discord's. Site settings has 3 switches under Registration:

| Switch                   | Setting                     | Default | Effect                                                                                       |
| ------------------------ | --------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| Require an email address | `register.email.required`   | false   | The form shows a required email field, and the API refuses a signup without one.             |
| Verify email addresses   | `defaults.user.verified`    | true    | The switch is on when this is `false`. New accounts then start unverified and get a link.    |
| Require a verified email | `login.requireVerification` | false   | Holds unverified accounts back as described below. Needs an email address to be required.    |

Verification links need an email provider, see `SMTP_HOST` in [setup.md](../self-hosting/setup.md#environment).

An unverified account can always sign in and read. While `login.requireVerification` is on, the server refuses its writes with HTTP 403 and code 40002 and ignores its voice joins, and the client shows a Verification Required screen with Resend Email and Change Email. Bots are never held back.
